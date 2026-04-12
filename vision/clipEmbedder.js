/**
 * CLIP image embeddings via @xenova/transformers (no engine core dependency).
 * Model is loaded once and reused across calls.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { pipeline, RawImage } from "@xenova/transformers";

const MODEL_ID = "Xenova/clip-vit-base-patch32";

let cachedExtractor = null;

async function getExtractor() {
  if (!cachedExtractor) {
    cachedExtractor = await pipeline("image-feature-extraction", MODEL_ID);
  }
  return cachedExtractor;
}

/**
 * Decode via sharp when available (normalizes EXIF/orientation, PNG output).
 * Used only when file-URL + blob fallbacks need extra help.
 * @param {string} absolutePath
 */
async function rawImageViaSharp(absolutePath) {
  const sharp = (await import("sharp")).default;
  const buffer = await sharp(absolutePath).rotate().ensureAlpha().png().toBuffer();
  return RawImage.fromBlob(new Blob([buffer]));
}

/**
 * @param {import('@xenova/transformers').Tensor} tensor
 * @returns {number[]}
 */
function tensorToEmbeddingArray(tensor) {
  const data = tensor?.data;
  if (!data || !data.length) {
    throw new Error("model returned empty tensor");
  }
  return Array.from(data);
}

/**
 * Load a PNG (or other image) from disk and return a CLIP image embedding.
 * @param {string} imagePath
 * @returns {Promise<{ embedding: number[] } | { error: 'embedding_failed', message: string }>}
 */
export async function getImageEmbedding(imagePath) {
  try {
    const abs = resolve(imagePath);
    if (!existsSync(abs)) {
      return { error: "embedding_failed", message: `File not found: ${imagePath}` };
    }

    const extractor = await getExtractor();
    let tensor;

    try {
      tensor = await extractor(pathToFileURL(abs).href);
    } catch {
      try {
        const buf = readFileSync(abs);
        const blob = new Blob([buf]);
        const img = await RawImage.fromBlob(blob);
        tensor = await extractor(img);
      } catch {
        const img = await rawImageViaSharp(abs);
        tensor = await extractor(img);
      }
    }

    const embedding = tensorToEmbeddingArray(tensor);
    return { embedding };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: "embedding_failed", message };
  }
}

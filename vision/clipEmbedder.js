/**
 * CLIP image + text embeddings via @xenova/transformers (same model family, shared space).
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { CLIPTextModelWithProjection, CLIPTokenizer, pipeline, RawImage } from "@xenova/transformers";

const MODEL_ID = "Xenova/clip-vit-base-patch32";

let cachedExtractor = null;
/** @type {Promise<import('@xenova/transformers').CLIPTokenizer> | null} */
let cachedTokenizerPromise = null;
/** @type {Promise<import('@xenova/transformers').CLIPTextModelWithProjection> | null} */
let cachedTextModelPromise = null;

async function getExtractor() {
  if (!cachedExtractor) {
    cachedExtractor = await pipeline("image-feature-extraction", MODEL_ID);
  }
  return cachedExtractor;
}

async function getClipTokenizer() {
  if (!cachedTokenizerPromise) {
    cachedTokenizerPromise = CLIPTokenizer.from_pretrained(MODEL_ID);
  }
  return cachedTokenizerPromise;
}

async function getClipTextModel() {
  if (!cachedTextModelPromise) {
    cachedTextModelPromise = CLIPTextModelWithProjection.from_pretrained(MODEL_ID);
  }
  return cachedTextModelPromise;
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

/**
 * @param {import('@xenova/transformers').Tensor} textEmbedsTensor
 * @returns {Float32Array[]}
 */
function textEmbedsTensorToRows(textEmbedsTensor) {
  const dims = textEmbedsTensor.dims;
  const data = textEmbedsTensor.data;
  if (!dims || dims.length < 2 || !data?.length) {
    throw new Error("clip text_embeds: invalid tensor");
  }
  const batch = dims[0];
  const dim = dims[1];
  /** @type {Float32Array[]} */
  const rows = [];
  for (let i = 0; i < batch; i++) {
    const row = new Float32Array(dim);
    const off = i * dim;
    for (let j = 0; j < dim; j++) row[j] = data[off + j];
    rows.push(row);
  }
  return rows;
}

/**
 * CLIP text embedding (same projected space as {@link getImageEmbedding}).
 * @param {string} text
 * @returns {Promise<{ embedding: number[] } | { error: 'embedding_failed', message: string }>}
 */
export async function getTextEmbedding(text) {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return { error: "embedding_failed", message: "empty text" };
  }
  try {
    const tokenizer = await getClipTokenizer();
    const model = await getClipTextModel();
    const inputs = await tokenizer([raw], { padding: true, truncation: true });
    const out = await model(inputs);
    const rows = textEmbedsTensorToRows(out.text_embeds);
    const embedding = [...rows[0]];
    return { embedding };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: "embedding_failed", message };
  }
}

/**
 * Batch CLIP text embeddings (more efficient than many single calls).
 * @param {string[]} texts — non-empty strings
 * @returns {Promise<{ embeddings: number[][] } | { error: 'embedding_failed', message: string }>}
 */
export async function getTextEmbeddingsBatch(texts) {
  const cleaned = texts.map((t) => String(t ?? "").trim()).filter((t) => t.length > 0);
  if (cleaned.length === 0) {
    return { error: "embedding_failed", message: "no non-empty texts" };
  }
  try {
    const tokenizer = await getClipTokenizer();
    const model = await getClipTextModel();
    const inputs = await tokenizer(cleaned, { padding: true, truncation: true });
    const out = await model(inputs);
    const rows = textEmbedsTensorToRows(out.text_embeds);
    const embeddings = rows.map((r) => [...r]);
    return { embeddings };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: "embedding_failed", message };
  }
}

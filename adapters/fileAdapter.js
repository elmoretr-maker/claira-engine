/**
 * File-system ingestion: supported raster images under a folder.
 */

import { readdir } from "fs/promises";
import { basename, join, resolve } from "path";
import { normalizeInput } from "./baseAdapter.js";
import { isSupportedImageFilename } from "./supportedImages.js";
import { extractTextFromImage } from "./ocr.js";

/**
 * @param {string} dir
 * @param {string[]} out
 */
async function collectImagesRecursive(dir, out) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await collectImagesRecursive(full, out);
    else if (e.isFile() && isSupportedImageFilename(e.name)) out.push(full);
  }
}

/**
 * @param {string} folderPath
 * @param {{ cwd?: string, ocr?: boolean }} [options] — `ocr` defaults false; when true, runs OCR per image
 * @returns {Promise<import("./baseAdapter.js").StandardInput[]>}
 */
export async function ingestFiles(folderPath, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const ocr = options.ocr === true;
  const root = resolve(cwd, folderPath);
  const files = [];
  await collectImagesRecursive(root, files);
  files.sort();

  /** @type {import("./baseAdapter.js").StandardInput[]} */
  const out = [];
  for (const absPath of files) {
    /** @type {{ source: string, originalName: string, extractedText?: string }} */
    const metadata = {
      source: "file",
      originalName: basename(absPath),
    };
    if (ocr) {
      metadata.extractedText = await extractTextFromImage(absPath);
    }
    out.push(
      normalizeInput({
        type: "image",
        data: {
          filePath: absPath,
          buffer: null,
          url: null,
        },
        metadata,
      }),
    );
  }
  return out;
}

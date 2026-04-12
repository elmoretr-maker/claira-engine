/**
 * OCR helpers — additive text extraction for document and optional file ingestion.
 */

import { createWorker } from "tesseract.js";

let workerPromise;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, { logger: () => {} });
  }
  return workerPromise;
}

/**
 * @param {string} filePath — absolute or cwd-relative path to a raster image
 * @returns {Promise<string>} trimmed OCR text (empty string on failure)
 */
export async function extractTextFromImage(filePath) {
  try {
    const worker = await getWorker();
    const {
      data: { text },
    } = await worker.recognize(filePath);
    return typeof text === "string" ? text.trim() : "";
  } catch {
    return "";
  }
}

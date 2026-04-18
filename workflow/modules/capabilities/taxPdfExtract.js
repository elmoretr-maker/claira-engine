/**
 * Read-only PDF text extraction (pdfjs-dist). Enforces page limit.
 */

import { createRequire } from "module";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { pathToFileURL } from "url";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { MAX_PAGES } from "./taxPathUnderCwd.js";

const require = createRequire(import.meta.url);

let workerConfigured = false;
function ensurePdfWorker() {
  if (workerConfigured) return;
  const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
  GlobalWorkerOptions.workerSrc = pathToFileURL(join(pdfjsRoot, "legacy/build/pdf.worker.mjs")).href;
  workerConfigured = true;
}

/** @type {typeof import("@napi-rs/canvas")} */
let canvasMod;
function loadCanvas() {
  if (!canvasMod) {
    canvasMod = require("@napi-rs/canvas");
  }
  return canvasMod;
}

function ensureCanvasPolyfills() {
  const { DOMMatrix, ImageData, Path2D } = loadCanvas();
  if (typeof globalThis.DOMMatrix === "undefined") globalThis.DOMMatrix = DOMMatrix;
  if (typeof globalThis.ImageData === "undefined") globalThis.ImageData = ImageData;
  if (typeof globalThis.Path2D === "undefined") globalThis.Path2D = Path2D;
}

/**
 * @param {string} absPath
 * @returns {Promise<{ text: string, pageCount: number }>}
 */
export async function extractPdfTextFromFile(absPath) {
  ensurePdfWorker();
  ensureCanvasPolyfills();

  const data = new Uint8Array(readFileSync(absPath));
  const loadingTask = getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  if (pageCount > MAX_PAGES) {
    throw new Error(`tax_document_comparison: PDF exceeds max pages (${MAX_PAGES}): ${absPath}`);
  }

  /** @type {string[]} */
  const parts = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const line = tc.items
      .map((it) => (it && typeof /** @type {{ str?: string }} */ (it).str === "string" ? it.str : ""))
      .join(" ");
    parts.push(line);
  }

  return { text: parts.join("\n"), pageCount };
}

/**
 * PDF ingestion: rasterize pages to PNG files, then expose as normalized image inputs
 * for the existing pipeline (no separate classification path).
 */

import { createRequire } from "module";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { readdir } from "fs/promises";
import { basename, dirname, extname, join, resolve } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { normalizeInput } from "./baseAdapter.js";
import { extractTextFromImage } from "./ocr.js";

const require = createRequire(import.meta.url);

/** @type {typeof import("@napi-rs/canvas")} */
let canvasMod;
function loadCanvas() {
  if (!canvasMod) {
    canvasMod = require("@napi-rs/canvas");
  }
  return canvasMod;
}

let workerConfigured = false;
function ensurePdfWorker() {
  if (workerConfigured) return;
  const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
  GlobalWorkerOptions.workerSrc = pathToFileURL(join(pdfjsRoot, "legacy/build/pdf.worker.mjs")).href;
  workerConfigured = true;
}

function ensureCanvasPolyfills() {
  const { DOMMatrix, ImageData, Path2D } = loadCanvas();
  if (typeof globalThis.DOMMatrix === "undefined") globalThis.DOMMatrix = DOMMatrix;
  if (typeof globalThis.ImageData === "undefined") globalThis.ImageData = ImageData;
  if (typeof globalThis.Path2D === "undefined") globalThis.Path2D = Path2D;
}

/**
 * @param {string} name
 * @returns {string}
 */
function safeSegment(name) {
  const base = basename(name, extname(name));
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "document";
}

/**
 * @param {string} dir
 * @param {string[]} out
 */
async function collectPdfRecursive(dir, out) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await collectPdfRecursive(full, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".pdf")) out.push(full);
  }
}

/**
 * @param {string} pdfAbsPath
 * @param {string} outDir — directory for PNGs from this PDF
 * @returns {Promise<string[]>} absolute paths to PNG files
 */
async function rasterizePdfToPngFiles(pdfAbsPath, outDir) {
  ensurePdfWorker();
  ensureCanvasPolyfills();
  const { createCanvas } = loadCanvas();

  const data = new Uint8Array(readFileSync(pdfAbsPath));
  const loadingTask = getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  /** @type {string[]} */
  const paths = [];
  const scale = 2;

  for (let p = 1; p <= numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const pngBuf = canvas.toBuffer("image/png");
    const outPath = join(outDir, `page_${p}.png`);
    writeFileSync(outPath, pngBuf);
    paths.push(outPath);
  }

  return paths;
}

/**
 * @param {string} inputPath — folder path (relative to cwd or absolute)
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<import("./baseAdapter.js").StandardInput[]>}
 */
export async function ingestDocuments(inputPath, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const root = resolve(cwd, inputPath);
  const pdfs = [];
  await collectPdfRecursive(root, pdfs);
  pdfs.sort();

  if (!pdfs.length) return [];

  const batchRoot = mkdtempSync(join(tmpdir(), "claira-pdf-"));
  /** @type {import("./baseAdapter.js").StandardInput[]} */
  const normalized = [];

  for (let d = 0; d < pdfs.length; d++) {
    const pdfPath = pdfs[d];
    const seg = safeSegment(pdfPath);
    const outDir = join(batchRoot, `${seg}_${d}`);
    mkdirSync(outDir, { recursive: true });

    try {
      const pngPaths = await rasterizePdfToPngFiles(pdfPath, outDir);
      let page = 0;
      for (const pngAbs of pngPaths) {
        page += 1;
        const extractedText = await extractTextFromImage(pngAbs);
        normalized.push(
          normalizeInput({
            type: "image",
            data: {
              filePath: pngAbs,
              buffer: null,
              url: null,
            },
            metadata: {
              source: "document",
              originalName: `${seg}_p${page}.png`,
              extractedText,
            },
          }),
        );
      }
    } catch {
      /* skip corrupt or unreadable PDFs — other files still ingest */
    }
  }

  return normalized;
}

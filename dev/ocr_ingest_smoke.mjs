/**
 * OCR + document ingest smoke:
 * - builds a minimal one-page PDF with text
 * - ingestDocuments → each item has metadata.extractedText
 * - processData runs without throwing (existing pipeline)
 *
 * Run from package root: node dev/ocr_ingest_smoke.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ingestDocuments } from "../adapters/documentAdapter.js";
import { processData } from "../interfaces/api.js";

function buildOnePageTextPdf(text) {
  const parts = [];
  const push = (s) => parts.push(Buffer.from(s, "utf8"));

  push("%PDF-1.4\n");
  const bodies = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(text, "utf8")} >>\nstream\n${text}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  let pos = parts[0].length;
  const offsets = [];
  for (const b of bodies) {
    offsets.push(pos);
    push(b);
    pos += Buffer.byteLength(b, "utf8");
  }

  const xrefOffset = pos;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (const o of offsets) {
    xref += `${String(o).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  pos += Buffer.byteLength(xref, "utf8");

  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  push(trailer);

  return Buffer.concat(parts);
}

const stream = "BT /F1 72 Tf 40 100 Td (OCRSMOKE99) Tj ET\n";
const pdfBuf = buildOnePageTextPdf(stream);

const root = mkdtempSync(join(tmpdir(), "claira-ocr-smoke-"));
try {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "smoke.pdf"), pdfBuf);

  const items = await ingestDocuments(".", { cwd: root });
  if (!items.length) {
    console.error("FAIL: expected at least one page from PDF");
    process.exit(1);
  }
  for (let i = 0; i < items.length; i++) {
    const m = items[i]?.metadata;
    if (!m || typeof m.extractedText !== "string") {
      console.error("FAIL: metadata.extractedText missing", i, items[i]);
      process.exit(1);
    }
  }

  const out = await processData(items, { cwd: root });
  if (typeof out.processed !== "number" || !Array.isArray(out.results)) {
    console.error("FAIL: processData shape", out);
    process.exit(1);
  }

  console.log("ocr ingest smoke OK", { pages: items.length, processed: out.processed });
} finally {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Resolve PDF paths strictly under cwd (no traversal).
 */

import { existsSync, statSync } from "fs";
import { resolve, relative, sep, isAbsolute } from "path";

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 20;

/**
 * @param {string} cwd
 * @param {string} userPath
 * @returns {{ absPath: string }}
 */
export function assertPdfPathUnderCwd(cwd, userPath) {
  const root = resolve(cwd || process.cwd());
  const raw = String(userPath ?? "").trim();
  if (!raw) throw new Error("tax_document_comparison: empty path");

  const candidate = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
  if (!candidate.toLowerCase().endsWith(".pdf")) {
    throw new Error(`tax_document_comparison: not a PDF: ${userPath}`);
  }

  const rel = relative(root, candidate);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || rel.split(sep).includes("..")) {
    throw new Error(`tax_document_comparison: path must be under workspace (${root}): ${userPath}`);
  }

  if (!existsSync(candidate)) {
    throw new Error(`tax_document_comparison: file not found: ${userPath}`);
  }
  const st = statSync(candidate);
  if (!st.isFile()) throw new Error(`tax_document_comparison: not a file: ${userPath}`);
  if (st.size > MAX_PDF_BYTES) {
    throw new Error(
      `tax_document_comparison: PDF exceeds max size (${MAX_PDF_BYTES} bytes): ${userPath}`,
    );
  }
  return { absPath: candidate };
}

export { MAX_PDF_BYTES, MAX_PAGES };

/**
 * Filesystem-safe slug for receipt path segments (trim + lowercase + sanitize).
 * Browser-safe: no Node `path` import (Vite cannot bundle it for client code).
 * @param {string} seg
 */
export function slugReceiptSegment(seg) {
  const t = String(seg ?? "").trim();
  if (!t) throw new Error("receipt: path segment cannot be empty");
  if (t.includes("..") || t.includes("/") || t.includes("\\")) {
    throw new Error(`receipt: invalid path segment: ${seg}`);
  }
  const s = t
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  if (!s) throw new Error("receipt: path segment slug empty");
  return s;
}

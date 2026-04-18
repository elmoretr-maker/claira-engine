/**
 * Deterministic tax-oriented hints from basename/filename (dry-run helpers for tagging & rename).
 */

/**
 * @param {string} rawPath
 */
export function basenameFromPath(rawPath) {
  const s = String(rawPath ?? "").replace(/\\/g, "/").trim();
  if (!s) return "";
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * @param {string} base
 */
function stripExtension(base) {
  const b = String(base ?? "").trim();
  const m = b.match(/^(.+?)(\.[a-z0-9]{1,8})$/i);
  return m ? m[1] : b;
}

/**
 * @param {string} nameWithoutExt
 * @returns {{ clientSlug: string, year: string, documentType: string }}
 */
export function extractTaxHintsFromBasename(nameWithoutExt) {
  const raw = String(nameWithoutExt ?? "").trim();
  const lower = raw.toLowerCase();
  /** @type {string} */
  let year = "";
  const ym = lower.match(/(19|20)\d{2}/);
  if (ym) year = ym[0];

  /** @type {string} */
  let documentType = "document";
  if (/\bw[\s_-]?2\b|w2|w-2/.test(lower)) documentType = "w2";
  else if (/1099/.test(lower)) documentType = "1099";
  else if (/1098/.test(lower)) documentType = "1098";
  else if (/receipt/.test(lower)) documentType = "receipt";
  else if (/schedule[\s_-]?c\b/.test(lower)) documentType = "schedule_c";
  else if (/invoice/.test(lower)) documentType = "invoice";

  let clientPart = stripExtension(raw).replace(/(19|20)\d{2}/g, " ").trim();
  clientPart = clientPart
    .replace(/(^|[^a-z0-9])w2([^a-z0-9]|$)/gi, "$1 $2")
    .replace(/w-2/gi, " ")
    .replace(/1099[a-z-]*/gi, " ")
    .replace(/1098[a-z-]*/gi, " ")
    .replace(/receipt|invoice/gi, " ")
    .replace(/schedule[\s_-]?c/gi, " ")
    .replace(/[_-]+/g, " ")
    .trim();

  const tokens = clientPart
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !/^(copy|scan|img|image|photo|final|draft)$/i.test(t));

  const clientSlug =
    tokens.length > 0
      ? tokens
          .slice(0, 3)
          .join("_")
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 48) || "client"
      : "client";

  return {
    clientSlug,
    year: year || "unknown_year",
    documentType,
  };
}

/**
 * @param {string} filePath
 */
export function fileExtensionFromPath(filePath) {
  const base = basenameFromPath(filePath);
  const m = base.match(/(\.[a-z0-9]{1,8})$/i);
  return m ? m[1].toLowerCase() : ".png";
}

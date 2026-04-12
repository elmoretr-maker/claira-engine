/**
 * Raster image extensions accepted for ingestion and process-folder (case-insensitive).
 */

const EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

/**
 * @param {string} filename — file name or path leaf
 * @returns {boolean}
 */
export function isSupportedImageFilename(filename) {
  const leaf = String(filename).split(/[/\\]/).pop() ?? String(filename);
  const lower = leaf.toLowerCase();
  for (const ext of EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

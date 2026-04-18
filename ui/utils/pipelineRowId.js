/**
 * Stable id for capability apply + persistence (index + path).
 * @param {unknown} row
 * @param {number} index
 */
export function stablePipelineRowId(row, index) {
  const rec =
    row != null && typeof row === "object" && !Array.isArray(row) ? /** @type {Record<string, unknown>} */ (row) : {};
  const fp = typeof rec.filePath === "string" ? rec.filePath.trim() : "";
  const rel = typeof rec.rel === "string" ? rec.rel.trim() : "";
  const key = fp || rel || `idx_${index}`;
  return `r${index}:${key.replace(/\s+/g, " ").slice(0, 240)}`;
}

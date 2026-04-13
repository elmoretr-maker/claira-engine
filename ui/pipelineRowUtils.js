/**
 * Shared helpers for interpreting pipeline result rows (browser UI).
 */

/**
 * @param {unknown} row
 * @returns {boolean}
 */
export function isReviewPipelineRow(row) {
  if (row == null || typeof row !== "object") return false;
  const r = /** @type {Record<string, unknown>} */ (row);
  const reasonTop = typeof r.reason === "string" ? r.reason : "";
  if (reasonTop === "rejected_by_room") return true;

  const pc = r.place_card;
  if (pc && typeof pc === "object") {
    const pcReason = String(/** @type {Record<string, unknown>} */ (pc).reason ?? "");
    if (pcReason === "rejected_by_room") return true;
    const pcDec = /** @type {Record<string, unknown>} */ (pc).decision;
    if (typeof pcDec === "string" && pcDec !== "auto") return true;
  }

  const dec = typeof r.decision === "string" ? r.decision : null;
  if (dec != null && dec !== "auto") return true;

  if (r.room_validation != null) return true;
  if (r.priority != null) return true;
  if (r.error != null) return true;

  return false;
}

/**
 * Successfully processed for tunnel example counting: pipeline ran without review or hard errors.
 * @param {unknown} row
 * @returns {boolean}
 */
export function isSuccessfullyProcessedRow(row) {
  if (row == null || typeof row !== "object") return false;
  const r = /** @type {Record<string, unknown>} */ (row);
  if (r.error === "embedding_failed") return false;
  if (typeof r.error === "string" && r.error.length > 0) return false;
  if (isReviewPipelineRow(row)) return false;
  return true;
}

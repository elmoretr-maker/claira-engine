/**
 * Shared helpers for interpreting pipeline result rows (browser UI).
 */

/**
 * Pipeline row where user_override bypassed review interruption (decision still review in data).
 * @param {unknown} row
 * @returns {boolean}
 */
export function isBypassReviewPipelineRow(row) {
  if (row == null || typeof row !== "object") return false;
  const pc = /** @type {Record<string, unknown>} */ (row).place_card;
  return !!(pc && typeof pc === "object" && pc.user_override === "bypass_review");
}

/**
 * Auto decision with autoMove off — user must confirm before treating as “done”.
 * @param {unknown} row
 * @returns {boolean}
 */
export function isConfirmPipelineRow(row) {
  if (row == null || typeof row !== "object") return false;
  const pc = /** @type {Record<string, unknown>} */ (row).place_card;
  return !!(pc && typeof pc === "object" && pc.execution_mode === "confirm");
}

/**
 * @param {unknown} row
 * @returns {boolean}
 */
export function isReviewPipelineRow(row) {
  if (row == null || typeof row !== "object") return false;
  if (isBypassReviewPipelineRow(row)) return false;
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

/**
 * UI-only: stable per-row timestamps when the server log is not yet merged into the row.
 * @param {unknown[]} rows
 * @returns {unknown[]}
 */
export function attachSessionBypassUiMetadata(rows) {
  if (!Array.isArray(rows)) return rows;
  const t0 = Date.now();
  let n = 0;
  return rows.map((row) => {
    if (!isBypassReviewPipelineRow(row)) return row;
    return {
      ...(row && typeof row === "object" ? /** @type {Record<string, unknown>} */ (row) : {}),
      sessionBypassAt: t0 + n++,
    };
  });
}

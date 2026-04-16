/**
 * Shared iteration over pipeline result rows for module post_pipeline handlers.
 * Domain-agnostic; does not import engine internals.
 */

/**
 * @param {unknown} snapshot — frozen engine output snapshot
 * @param {(row: {
 *   filePath: string,
 *   classificationSummary: Record<string, unknown>,
 *   pipelineRowType: unknown,
 * }) => void} fn
 */
export function forEachIngestibleImageRow(snapshot, fn) {
  const out = snapshot && typeof snapshot === "object" ? snapshot : {};
  const rows = /** @type {unknown} */ (/** @type {Record<string, unknown>} */ (out).results);
  if (!Array.isArray(rows)) return;

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    if (r.type === "embedding_failed" || r.type === "skip") continue;
    const filePath = typeof r.filePath === "string" ? r.filePath : "";
    if (!filePath) continue;

    const pc = r.place_card && typeof r.place_card === "object" ? r.place_card : {};
    const p = /** @type {Record<string, unknown>} */ (pc);
    const classificationSummary = {
      predicted_label: p.predicted_label ?? null,
      routing_label: p.routing_label ?? null,
      proposed_destination: p.proposed_destination ?? null,
      decision: p.decision ?? null,
      reason: p.reason ?? null,
      user_override: p.user_override ?? null,
      execution_mode: p.execution_mode ?? null,
    };

    fn({
      filePath,
      classificationSummary,
      pipelineRowType: r.type,
    });
  }
}

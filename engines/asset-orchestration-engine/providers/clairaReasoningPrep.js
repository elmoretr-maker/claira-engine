/**
 * Claira Engine — reasoning provider prep (interface only; Phase 10.5).
 * No filesystem or watcher logic. Full integration deferred to a later phase.
 */

/**
 * @typedef {{
 *   schema?: string,
 *   summary?: string,
 *   items?: unknown[],
 * }} StructuredDeliverableLike
 */

/**
 * @typedef {{
 *   deliverable?: StructuredDeliverableLike | null,
 *   source?: string,
 * }} ClairaReasoningInput
 */

/**
 * @typedef {{
 *   deliverable?: StructuredDeliverableLike | null,
 *   claira?: { prepared: true, note?: string },
 * }} ClairaReasoningOutput
 */

/**
 * Normalize input for a future Claira reasoning call (no side effects).
 * @param {unknown} raw
 * @returns {ClairaReasoningInput}
 */
export function prepareClairaReasoningInput(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { source: "asset-orchestration-engine", deliverable: null };
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  const del = o.deliverable;
  return {
    source: "asset-orchestration-engine",
    deliverable:
      del != null && typeof del === "object" && !Array.isArray(del)
        ? /** @type {StructuredDeliverableLike} */ (del)
        : null,
  };
}

/**
 * Placeholder for enhanced analysis (pass-through until Claira is wired).
 * @param {ClairaReasoningInput} input
 * @returns {ClairaReasoningOutput}
 */
export function enhanceAnalysisWithClaira(input) {
  return {
    deliverable: input.deliverable ?? null,
    claira: { prepared: true, note: "interface stub — no Claira invocation yet" },
  };
}

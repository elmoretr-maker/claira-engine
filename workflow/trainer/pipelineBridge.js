/**
 * @deprecated Pipeline handoff is via workflow/moduleHost/moduleHost.js (dispatchPostPipeline).
 * Kept for callers that still import this path.
 */

import { dispatchPostPipeline } from "../moduleHost/moduleHost.js";

/**
 * @param {object} out
 * @param {{ clientId?: string, cwd?: string }} ctx
 */
export function recordTrainerPipelineResults(out, ctx) {
  const entityId = String(ctx?.entityId ?? ctx?.clientId ?? "").trim();
  dispatchPostPipeline(out, {
    entityId,
    cwd: ctx?.cwd,
  });
}

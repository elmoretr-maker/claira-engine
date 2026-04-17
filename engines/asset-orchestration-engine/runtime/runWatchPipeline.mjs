/**
 * Asset Orchestration Engine — single entry for `watch:workflow` batch processing.
 * Delegates to existing workflow Phase 10 pipeline without changing module behavior.
 */

import { runPhase10Pipeline } from "../../../workflow/watcher/runPhase10Pipeline.mjs";
import { logExecutionTraceSlots, logOrchestration, isOrchestrationLogEnabled } from "./orchestrationLogger.mjs";

/**
 * @param {{
 *   cwd?: string,
 *   imagePaths: string[],
 *   destinationRoot?: string,
 *   dryRun?: boolean,
 *   entityLabel?: string,
 * }} opts
 */
export async function runAssetOrchestrationWatchPipeline(opts) {
  const imageCount = Array.isArray(opts.imagePaths) ? opts.imagePaths.length : 0;
  logOrchestration(`batch start → runPhase10Pipeline (workflow modules unchanged)`);

  const result = await runPhase10Pipeline(opts);

  const ex = result?.execution;
  logExecutionTraceSlots(ex, { imageCount });

  if (isOrchestrationLogEnabled() && ex?.results?.structured_output?.status === "ok") {
    const data = ex.results.structured_output?.data;
    const n = Array.isArray(/** @type {{ deliverable?: { items?: unknown[] } }} */ (data)?.deliverable?.items)
      ? /** @type {{ deliverable: { items: unknown[] } }} */ (data).deliverable.items.length
      : 0;
    logOrchestration(`structured deliverable items: ${n} (refinement: claira_reasoning module)`);
  }

  logOrchestration("batch complete");
  return result;
}

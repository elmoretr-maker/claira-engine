/**
 * Orchestration logging (env-gated). Does not alter pipeline results.
 */

import { WORKFLOW_MODULE_TO_SLOT } from "../config/orchestrationPipelineSlots.js";

/**
 * @returns {boolean}
 */
export function isOrchestrationLogEnabled() {
  const v = process.env.ASSET_ORCHESTRATION_LOG;
  return v === "1" || v === "true" || v === "yes";
}

/**
 * @param {string} line
 */
export function logOrchestration(line) {
  if (!isOrchestrationLogEnabled()) return;
  console.log(`[asset-orchestration] ${line}`);
}

/**
 * @param {{
 *   executionTrace?: Array<{ moduleId?: string, status?: string }>,
 * }} execution
 * @param {{ imageCount?: number }} meta
 */
export function logExecutionTraceSlots(execution, meta = {}) {
  if (!isOrchestrationLogEnabled()) return;
  const n = meta.imageCount;
  logOrchestration(
    `watcher triggered pipeline${typeof n === "number" ? ` (${n} image path(s))` : ""}`,
  );
  const trace = Array.isArray(execution?.executionTrace) ? execution.executionTrace : [];
  let i = 0;
  for (const row of trace) {
    if (row == null || typeof row !== "object") continue;
    const mid = String(/** @type {{ moduleId?: unknown }} */ (row).moduleId ?? "").trim();
    const st = String(/** @type {{ status?: unknown }} */ (row).status ?? "");
    if (!mid) continue;
    i += 1;
    const slot = WORKFLOW_MODULE_TO_SLOT[mid] ?? mid;
    if (mid === "basic_classifier") {
      logOrchestration(`step ${i}: ${slot} (${mid}) [perception / Hugging Face when provider active] → ${st}`);
    } else if (mid === "structured_output") {
      logOrchestration(`step ${i}: ${slot} (${mid}) → ${st}`);
    } else if (mid === "asset_validation") {
      logOrchestration(`step ${i}: ${slot} (${mid}) [filename vs labels / Review routing] → ${st}`);
    } else if (mid === "claira_reasoning") {
      logOrchestration(`step ${i}: ${slot} (${mid}) [Claira reasoning provider — refines routing inputs] → ${st}`);
    } else if (mid === "asset_router") {
      logOrchestration(`step ${i}: ${slot} (${mid}) [routing uses validation + classifier] → ${st}`);
    } else if (mid === "asset_mover") {
      logOrchestration(`step ${i}: ${slot} (${mid}) → ${st}`);
    } else {
      logOrchestration(`step ${i}: ${slot} (${mid}) → ${st}`);
    }
  }
}

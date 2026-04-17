/**
 * Phase 10 — Full workflow pipeline for folder-watcher ingestion (same module chain as Phase 9).
 */

import path from "node:path";
import {
  createInitialWorkflowBuildState,
  dispatchModuleRuntime,
} from "../state/workflowBuildState.js";
import { runWorkflowWithOutputSwitch } from "../output/outputSwitch.js";

/**
 * @param {string} cwd
 * @param {string} raw
 * @returns {string}
 */
function resolveIngestPath(cwd, raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  return path.resolve(cwd, s);
}

export const PHASE10_PIPELINE = [
  "image_input",
  "basic_classifier",
  "structured_output",
  "asset_validation",
  "claira_reasoning",
  "asset_router",
  "asset_mover",
  "simple_presentation",
];

/**
 * @param {{
 *   cwd?: string,
 *   imagePaths: string[],
 *   destinationRoot?: string,
 *   dryRun?: boolean,
 *   entityLabel?: string,
 *   feedback?: { immediateOverrides?: unknown[], persistCorrections?: boolean },
 * }} opts
 * @returns {Record<string, unknown>}
 */
export function buildPhase10WorkflowState(opts) {
  const cwd =
    typeof opts.cwd === "string" && opts.cwd.trim() ? path.resolve(opts.cwd.trim()) : process.cwd();
  const rawPaths = Array.isArray(opts.imagePaths) ? opts.imagePaths : [];
  const paths = rawPaths.map((p) => resolveIngestPath(cwd, String(p ?? ""))).filter(Boolean);

  let state = createInitialWorkflowBuildState();
  state = dispatchModuleRuntime(state, "image_input", "ingest", {
    paths,
    entityLabel:
      typeof opts.entityLabel === "string" && opts.entityLabel.trim()
        ? opts.entityLabel.trim()
        : "Folder watcher ingest",
  });

  const destinationRoot =
    typeof opts.destinationRoot === "string" && opts.destinationRoot.trim()
      ? opts.destinationRoot.trim()
      : "Assets";

  const dryRun = opts.dryRun === true;

  const feedback =
    opts.feedback != null && typeof opts.feedback === "object" && !Array.isArray(opts.feedback)
      ? /** @type {{ immediateOverrides?: unknown[], persistCorrections?: boolean }} */ (opts.feedback)
      : null;

  return {
    ...state,
    userSelections: PHASE10_PIPELINE,
    runtimePipelineConfig: {
      asset_mover: {
        dryRun,
        destinationRoot,
        cwd,
      },
      ...(feedback ? { feedback } : {}),
    },
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   imagePaths: string[],
 *   destinationRoot?: string,
 *   dryRun?: boolean,
 *   entityLabel?: string,
 *   feedback?: { immediateOverrides?: unknown[], persistCorrections?: boolean },
 * }} opts
 */
export async function runPhase10Pipeline(opts) {
  const state = buildPhase10WorkflowState(opts);
  return await runWorkflowWithOutputSwitch(state, { outputMode: "external" });
}

/**
 * Asset Orchestration Engine — slot labels for logging and future wiring.
 * Does not change workflow module IDs or execution order (see workflow `PHASE10_PIPELINE`).
 */

/** @type {Readonly<Record<string, string>>} */
export const WORKFLOW_MODULE_TO_SLOT = Object.freeze({
  image_input: "ingest",
  basic_classifier: "perception",
  structured_output: "structuring",
  asset_validation: "validation",
  claira_reasoning: "claira_reasoning",
  asset_router: "routing",
  asset_mover: "filesystem_move",
  simple_presentation: "output",
});

/** Target slot order (documentation). Perception (HF) maps to `basic_classifier`. */
export const DOCUMENTED_SLOT_ORDER = Object.freeze([
  "ingest",
  "perception",
  "structuring",
  "validation",
  "claira_reasoning",
  "routing",
  "filesystem_move",
  "output",
]);

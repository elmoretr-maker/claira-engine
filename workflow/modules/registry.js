/**
 * Module registry — whitelist of built-in modules (post_pipeline handlers).
 * Keys MUST match REGISTERED_WORKFLOW_MODULE_IDS in moduleRegistry.js (single source of truth).
 * Modules without post_pipeline are stubs (pipeline-only); ModuleHost only dispatches handlers for template-listed IDs.
 */

import { REGISTERED_WORKFLOW_MODULE_IDS } from "./moduleRegistry.js";
import { postPipelineEntityTracking } from "./entityTracking.js";
import { postPipelineAssetRegistry } from "./assetRegistry.js";
import { postPipelineEventLog } from "./eventLog.js";

/**
 * @typedef {{
 *   id: string,
 *   post_pipeline?: (snapshot: Readonly<Record<string, unknown>>, context: Record<string, unknown>) => void,
 *   ui?: Record<string, unknown>,
 *   data_schema?: Record<string, unknown>,
 * }} ModuleDefinition
 */

/** Modules that implement post_pipeline (SealedEngineOutput consumers). */
const POST_PIPELINE_HANDLERS = {
  entity_tracking: {
    id: "entity_tracking",
    post_pipeline: postPipelineEntityTracking,
    ui: {},
    data_schema: {},
  },
  asset_registry: {
    id: "asset_registry",
    post_pipeline: postPipelineAssetRegistry,
    ui: {},
    data_schema: {},
  },
  event_log: {
    id: "event_log",
    post_pipeline: postPipelineEventLog,
    ui: {},
    data_schema: {},
  },
};

/** @type {Record<string, ModuleDefinition>} */
export const moduleRegistry = {};

for (const id of REGISTERED_WORKFLOW_MODULE_IDS) {
  if (POST_PIPELINE_HANDLERS[id]) {
    moduleRegistry[id] = POST_PIPELINE_HANDLERS[id];
  } else {
    moduleRegistry[id] = { id, ui: {}, data_schema: {} };
  }
}

const registryKeyStr = Object.keys(moduleRegistry)
  .sort()
  .join(",");
const contractKeyStr = [...REGISTERED_WORKFLOW_MODULE_IDS].sort().join(",");
if (registryKeyStr !== contractKeyStr) {
  throw new Error(
    `workflow/modules/registry.js keys [${registryKeyStr}] must match moduleRegistry REGISTERED_WORKFLOW_MODULE_IDS [${contractKeyStr}]`,
  );
}

/**
 * @param {string} moduleId
 * @returns {ModuleDefinition | undefined}
 */
export function getModuleDefinition(moduleId) {
  return moduleRegistry[moduleId];
}

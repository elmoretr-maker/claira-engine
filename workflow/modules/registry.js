/**
 * Module registry — whitelist of built-in modules (post_pipeline handlers).
 * Modules consume SealedEngineOutput only; no pipeline imports.
 */

import { REGISTERED_WORKFLOW_MODULE_IDS } from "../validation/workflowTemplateContract.js";
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

/** @type {Record<string, ModuleDefinition>} */
export const moduleRegistry = {
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

const registryKeyStr = Object.keys(moduleRegistry)
  .sort()
  .join(",");
const contractKeyStr = [...REGISTERED_WORKFLOW_MODULE_IDS].sort().join(",");
if (registryKeyStr !== contractKeyStr) {
  throw new Error(
    `workflow/modules/registry.js keys [${registryKeyStr}] must match workflowTemplateContract [${contractKeyStr}]`,
  );
}

/**
 * @param {string} moduleId
 * @returns {ModuleDefinition | undefined}
 */
export function getModuleDefinition(moduleId) {
  return moduleRegistry[moduleId];
}

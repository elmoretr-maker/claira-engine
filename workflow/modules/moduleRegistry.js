/**
 * Single source of truth for workflow modules (IDs, contract, runtime slices).
 * Post-pipeline handlers remain in workflow/modules/registry.js (runtime execution).
 *
 * All modules must follow moduleContract. State logic must remain isolated per module.
 */

import { assertModuleFollowsContract } from "./moduleContract.js";
import { imageInputModule } from "./mvp/imageInputModule.js";
import { basicClassifierModule } from "./mvp/basicClassifierModule.js";
import { structuredOutputModule } from "./mvp/structuredOutputModule.js";
import { simplePresentationModule } from "./mvp/simplePresentationModule.js";
import { assetRouterModule } from "./mvp/assetRouterModule.js";
import { assetMoverModule } from "./mvp/assetMoverModule.js";
import { assetValidationModule } from "./mvp/assetValidationModule.js";
import { clairaReasoningModule } from "./mvp/clairaReasoningModule.js";
import { entityTrackingModule } from "./entityTrackingModule.js";
import { eventLogModule } from "./eventLogModule.js";
import { assetRegistryModule } from "./assetRegistryModule.js";
/* --- TEMPORARY: execution-engine validation only (workflow/modules/test_modules/) — delete block when removing tests --- */
import { testPassModule } from "./test_modules/testPassModule.js";
import { testDispatchModule } from "./test_modules/testDispatchModule.js";
import { testReaderModule } from "./test_modules/testReaderModule.js";
import { testErrorModule } from "./test_modules/testErrorModule.js";
/* --- end TEMPORARY test registry --- */

/** Stable order for selection, templates, and health reporting. */
export const REGISTERED_WORKFLOW_MODULE_IDS = Object.freeze(
  /** @type {readonly string[]} */ ([
    "image_input",
    "basic_classifier",
    "structured_output",
    "asset_validation",
    "claira_reasoning",
    "asset_router",
    "asset_mover",
    "simple_presentation",
    "entity_tracking",
    "asset_registry",
    "event_log",
    "test_pass",
    "test_dispatch",
    "test_error",
    "test_reader",
  ]),
);

export const MODULE_REGISTRY = Object.freeze({
  image_input: imageInputModule,
  basic_classifier: basicClassifierModule,
  structured_output: structuredOutputModule,
  asset_validation: assetValidationModule,
  claira_reasoning: clairaReasoningModule,
  asset_router: assetRouterModule,
  asset_mover: assetMoverModule,
  simple_presentation: simplePresentationModule,
  entity_tracking: entityTrackingModule,
  asset_registry: assetRegistryModule,
  event_log: eventLogModule,
  /* TEMPORARY — see imports above */
  test_pass: testPassModule,
  test_dispatch: testDispatchModule,
  test_error: testErrorModule,
  test_reader: testReaderModule,
});

function assertRegistryKeysAlign() {
  const keys = Object.keys(MODULE_REGISTRY)
    .sort()
    .join(",");
  const expected = [...REGISTERED_WORKFLOW_MODULE_IDS].sort().join(",");
  if (keys !== expected) {
    throw new Error(
      `MODULE_REGISTRY keys [${keys}] must match REGISTERED_WORKFLOW_MODULE_IDS [${expected}]`,
    );
  }
}

/**
 * Initial per-module slices for workflow build / runtime (immutable updates via reducers only).
 * @returns {Record<string, unknown>}
 */
export function createInitialModuleRuntimeState() {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const id of REGISTERED_WORKFLOW_MODULE_IDS) {
    const mod = MODULE_REGISTRY[id];
    out[id] = mod.state.initialize({});
  }
  return out;
}

/**
 * Validates registry shape, contract compliance, and id alignment.
 * Domain/preset references are checked in dev/validateModuleRegistry.mjs to avoid import cycles.
 * @throws {Error}
 */
export function validateModuleRegistry() {
  assertRegistryKeysAlign();
  const seen = new Set();
  for (const id of REGISTERED_WORKFLOW_MODULE_IDS) {
    if (seen.has(id)) throw new Error(`validateModuleRegistry: duplicate id ${id}`);
    seen.add(id);
    const mod = MODULE_REGISTRY[id];
    if (!mod) throw new Error(`validateModuleRegistry: missing module ${id}`);
    if (mod.id !== id) {
      throw new Error(`validateModuleRegistry: module key "${id}" !== mod.id "${mod.id}"`);
    }
    assertModuleFollowsContract(mod, id);
  }
}

validateModuleRegistry();

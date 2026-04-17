/**
 * Apply a module reducer immutably — the only supported way to change module slices.
 */

import { MODULE_REGISTRY, REGISTERED_WORKFLOW_MODULE_IDS } from "./moduleRegistry.js";

/**
 * @param {Record<string, unknown>} moduleRuntimeState
 * @param {string} moduleId
 * @param {string} reducerKey
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 */
export function applyModuleRuntimeReducer(moduleRuntimeState, moduleId, reducerKey, payload) {
  if (!REGISTERED_WORKFLOW_MODULE_IDS.includes(/** @type {*} */ (moduleId))) {
    return moduleRuntimeState;
  }
  const mod = MODULE_REGISTRY[moduleId];
  if (!mod) return moduleRuntimeState;
  const fn = /** @type {Record<string, Function>} */ (mod.state.reducers)[reducerKey];
  if (typeof fn !== "function") return moduleRuntimeState;
  const prev = moduleRuntimeState[moduleId];
  const next = fn(prev, payload);
  if (next === prev) return moduleRuntimeState;
  return { ...moduleRuntimeState, [moduleId]: next };
}

/**
 * Read-only module health — uses each module's health.check; never mutates state.
 */

import { MODULE_REGISTRY, REGISTERED_WORKFLOW_MODULE_IDS } from "./moduleRegistry.js";

/**
 * @param {{ moduleRuntimeState?: Record<string, unknown> } | Record<string, unknown>} state
 *   Full workflow state with moduleRuntimeState, or a raw runtime map.
 * @returns {Record<string, { status: string, issues: string[] }>}
 */
export function getModuleHealth(state) {
  const runtime =
    state && typeof state === "object" && "moduleRuntimeState" in state && state.moduleRuntimeState != null
      ? /** @type {{ moduleRuntimeState: Record<string, unknown> }} */ (state).moduleRuntimeState
      : /** @type {Record<string, unknown>} */ (state);

  /** @type {Record<string, { status: string, issues: string[] }>} */
  const out = {};

  for (const id of REGISTERED_WORKFLOW_MODULE_IDS) {
    const mod = MODULE_REGISTRY[id];
    const slice = runtime?.[id];
    const safeSlice = slice != null ? slice : mod.state.initialize({});
    out[id] = mod.health.check(safeSlice);
  }

  return out;
}

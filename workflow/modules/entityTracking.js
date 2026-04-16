/**
 * entity_tracking module — backs onto workflow/trainer/clientStore for persistence (transition).
 */

import { getTrainerClient } from "../trainer/clientStore.js";

/**
 * @param {import("../moduleHost/sealedEngineOutput.js").SealedEngineOutput} _snapshot
 * @param {{ entityId?: string, executionId?: string }} ctx
 */
export function postPipelineEntityTracking(_snapshot, ctx) {
  const entityId = String(ctx?.entityId ?? "").trim();
  if (!entityId) return;

  const r = getTrainerClient(entityId);
  if (!r.ok) {
    console.warn(`[module:entity_tracking] entity not found: ${entityId}`);
  }
}

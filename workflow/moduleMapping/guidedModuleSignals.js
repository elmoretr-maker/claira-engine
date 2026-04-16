/**
 * Guided “what to track” answers → module ids as affirmed intent signals (not a final selection).
 */

import { MODULE_SELECTION_ORDER } from "../contracts/workflowRules.js";

/**
 * @param {unknown} s — { trackPeople?: boolean, trackActivity?: boolean, trackFiles?: boolean }
 * @returns {string[]} registered module ids in selection order
 */
export function moduleIdsFromGuidedSignals(s) {
  if (s == null || typeof s !== "object") return [];
  const o = /** @type {Record<string, unknown>} */ (s);
  const raw = [];
  if (o.trackPeople === true) raw.push("entity_tracking");
  if (o.trackActivity === true) raw.push("event_log");
  if (o.trackFiles === true) raw.push("asset_registry");
  return MODULE_SELECTION_ORDER.filter((id) => raw.includes(id));
}

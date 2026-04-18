/**
 * Lightweight synonym boosts from tax comparison capability overrides (read-only store).
 */

import { getCapabilityOverrideEntriesForModule } from "../../feedback/feedbackStore.js";
import { scoreLineAgainstPhrase } from "./taxFieldMap.js";

const MODULE_ID = "tax_document_comparison";
const MAX_BOOST = 0.1;

/**
 * Extra score added to synonym match for a line (deterministic, capped).
 * @param {string} line
 * @param {string} fieldId
 * @returns {number}
 */
export function synonymLearningBoostForLine(line, fieldId) {
  const L = String(line ?? "");
  const fid = String(fieldId ?? "").trim();
  if (!L || !fid) return 0;

  const entries = getCapabilityOverrideEntriesForModule(MODULE_ID).slice(-120);
  let boost = 0;

  for (const ent of entries) {
    const rc = ent.reasoningContext;
    if (rc == null || typeof rc !== "object" || Array.isArray(rc)) continue;
    const bad = /** @type {Record<string, unknown>} */ (rc).incorrect;
    const good = /** @type {Record<string, unknown>} */ (rc).correct;
    if (bad == null || good == null || typeof bad !== "object" || typeof good !== "object") continue;

    const badEdits = Array.isArray(bad.edits) ? bad.edits : null;
    const goodEdits = Array.isArray(good.edits) ? good.edits : null;
    if (badEdits && goodEdits && badEdits.length > 0 && badEdits.length === goodEdits.length) {
      for (let i = 0; i < badEdits.length; i++) {
        const b = badEdits[i];
        const g = goodEdits[i];
        if (b == null || g == null || typeof b !== "object" || typeof g !== "object") continue;
        if (String(/** @type {Record<string, unknown>} */ (g).fieldId) !== fid) continue;
        const st = String(/** @type {Record<string, unknown>} */ (b).sourceText ?? "").trim();
        if (st.length >= 6 && L.includes(st.slice(0, Math.min(72, st.length)))) {
          boost += 0.02;
        }
        if (String(/** @type {Record<string, unknown>} */ (b).fieldId) !== String(/** @type {Record<string, unknown>} */ (g).fieldId) && st.length >= 4) {
          const s = scoreLineAgainstPhrase(L, st);
          if (s > 0.22) boost += 0.035;
        }
      }
      continue;
    }

    if (String(bad.kind) !== "tax_comparison_edit" || String(good.kind) !== "tax_comparison_edit") continue;
    if (String(good.fieldId) !== fid) continue;
    const st = String(bad.sourceText ?? "").trim();
    if (st.length >= 6 && L.includes(st.slice(0, Math.min(72, st.length)))) {
      boost += 0.025;
    }
    if (String(bad.fieldId) !== String(good.fieldId) && st.length >= 4) {
      const s = scoreLineAgainstPhrase(L, st);
      if (s > 0.22) boost += 0.04;
    }
  }

  return Math.min(MAX_BOOST, boost);
}

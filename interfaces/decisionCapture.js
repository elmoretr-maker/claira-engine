/**
 * User decision capture for learning vs Express Pass vs exemptions (no routing changes).
 */

import { applyDecision } from "../index.js";
import { recordExpressPass } from "../policies/expressPass.js";
import { recordExemption } from "../policies/exemptions.js";

/**
 * @param {{
 *   file?: string | null,
 *   selected_room: string,
 *   decision_type: "learning" | "express_pass" | "exemption",
 *   predicted_label?: string | null,
 *   confidence?: number }} payload
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function captureUserDecision(payload) {
  const selected = String(payload?.selected_room ?? "").trim();
  const type = String(payload?.decision_type ?? "").trim();
  const file = payload?.file != null ? String(payload.file) : "";
  const predicted = String(payload?.predicted_label ?? "").trim();

  if (!selected || !type) {
    return { ok: false, error: "selected_room and decision_type are required" };
  }

  try {
    if (type === "express_pass") {
      if (!predicted) return { ok: false, error: "predicted_label required for express_pass" };
      recordExpressPass(file, predicted, selected);
      return { ok: true };
    }
    if (type === "exemption") {
      if (!predicted) return { ok: false, error: "predicted_label required for exemption" };
      recordExemption(file, predicted, selected);
      return { ok: true };
    }
    if (type === "learning") {
      if (!predicted) return { ok: false, error: "predicted_label required for learning" };
      const scopeRaw = /** @type {{ scope?: unknown }} */ (payload).scope;
      const scope = scopeRaw === "single" ? "single" : "global";
      await applyDecision({
        predicted_label: predicted,
        selected_label: selected,
        confidence: payload.confidence,
        file: file || null,
        scope,
      });
      return { ok: true };
    }
    return { ok: false, error: `unknown decision_type: ${type}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

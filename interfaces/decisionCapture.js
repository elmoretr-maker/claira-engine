/**
 * Bridges submitDecision payloads to {@link applyDecision} — Express Pass, exemptions, and
 * learning share one engine entry (no duplicate policy writes).
 */

import { applyDecision } from "../index.js";

/**
 * @param {{
 *   file?: string | null,
 *   selected_room: string,
 *   decision_type: "learning" | "express_pass" | "exemption",
 *   predicted_label?: string | null,
 *   confidence?: number,
 *   scope?: "global" | "single",
 * }} payload
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
      const r = await applyDecision({
        decision_type: "express_pass",
        predicted_label: predicted || null,
        selected_label: selected,
        selected_room: selected,
        file: file || null,
        filePath: file || null,
      });
      return r.applied ? { ok: true } : { ok: false, error: r.error ?? "express_pass failed" };
    }
    if (type === "exemption") {
      if (!predicted) return { ok: false, error: "predicted_label required for exemption" };
      const r = await applyDecision({
        decision_type: "exemption",
        predicted_label: predicted || null,
        selected_label: selected,
        selected_room: selected,
        file: file || null,
        filePath: file || null,
      });
      return r.applied ? { ok: true } : { ok: false, error: r.error ?? "exemption failed" };
    }
    if (type === "learning") {
      if (!predicted) return { ok: false, error: "predicted_label required for learning" };
      const scopeRaw = /** @type {{ scope?: unknown }} */ (payload).scope;
      const scope = scopeRaw === "single" ? "single" : "global";
      const r = await applyDecision({
        decision_type: "learning",
        predicted_label: predicted,
        selected_label: selected,
        selected_room: selected,
        confidence: payload.confidence,
        file: file || null,
        filePath: file || null,
        scope,
      });
      return r.applied ? { ok: true } : { ok: false, error: r.error ?? "learning failed" };
    }
    return { ok: false, error: `unknown decision_type: ${type}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

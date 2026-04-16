/**
 * User control — execution / interruption layer only (Phase 6).
 * - force_review: may set decision to review after engine decision (never review→auto).
 * - bypass_review: when decision is review, execution_intent becomes auto; decision unchanged.
 *
 * Does not modify classification, confidence, or embeddings. Behavioral rules live here only;
 * Express Pass / exemptions remain logging / suggestions (see module headers there).
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const USER_CONTROL_PATH = join(__dirname, "userControl.json");
const BYPASS_LOG_PATH = join(__dirname, "..", "logs", "bypass_review.json");
const MAX_BYPASS_LOG = 5000;

/**
 * @param {unknown} raw
 */
export function normalizeUserControlLabel(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

function loadUserControlFile() {
  try {
    const raw = readFileSync(USER_CONTROL_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.rules)) return parsed;
  } catch {
    /* missing or invalid */
  }
  return { rules: [] };
}

function saveUserControlFile(data) {
  mkdirSync(dirname(USER_CONTROL_PATH), { recursive: true });
  writeFileSync(USER_CONTROL_PATH, JSON.stringify(data, null, 2), "utf8");
}

/**
 * @returns {{ rules: Array<{ predicted_label: string, effect: string, enabled?: boolean }> }}
 */
export function loadUserControlRules() {
  return loadUserControlFile();
}

/**
 * @param {{ predicted_label: string, effect: "force_review" | "bypass_review", enabled?: boolean }} rule
 */
export function setUserControlRule(rule) {
  const pred = normalizeUserControlLabel(rule.predicted_label);
  if (!pred) {
    throw new Error("setUserControlRule: predicted_label required");
  }
  const effect = String(rule.effect ?? "").trim();
  if (effect !== "force_review" && effect !== "bypass_review") {
    throw new Error("setUserControlRule: effect must be force_review or bypass_review");
  }
  const enabled = rule.enabled !== false;
  const data = loadUserControlFile();
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const idx = rules.findIndex(
    (r) =>
      normalizeUserControlLabel(r.predicted_label) === pred &&
      String(r.effect ?? "") === effect,
  );
  if (idx >= 0) {
    rules[idx] = { ...rules[idx], predicted_label: pred, effect, enabled };
  } else {
    rules.push({ predicted_label: pred, effect, enabled });
  }
  saveUserControlFile({ rules });
}

/**
 * Remove a rule by predicted_label + effect (UI delete).
 * @param {{ predicted_label: string, effect: "force_review" | "bypass_review" }} rule
 */
export function removeUserControlRule(rule) {
  const pred = normalizeUserControlLabel(rule.predicted_label);
  if (!pred) {
    throw new Error("removeUserControlRule: predicted_label required");
  }
  const effect = String(rule.effect ?? "").trim();
  if (effect !== "force_review" && effect !== "bypass_review") {
    throw new Error("removeUserControlRule: effect must be force_review or bypass_review");
  }
  const data = loadUserControlFile();
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const next = rules.filter(
    (r) =>
      !(
        normalizeUserControlLabel(r.predicted_label) === pred &&
        String(r.effect ?? "") === effect
      ),
  );
  saveUserControlFile({ rules: next });
}

/**
 * @returns {unknown[]}
 */
export function readBypassReviewLog() {
  try {
    const raw = readFileSync(BYPASS_LOG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {{
 *   original_decision: string,
 *   user_override: string,
 *   predicted_label: string,
 *   destination: string,
 *   timestamp: number,
 * }} entry
 */
export function appendBypassReviewLogEntry(entry) {
  mkdirSync(dirname(BYPASS_LOG_PATH), { recursive: true });
  const prev = readBypassReviewLog();
  prev.push(entry);
  const trimmed =
    prev.length > MAX_BYPASS_LOG ? prev.slice(prev.length - MAX_BYPASS_LOG) : prev;
  writeFileSync(BYPASS_LOG_PATH, JSON.stringify(trimmed, null, 2), "utf8");
}

/**
 * @param {{
 *   classification?: { predicted_label?: string | null } | null,
 *   routing?: { proposed_destination?: string | null } | null,
 *   decision?: { decision?: string, reason?: string } | null,
 * }} result
 * @returns {boolean}
 */
function hasForceReviewRule(result) {
  const pred = normalizeUserControlLabel(result.classification?.predicted_label);
  if (!pred) return false;
  const { rules } = loadUserControlFile();
  for (const r of rules) {
    if (r.enabled === false) continue;
    if (String(r.effect ?? "") !== "force_review") continue;
    if (normalizeUserControlLabel(r.predicted_label) === pred) return true;
  }
  return false;
}

/**
 * @param {{
 *   classification?: { predicted_label?: string | null } | null,
 *   decision?: { decision?: string } | null,
 * }} result
 * @returns {boolean}
 */
function hasBypassReviewRule(result) {
  if (result.decision?.decision !== "review") return false;
  const pred = normalizeUserControlLabel(result.classification?.predicted_label);
  if (!pred) return false;
  const { rules } = loadUserControlFile();
  for (const r of rules) {
    if (r.enabled === false) continue;
    if (String(r.effect ?? "") !== "bypass_review") continue;
    if (normalizeUserControlLabel(r.predicted_label) === pred) return true;
  }
  return false;
}

/**
 * Apply user control after all decision mutations (e.g. tunnel expectedCategory) and before place card / execution.
 * Mutates `result` in place: may set decision to review (force only), sets `execution`, optional `user_control`.
 *
 * @param {{
 *   classification?: { predicted_label?: string | null } | null,
 *   routing?: { proposed_destination?: string | null } | null,
 *   decision?: { decision?: string, reason?: string } | null,
 * error?: string,
 * }} result
 */
export function applyUserControlAfterDecision(result) {
  if (!result || result.error || !result.decision || typeof result.decision !== "object") {
    return;
  }

  const dec = result.decision.decision;
  if (dec === "error") {
    return;
  }
  if (dec !== "auto" && dec !== "review") {
    return;
  }

  delete result.user_control;
  const forceMatched = hasForceReviewRule(result);

  if (forceMatched) {
    const priorDecision = result.decision.decision;
    const priorReason = result.decision.reason ?? null;
    result.decision = { decision: "review", reason: "user_control_force_review" };
    result.user_control = {
      forced_review: true,
      prior_decision: priorDecision,
      prior_reason: priorReason,
    };
    result.execution = {
      execution_intent: "interrupt",
      user_override: null,
    };
    return;
  }

  const bypassMatched = hasBypassReviewRule(result);
  if (bypassMatched) {
    result.execution = {
      execution_intent: "auto",
      user_override: "bypass_review",
    };
    return;
  }

  result.execution = {
    execution_intent: dec === "review" ? "interrupt" : "auto",
    user_override: null,
  };
}

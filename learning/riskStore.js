/**
 * In-memory risk signals (fingerprinted per predicted label + failure mode).
 * Confusion pair tracking; adjusts confidence/margin in analyze() — no embedding/classifier changes.
 */

import { inferPatternMismatchDetails } from "./patternMismatchSeverity.js";

/** @typedef {"high" | "medium" | "low"} RiskSeverity */

/**
 * @typedef {{
 *   penalty: number,
 *   examples: string[],
 *   updatedAt: number,
 *   fingerprint: string,
 *   severity: RiskSeverity,
 * }} RiskEntry
 */

/** Max stored penalty per fingerprint bucket before strict amplification. */
const MAX_PENALTY_STORED = 0.28;
/** Max subtraction applied to confidence (after strict + confusion, capped). */
const MAX_APPLIED_CONFIDENCE = 0.36;

const PENALTY_INCREMENT = {
  high: 0.06,
  medium: 0.045,
  low: 0.02,
};

const DECAY_TAU_MS = 10 * 24 * 60 * 60 * 1000;
const STRICT_MULTIPLIER = 1.35;
const MARGIN_RATIO = 0.55;

/** Aggregated store penalty above this contributes to risk_context.warning */
const RISK_WARNING_AGGREGATE = 0.1;

/** Below this (after decay), treat stored risk as fully recovered for subtraction. */
const RECOVERY_EPSILON = 0.012;

const CONFUSION_STEP = 0.025;
const MAX_CONFUSION_BONUS = 0.08;

/** @type {Map<string, RiskEntry>} key = `${pred}::${fingerprint}` */
const riskByKey = new Map();

/** @type {Map<string, number>} key = `${pred}→${selected}` */
const confusionCounts = new Map();

/**
 * @param {unknown} raw
 */
function normLabel(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return s && s !== "unknown" ? s : "";
}

/**
 * @param {string} pred
 * @param {string} sel
 */
function confusionPairKey(pred, sel) {
  return `${normLabel(pred)}→${normLabel(sel)}`;
}

/**
 * @param {RiskEntry} entry
 * @param {number} now
 */
function decayPenalty(entry, now) {
  const elapsed = now - entry.updatedAt;
  if (elapsed <= 0) return entry.penalty;
  return entry.penalty * Math.exp(-elapsed / DECAY_TAU_MS);
}

/**
 * @param {string} pred
 * @param {string} fingerprint
 */
function storeKey(pred, fingerprint) {
  const p = normLabel(pred);
  const fp = String(fingerprint ?? "pattern_uncertain")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "") || "pattern_uncertain";
  return `${p}::${fp}`;
}

/**
 * @param {string} pred
 * @param {string | null | undefined} secondLabel
 */
function getConfusionBonus(pred, secondLabel) {
  const s = normLabel(secondLabel);
  if (!s) return 0;
  const c = confusionCounts.get(confusionPairKey(pred, s)) ?? 0;
  if (c < 2) return 0;
  return Math.min(MAX_CONFUSION_BONUS, (c - 1) * CONFUSION_STEP);
}

/**
 * @param {{
 *   predicted_label?: string | null,
 *   selected_label?: string | null,
 *   context?: string | null,
 *   classification?: object | null,
 *   severity?: RiskSeverity,
 *   fingerprint?: string | null,
 *   reason?: string | null,
 * }} payload
 */
export function addRiskSignal(payload) {
  const pred = normLabel(payload.predicted_label);
  const sel = normLabel(payload.selected_label);
  if (!pred || !sel || pred === sel) return;

  const inferred = inferPatternMismatchDetails({
    predicted_label: pred,
    extractedText: payload.context,
    classification: payload.classification ?? null,
  });

  const severity =
    payload.severity === "high" || payload.severity === "medium" || payload.severity === "low"
      ? payload.severity
      : inferred.severity;

  const fingerprintRaw =
    payload.fingerprint != null && String(payload.fingerprint).trim()
      ? String(payload.fingerprint).trim()
      : inferred.fingerprint;

  const increment = PENALTY_INCREMENT[severity] ?? PENALTY_INCREMENT.medium;
  const key = storeKey(pred, fingerprintRaw);
  const now = Date.now();
  const fpNorm = key.includes("::") ? key.slice(key.indexOf("::") + 2) : fingerprintRaw;
  const cur = riskByKey.get(key) ?? {
    penalty: 0,
    examples: [],
    updatedAt: now,
    fingerprint: fpNorm,
    severity,
  };
  const decayed = decayPenalty(cur, now);
  cur.penalty = Math.min(MAX_PENALTY_STORED, decayed + increment);
  cur.updatedAt = now;
  cur.fingerprint = fpNorm;
  cur.severity = severity;
  const ctx = String(payload.context ?? "").trim().slice(0, 240);
  if (ctx && cur.examples.length < 16) cur.examples.push(ctx);
  riskByKey.set(key, cur);

  const ck = confusionPairKey(pred, sel);
  confusionCounts.set(ck, (confusionCounts.get(ck) ?? 0) + 1);

  console.log(`Risk signal: ${pred} (${fpNorm}, ${severity})`);
  console.log(`Confusion tracked: ${pred} → ${sel}`);
}

/**
 * Max decayed penalty + high-severity flag for label across all fingerprints.
 * @param {string | null | undefined} label
 * @param {number} now
 */
function aggregateStoredRisk(label, now) {
  const p = normLabel(label);
  if (!p) return { maxDecayed: 0, hasHigh: false, keys: /** @type {string[]} */ ([]) };
  const prefix = `${p}::`;
  let maxDecayed = 0;
  let hasHigh = false;
  /** @type {string[]} */
  const keys = [];
  for (const [key, entry] of riskByKey) {
    if (!key.startsWith(prefix)) continue;
    keys.push(key);
    const d = decayPenalty(entry, now);
    maxDecayed = Math.max(maxDecayed, d);
    if (entry.severity === "high" && d > RECOVERY_EPSILON) hasHigh = true;
  }
  return { maxDecayed, hasHigh, keys };
}

/**
 * @param {string | null | undefined} label
 * @param {{ oversightLevel?: string, second_label?: string | null }} [opts]
 * @returns {{ confidenceDelta: number, marginDelta: number, rawAggregate: number, confusionBonus: number }}
 */
export function getRiskPenaltyForLabel(label, opts = {}) {
  const k = normLabel(label);
  if (!k) {
    return { confidenceDelta: 0, marginDelta: 0, rawAggregate: 0, confusionBonus: 0 };
  }

  const now = Date.now();
  const { maxDecayed } = aggregateStoredRisk(k, now);
  const confusionBonus = getConfusionBonus(k, opts.second_label);

  if (maxDecayed < RECOVERY_EPSILON && confusionBonus <= 0) {
    return { confidenceDelta: 0, marginDelta: 0, rawAggregate: maxDecayed, confusionBonus: 0 };
  }

  let effective = Math.min(MAX_PENALTY_STORED, maxDecayed) + confusionBonus;
  effective = Math.min(MAX_PENALTY_STORED + MAX_CONFUSION_BONUS, effective);

  if (String(opts.oversightLevel ?? "").toLowerCase() === "strict") {
    effective *= STRICT_MULTIPLIER;
  }
  effective = Math.min(MAX_APPLIED_CONFIDENCE, effective);

  return {
    confidenceDelta: effective,
    marginDelta: effective * MARGIN_RATIO,
    rawAggregate: maxDecayed,
    confusionBonus,
  };
}

/**
 * @param {object} classification
 * @param {{
 *   oversightLevel?: string,
 *   extractedText?: string | null,
 * }} runtimeCtx
 */
export function applyRiskAdjustment(classification, runtimeCtx = {}) {
  if (!classification || typeof classification !== "object") return classification;

  const label = classification.predicted_label;
  const second = classification.second_label;

  const live = inferPatternMismatchDetails({
    predicted_label: label,
    extractedText: runtimeCtx.extractedText,
    classification,
  });

  const { confidenceDelta, marginDelta, confusionBonus } = getRiskPenaltyForLabel(label, {
    oversightLevel: runtimeCtx.oversightLevel,
    second_label: second,
  });

  const now = Date.now();
  const { maxDecayed, hasHigh, keys } = aggregateStoredRisk(
    typeof label === "string" ? label : null,
    now,
  );

  const warning =
    confidenceDelta > RISK_WARNING_AGGREGATE || live.severity === "high" || hasHigh;

  const appliedPenalty = confidenceDelta > RECOVERY_EPSILON;

  let conf =
    typeof classification.confidence === "number" && Number.isFinite(classification.confidence)
      ? classification.confidence
      : 0;
  let margin =
    typeof classification.margin === "number" && Number.isFinite(classification.margin)
      ? classification.margin
      : 0;

  if (appliedPenalty) {
    conf = Math.max(0, Math.min(1, conf - confidenceDelta));
    margin = Math.max(0, Math.min(1, margin - marginDelta));
  }

  /** @type {Record<string, unknown>} */
  const risk_context = {
    ...(classification.risk_context && typeof classification.risk_context === "object"
      ? classification.risk_context
      : {}),
    warning,
    applied: appliedPenalty,
    confidence_delta: appliedPenalty ? confidenceDelta : 0,
    margin_delta: appliedPenalty ? marginDelta : 0,
    label: normLabel(label) || String(label ?? ""),
    live_pattern: {
      severity: live.severity,
      reason: live.reason,
      fingerprint: live.fingerprint,
    },
    stored_aggregate: Number(maxDecayed.toFixed(6)),
    confusion_bonus: confusionBonus,
    fingerprint_keys: keys,
 };

  return {
    ...classification,
    confidence: conf,
    margin,
    risk_context,
  };
}

/**
 * @returns {Record<string, { penalty: number, examples: string[], fingerprint: string, severity: string }>}
 */
export function getRiskStoreSnapshot() {
  /** @type {Record<string, { penalty: number, examples: string[], fingerprint: string, severity: string }>} */
  const out = {};
  const now = Date.now();
  for (const [key, v] of riskByKey) {
    out[key] = {
      penalty: Number(decayPenalty(v, now).toFixed(6)),
      examples: [...v.examples],
      fingerprint: v.fingerprint,
      severity: v.severity,
    };
  }
  return out;
}

/**
 * UI / API: per-category risk summary and top confusion pairs.
 */
export function getRiskInsights() {
  const now = Date.now();
  /** @type {Map<string, { maxPenalty: number, fingerprints: Array<{ key: string, fingerprint: string, penalty: number, severity: string, examples: string[] }>, examples: string[] }>} */
  const byLabel = new Map();

  for (const [key, entry] of riskByKey) {
    const idx = key.indexOf("::");
    if (idx < 0) continue;
    const label = key.slice(0, idx);
    const dec = decayPenalty(entry, now);
    if (dec < RECOVERY_EPSILON) continue;

    let agg = byLabel.get(label);
    if (!agg) {
      agg = { maxPenalty: 0, fingerprints: [], examples: [] };
      byLabel.set(label, agg);
    }
    agg.maxPenalty = Math.max(agg.maxPenalty, dec);
    agg.fingerprints.push({
      key,
      fingerprint: entry.fingerprint,
      penalty: Number(dec.toFixed(6)),
      severity: entry.severity,
      examples: [...entry.examples].slice(0, 4),
    });
    for (const ex of entry.examples.slice(0, 2)) {
      if (agg.examples.length < 8) agg.examples.push(ex);
    }
  }

  /** @param {number} p */
  function levelFor(p) {
    if (p >= 0.18) return "high";
    if (p >= 0.08) return "medium";
    return "low";
  }

  const categories = [...byLabel.entries()].map(([label, v]) => ({
    label,
    riskLevel: levelFor(v.maxPenalty),
    maxPenalty: v.maxPenalty,
    fingerprints: v.fingerprints,
    recentExamples: v.examples,
  }));

  const confusionPairs = [...confusionCounts.entries()]
    .filter(([, n]) => n >= 1)
    .map(([k, count]) => {
      const arrow = k.indexOf("→");
      return {
        predicted: arrow > 0 ? k.slice(0, arrow) : k,
        selected: arrow > 0 ? k.slice(arrow + "→".length) : "",
        count,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 24);

  return { categories, confusionPairs, generatedAt: new Date().toISOString() };
}

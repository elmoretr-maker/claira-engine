/**
 * EntityDetailPanel.jsx
 *
 * Phase 2 — Entity Detail Panel (final UX refinement pass).
 *
 * Layout: 6 sections in a structured grid
 *   ┌──────────────────────── Impact (full-width) ─────────────────────────┐
 *   │  State   │  Trend   │  Recommendation  │  Rank Context               │
 *   └──────────────────────── Insights (full-width) ──────────────────────┘
 *
 * Refinements applied:
 *   FIX 1 — rewriteImpact() is data-driven and includes implied action
 *   FIX 2 — Data completeness indicator (High/Medium/Low) shown in Trend
 *   FIX 3 — "Over the last X days" time context in Trend
 *   FIX 4 — Recommendation hierarchy: Action (bold) → Urgency → Reason
 *   FIX 5 — Relative rank context: "Top X%", "Bottom X%", or "#N of M"
 *   FIX 6 — Insights placeholder with improved helper text
 */

import "./EntityPerformance.css";
import { ActionPill, UrgencyChip, AlertBadge } from "./EntityPerformanceAtoms.jsx";
import { wellnessActionLabel } from "../utils/wellnessAnalysis.js";

const MS_PER_DAY = 86_400_000;

// ── Value formatters ──────────────────────────────────────────────────────────

/** Format with locale-aware thousands separator; returns "—" for non-finite. */
function n(v, fallback = "—") {
  if (!Number.isFinite(v)) return fallback;
  return v.toLocaleString();
}

/** Format decimal to N places; returns fallback if non-finite or zero. */
function dec(v, places = 1, fallback = "—") {
  if (!Number.isFinite(v) || v === 0) return fallback;
  return v.toFixed(places);
}

/** Format with mandatory +/− sign prefix. */
function signed(v) {
  if (!Number.isFinite(v)) return "—";
  if (v > 0) return `+${v.toLocaleString()}`;
  if (v < 0) return `−${Math.abs(v).toLocaleString()}`;
  return "0";
}

/** Format ISO date to "Apr 22, 2026". Returns "—" for invalid input. */
function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch { return "—"; }
}

/** Absolute daily rate from velocityPerTime (per ms). Null if zero/invalid. */
function toPerDay(vpt) {
  if (!Number.isFinite(vpt) || vpt === 0) return null;
  return Math.abs(vpt) * MS_PER_DAY;
}

// ── Impact generator ─────────────────────────────────────────────────────────

/**
 * Language intensity map for magnitude tiers (FIX 6).
 * Keeps wording proportional to the scale of change — avoids alarming language
 * for small shifts and under-representing genuinely large changes.
 *
 * DO NOT use industry-specific words ("stockout", "inventory") here.
 * All entries must remain domain-neutral (RULE 7).
 */
const MAGNITUDE_PHRASES = Object.freeze({
  significant: { decline: "significant drop",  gain: "notable increase"  },
  moderate:    { decline: "noticeable decline", gain: "meaningful gain"   },
  small:       { decline: "slight decrease",    gain: "modest gain"       },
});

/**
 * Map an absolute change to a magnitude tier using the current level as reference.
 *
 * Relative thresholds (when reference is valid and > 0):
 *   >= 25% → "significant"
 *   >= 10% → "moderate"
 *   <  10% → "small"
 *
 * Absolute fallback (when reference is unavailable):
 *   >= 100 → "significant", >= 20 → "moderate", else "small"
 *
 * @param {number} absChange  — Math.abs(netDelta)
 * @param {number} reference  — current level (endValue), used as denominator
 * @returns {"significant"|"moderate"|"small"|null}
 */
function magnitudeTier(absChange, reference) {
  if (!Number.isFinite(absChange) || absChange === 0) return null;
  if (Number.isFinite(reference) && reference > 0) {
    const ratio = absChange / reference;
    if (ratio >= 0.25) return "significant";
    if (ratio >= 0.10) return "moderate";
    return "small";
  }
  if (absChange >= 100) return "significant";
  if (absChange >= 20)  return "moderate";
  return "small";
}

/**
 * Append a parenthetical relative-percentage annotation when the reference
 * level is reliable (FIX 3). Returns "" (no annotation) in edge cases to
 * prevent misleading percentages (e.g. reference = 0, or pct > 500%).
 *
 * Only include percentage if denominator is reliable and non-zero (RULE from spec).
 *
 * @param {number} change     — delta (sign ignored internally)
 * @param {number} reference  — current level (endValue)
 * @returns {string}  e.g. " (~18% of current level)" or ""
 */
function pctOf(change, reference) {
  if (!Number.isFinite(change) || !Number.isFinite(reference) || reference <= 0) return "";
  const pct = Math.round(Math.abs(change) / reference * 100);
  if (pct < 1 || pct > 500) return ""; // omit unreliable extremes
  return ` (~${pct}% of current level)`;
}

/**
 * Classify the activity pattern AND trend stability of an entity.
 *
 * ─── FEEDBACK PRECEDENCE MODEL (FIX 5) ─────────────────────────────────────
 * Priority order when integrating future user feedback:
 *   1. userFeedback overrides  (highest — explicit user context overrides data)
 *   2. guardrails              (structural data conditions, rule-based)
 *   3. computed classification (lowest — deterministically inferred from data)
 *
 * The optional `feedbackOverrides` parameter is the intended seam for Priority 1.
 * It accepts the same flag names returned by this function. Currently unused —
 * all values are computed deterministically. No persistence or state is added.
 *
 * [FEEDBACK_HOOK] Future (Priority 1):
 *   - feedbackOverrides.hasSustainedTrend = false → if user marks 'seasonal spike'
 *   - feedbackOverrides.isVolatile = true          → if user marks 'erratic supply'
 *   - feedbackOverrides.isRecentSpike = true        → if user marks 'one-off event'
 *
 * @param {object} entity
 * @param {object} [feedbackOverrides]  — future hook; ignored today
 * @returns {{
 *   hasSales: boolean, hasDeliveries: boolean,
 *   outpacing: boolean, surplus: boolean, onlyDeliveries: boolean,
 *   onlySales: boolean, noActivity: boolean,
 *   lossAmt: number|null, gainAmt: number|null, activityGap: number|null,
 *   magnitude: "significant"|"moderate"|"small"|null,
 *   hasSustainedTrend: boolean, isRecentSpike: boolean, isVolatile: boolean,
 * }}
 */
function classifyActivity(entity, feedbackOverrides = {}) {
  const { salesTotal, deliveryTotal, netDelta, periodCount, endValue } = entity;

  // ── Activity booleans ─────────────────────────────────────────────────────
  const hasSales       = Number.isFinite(salesTotal)    && salesTotal    > 0;
  const hasDeliveries  = Number.isFinite(deliveryTotal) && deliveryTotal > 0;
  const outpacing      = hasSales && hasDeliveries && salesTotal > deliveryTotal;
  const surplus        = hasSales && hasDeliveries && deliveryTotal > salesTotal;
  const onlyDeliveries = hasDeliveries && !hasSales;
  const onlySales      = hasSales && !hasDeliveries;
  const noActivity     = !hasSales && !hasDeliveries;
  const lossAmt        = Number.isFinite(netDelta) && netDelta < 0 ? Math.abs(netDelta) : null;
  const gainAmt        = Number.isFinite(netDelta) && netDelta > 0 ? netDelta : null;
  const activityGap    = outpacing ? salesTotal - deliveryTotal : null;

  // ── Magnitude ─────────────────────────────────────────────────────────────
  const changeAmt = lossAmt ?? gainAmt ?? 0;
  const ref       = Number.isFinite(endValue) && endValue > 0 ? endValue : 0;
  const magnitude = magnitudeTier(changeAmt, ref);

  // ── Stability signals (FIX 1) ─────────────────────────────────────────────
  //
  // hasSustainedTrend: 3+ snapshots = at least 2 intervals, so direction is
  //   observable across time rather than a single start-to-end comparison.
  //   Strong recommendations are ONLY allowed when this is true (FIX 4).
  const hasSustainedTrend =
    feedbackOverrides.hasSustainedTrend ??
    (Number.isFinite(periodCount) && periodCount >= 3);

  // isRecentSpike: only 2 data points AND the change is "significant" — could
  //   be a single large event rather than a repeating trend. Soften language.
  const isRecentSpike =
    feedbackOverrides.isRecentSpike ??
    (!hasSustainedTrend && magnitude === "significant");

  // isVolatile: total gross activity is >5× the absolute net change — lots of
  //   units flowing in and out but a small net result, indicating churn or
  //   unstable supply/demand balance. Reduces confidence in directional claims.
  const totalActivity = (hasSales ? salesTotal : 0) + (hasDeliveries ? deliveryTotal : 0);
  const isVolatile =
    feedbackOverrides.isVolatile ??
    (totalActivity > 0 && changeAmt > 0 && totalActivity / changeAmt > 5);

  return {
    hasSales, hasDeliveries,
    outpacing, surplus, onlyDeliveries, onlySales, noActivity,
    lossAmt, gainAmt, activityGap,
    magnitude, hasSustainedTrend, isRecentSpike, isVolatile,
  };
}

/**
 * Compute combined confidence from data completeness AND trend stability (FIX 2).
 *
 * Replaces the single-source `confidencePrefix` from the previous pass.
 * Now accounts for whether the trend signal itself is reliable, not just
 * whether the data volume is sufficient.
 *
 * Combined model:
 *   high completeness + stable trend   → HIGH  ("Based on consistent activity...")
 *   high completeness + volatile       → MEDIUM ("Based on available data...")
 *   medium completeness + stable       → MEDIUM
 *   medium completeness + volatile     → LOW   (short-circuit to limited-data notice)
 *   low completeness (any stability)   → LOW   (always overrides)
 *
 * [FEEDBACK_HOOK] Future (Priority 1): if entity.userFeedback === 'data_confirmed',
 * allow upgrading LOW → MEDIUM when user explicitly verifies data accuracy.
 * [FEEDBACK_HOOK] Future (Priority 1): if entity.repeatedPattern === true,
 * prefix with "Consistent with previous periods, " at HIGH level.
 *
 * @param {{ level: "high"|"medium"|"low" }} completeness
 * @param {ReturnType<classifyActivity>} flags
 * @returns {{ level: "high"|"medium"|"low", prefix: string }}
 */
function computeConfidence(completeness, flags) {
  if (completeness.level === "low") {
    return { level: "low", prefix: "" };
  }
  const isStable = flags.hasSustainedTrend && !flags.isVolatile && !flags.isRecentSpike;
  if (completeness.level === "high" && isStable) {
    return { level: "high", prefix: "Based on consistent activity over this period, " };
  }
  if (completeness.level === "medium" && !isStable) {
    return { level: "low", prefix: "" };
  }
  return { level: "medium", prefix: "Based on available data and recent trends, " };
}

/**
 * Determine whether a "reorder / replenishment" action is supported by data.
 *
 * RULE 2 guardrail (Priority 2 in feedback model).
 * All five conditions must be true simultaneously:
 *   - netDelta < 0              (levels are actively declining)
 *   - hasSales > 0              (decline is demand-driven, not unexplained)
 *   - confidence !== "low"      (data is reliable enough to act on)
 *   - action !== "monitor"      (engine assessment must not contradict — RULE 6)
 *   - hasSustainedTrend         (FIX 4 — not a one-off event; trend is repeating)
 *
 * [FEEDBACK_HOOK] Future (Priority 1):
 *   entity.userFeedback === 'supply_unavailable' → return false regardless of data
 *   entity.userFeedback === 'reorder_confirmed'  → relax hasSustainedTrend requirement
 *
 * @param {object} entity
 * @param {{ level: string }} confidence
 * @param {ReturnType<classifyActivity>} flags
 * @returns {boolean}
 */
function reorderGuardrailMet(entity, confidence, flags) {
  const { netDelta, action } = entity;
  return (
    Number.isFinite(netDelta) && netDelta < 0 &&
    flags.hasSales &&
    confidence.level !== "low" &&
    action !== "monitor" &&
    flags.hasSustainedTrend // FIX 4 — unstable trend = no strong reorder signal
  );
}

/**
 * Determine whether a "promote" action is supported by data.
 *
 * RULE 2 guardrail (Priority 2):
 *   - direction is "up"
 *   - salesTotal > 0  (growth has a demand component, not only deliveries)
 *   - hasSustainedTrend (FIX 4 — spike-only growth should not trigger promotion)
 *
 * [FEEDBACK_HOOK] Future (Priority 1):
 *   entity.userFeedback === 'capacity_constrained' → return false
 *
 * @param {object} entity
 * @param {ReturnType<classifyActivity>} flags
 * @returns {boolean}
 */
function promoteGuardrailMet(entity, flags) {
  const { direction } = entity;
  return direction === "up" && flags.hasSales && flags.hasSustainedTrend;
}

/**
 * Generate a 1–2 sentence plain-language explanation grounded in actual data.
 *
 * All 8 rules enforced; all 7 fixes from this pass applied.
 * Signature is unchanged from the previous pass — only internal logic updated.
 *
 * [FEEDBACK_HOOK] Future (Priority 1): pass entity.userFeedback into
 * classifyActivity(entity, parsedFeedbackOverrides) before calling this function.
 *
 * @param {object} entity
 * @param {{ level: "high"|"medium"|"low" }} completeness  — from computeCompleteness()
 * @returns {string}
 */
function rewriteImpact(entity, completeness) {
  const { direction, urgency, salesTotal, deliveryTotal, endValue, reason } = entity;
  const f          = classifyActivity(entity);
  const confidence = computeConfidence(completeness, f);

  // ── Low confidence: short-circuit before any analysis language (RULE 3) ──
  if (confidence.level === "low") {
    // [FEEDBACK_HOOK] Future: skip if entity.userFeedback === 'data_confirmed'
    return "Limited data is available — results may not fully reflect performance. Consider adding more measurements or activity records to improve reliability.";
  }

  const { prefix } = confidence;
  const canOrder   = reorderGuardrailMet(entity, confidence, f);
  const canPromote = promoteGuardrailMet(entity, f);

  // FIX 4 — Spike/instability dampener.
  // When the trend is not yet sustained, suppress specific action language and
  // append a monitoring note instead of implying a decision.
  const isDampened = f.isRecentSpike || !f.hasSustainedTrend;
  const spikeNote  = " This change appears to be based on a limited number of observations — monitoring the trend before taking action may be advisable.";

  // FIX 3 — Relative magnitude annotations (omitted when reference is unreliable)
  const pctLoss = f.lossAmt !== null ? pctOf(f.lossAmt, endValue) : "";
  const pctGain = f.gainAmt !== null ? pctOf(f.gainAmt, endValue) : "";

  // FIX 6 — Magnitude-aligned word selection
  const tier       = f.magnitude ?? "moderate";
  const declineWord = MAGNITUDE_PHRASES[tier]?.decline ?? "decline";
  const gainWord    = MAGNITUDE_PHRASES[tier]?.gain    ?? "gain";

  // ── RULE 5: Explicit edge cases always resolved first ────────────────────

  if (f.noActivity) {
    if (direction === "down" && f.lossAmt !== null) {
      return `${prefix}this item experienced a ${declineWord} of ${f.lossAmt.toLocaleString()}${pctLoss} without any recorded activity this period. This may indicate an unrecorded removal or a data gap — confirm accuracy before drawing conclusions.`;
    }
    return `${prefix}no outgoing or incoming activity was recorded this period. Confirm whether this is expected or whether data may be missing from your records.`;
  }

  if (f.onlyDeliveries) {
    if (f.gainAmt !== null) {
      return `${prefix}this item received ${deliveryTotal.toLocaleString()} units with no outgoing activity, resulting in a ${gainWord} of ${f.gainAmt.toLocaleString()}${pctGain} this period. Verify that demand exists before continuing at this replenishment rate.`;
    }
    return `${prefix}incoming activity was recorded without any outgoing activity this period. Verify that demand exists — holding stock without corresponding outgoing activity may indicate an imbalance.`;
  }

  if (f.onlySales) {
    const actionClause = canOrder
      ? "reviewing supply options or scheduling replenishment may be advisable"
      : "reviewing current levels is recommended";
    if (f.lossAmt !== null) {
      return `${prefix}${salesTotal.toLocaleString()} units of outgoing activity caused a ${declineWord} of ${f.lossAmt.toLocaleString()}${pctLoss} with no recorded incoming replenishment. ${cap(actionClause)}.${isDampened ? spikeNote : ""}`;
    }
    return `${prefix}outgoing activity occurred with no incoming replenishment recorded this period. ${cap(actionClause)}.${isDampened ? spikeNote : ""}`;
  }

  // ── Critical decline ─────────────────────────────────────────────────────
  if (direction === "down" && urgency === "critical") {
    if (f.outpacing && f.activityGap !== null && f.lossAmt !== null) {
      const orderClause = isDampened
        ? spikeNote
        : canOrder
          ? " Reviewing supply options promptly may help prevent a stockout."
          : " Consider reviewing current levels and supply availability.";
      return `${prefix}outgoing activity exceeded incoming replenishment by ${f.activityGap.toLocaleString()} units, resulting in a ${declineWord} of ${f.lossAmt.toLocaleString()}${pctLoss} this period.${orderClause}`;
    }
    if (f.lossAmt !== null) {
      const reviewClause = isDampened
        ? spikeNote
        : " An immediate review of supply options is strongly advised.";
      return `${prefix}this item experienced a ${declineWord} of ${f.lossAmt.toLocaleString()}${pctLoss} this period — currently flagged as the highest priority concern.${reviewClause}`;
    }
    return `${prefix}this item is at critical risk.${isDampened ? spikeNote : " An immediate review of supply, demand, and current levels is strongly advised."}`;
  }

  // ── High urgency decline ─────────────────────────────────────────────────
  if (direction === "down" && urgency === "high") {
    if (f.outpacing && f.activityGap !== null && f.lossAmt !== null) {
      const orderClause = isDampened
        ? spikeNote
        : canOrder
          ? " Considering replenishment options before the next period may prevent a shortage."
          : " Reviewing current levels and supply timing is recommended.";
      return `${prefix}outgoing activity (${salesTotal.toLocaleString()}) outpaced incoming replenishment (${deliveryTotal.toLocaleString()}), with a ${declineWord} of ${f.lossAmt.toLocaleString()}${pctLoss} this period.${orderClause}`;
    }
    if (f.lossAmt !== null) {
      return `${prefix}this item experienced a ${declineWord} of ${f.lossAmt.toLocaleString()}${pctLoss} this period. While not yet critical, the trend is worth addressing — reviewing the replenishment schedule may help.${isDampened ? spikeNote : ""}`;
    }
    return `${prefix}this item is declining at a concerning rate. Reviewing supply timing or demand trends may help prevent the situation from worsening.${isDampened ? spikeNote : ""}`;
  }

  // ── Moderate / low decline ───────────────────────────────────────────────
  if (direction === "down") {
    if (f.outpacing && f.lossAmt !== null) {
      return `${prefix}outgoing activity is slightly ahead of incoming replenishment, resulting in a ${declineWord} of ${f.lossAmt.toLocaleString()}${pctLoss} this period. The situation is not urgent, but monitoring over the coming period is advisable.`;
    }
    if (f.lossAmt !== null) {
      return `${prefix}this item saw a ${declineWord} of ${f.lossAmt.toLocaleString()}${pctLoss} this period. No immediate action is required, but keeping an eye on the trend is recommended.${isDampened ? spikeNote : ""}`;
    }
    return `${prefix}this item is gradually declining. No immediate action is required, but monitoring the trend is advisable.`;
  }

  // ── Growing ──────────────────────────────────────────────────────────────
  if (direction === "up") {
    if (f.surplus && f.gainAmt !== null) {
      const promoteClause = canPromote
        ? " Performance is positive — ensure replenishment stays aligned with actual demand."
        : " Confirm that demand justifies the current incoming rate.";
      return `${prefix}incoming activity (${deliveryTotal.toLocaleString()}) exceeded outgoing (${salesTotal.toLocaleString()}), with a ${gainWord} of ${f.gainAmt.toLocaleString()}${pctGain} this period.${isDampened ? spikeNote : promoteClause}`;
    }
    if (f.gainAmt !== null && canPromote) {
      return `${prefix}this item is growing — ${salesTotal.toLocaleString()} units of outgoing activity with a ${gainWord} of ${f.gainAmt.toLocaleString()}${pctGain} recorded. Performance is trending positively.`;
    }
    return `${prefix}this item is trending upward. Performance appears positive — no immediate action is required.${isDampened ? spikeNote : ""}`;
  }

  // ── Stable ───────────────────────────────────────────────────────────────
  if (direction === "flat") {
    if (f.hasSales && f.hasDeliveries) {
      return `${prefix}outgoing activity (${salesTotal.toLocaleString()}) and incoming replenishment (${deliveryTotal.toLocaleString()}) are closely balanced, keeping levels stable. The current approach appears to be working.`;
    }
    return `${prefix}this item is stable with minimal net change. No immediate action is required — confirm whether the current level aligns with your targets.`;
  }

  // ── Fallback ─────────────────────────────────────────────────────────────
  return reason?.trim() || "Not enough data to generate a reliable explanation for this item.";
}

/** Capitalise first letter of a sentence. */
function cap(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── FIX 2 — Data completeness ─────────────────────────────────────────────────

/**
 * @param {object} entity
 * @returns {{ level: "high"|"medium"|"low", label: string, description: string }}
 */
function computeCompleteness(entity) {
  const { periodCount, salesTotal, deliveryTotal, timeRange } = entity;
  const hasEvents   = (Number.isFinite(salesTotal)    && salesTotal    > 0)
                   || (Number.isFinite(deliveryTotal) && deliveryTotal > 0);
  const hasTime     = timeRange != null && Number.isFinite(timeRange.durationMs) && timeRange.durationMs > 0;
  const hasSnapshots = Number.isFinite(periodCount) && periodCount >= 2;

  if (hasSnapshots && hasEvents && hasTime) {
    return { level: "high",   label: "Complete",      description: "Snapshots + activity + time range" };
  }
  if (hasSnapshots && hasTime) {
    return { level: "medium", label: "Partial",       description: "Snapshots present, no activity recorded" };
  }
  return   { level: "low",    label: "Limited",       description: "Minimal data — results may be imprecise" };
}

// ── FIX 5 — Relative rank text ────────────────────────────────────────────────

/**
 * Produce a human-readable rank descriptor.
 * Uses "Top X%" for top quartile, "Bottom X%" for bottom quartile, "#N of M" otherwise.
 *
 * @param {number} rank
 * @param {number} percentile  (rank / totalEntities)
 * @param {number} [totalCount]
 * @returns {{ primary: string, context: string | null }}
 */
function relativeRank(rank, percentile, totalCount) {
  if (!Number.isFinite(rank)) return { primary: "—", context: null };

  // Derive total from rank/percentile when not supplied directly
  const total = totalCount
    || (Number.isFinite(percentile) && percentile > 0 ? Math.round(rank / percentile) : null);

  const posStr = total ? `#${rank} of ${total}` : `#${rank}`;

  if (!Number.isFinite(percentile)) return { primary: posStr, context: null };

  const pct = Math.round(percentile * 100);

  if (rank === 1)           return { primary: posStr, context: "Top performer" };
  if (total && rank === total) return { primary: posStr, context: "Lowest ranked" };
  if (pct <= 25)            return { primary: posStr, context: `Top ${pct}%` };
  if (pct >= 75)            return { primary: posStr, context: `Bottom ${100 - pct}%` };
  return                           { primary: posStr, context: "Mid range" };
}

// ── FIX 3 — Tie-break sentence formatter ─────────────────────────────────────

const REASON_NAMES = {
  "score":              "performance score",
  "direction":          "trend direction",
  "direction priority": "trend direction",
  "velocity":           "rate of change",
  "salesTotal":         "sales volume",
  "entityId":           "name",
};

/** @param {string[]} reasons @returns {string | null} */
function formatTieBreak(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) return null;
  const [first] = reasons;
  if (first === "score") return "Ranked by overall performance score.";
  if (!first.startsWith("tied ")) return `Ranked by ${REASON_NAMES[first] ?? first}.`;
  const tiedOn = [];
  let decisive = null;
  for (const r of reasons) {
    if (r.startsWith("tied ")) tiedOn.push(REASON_NAMES[r.replace("tied ", "")] ?? r.replace("tied ", ""));
    else { decisive = REASON_NAMES[r] ?? r; break; }
  }
  if (!decisive) return "Ranked alphabetically after a complete tie.";
  const tiedStr = tiedOn.length === 1
    ? tiedOn[0]
    : `${tiedOn.slice(0, -1).join(", ")} and ${tiedOn.at(-1)}`;
  return `Tied on ${tiedStr} — placed higher by stronger ${decisive}.`;
}

// ── Tier label helper ─────────────────────────────────────────────────────────

function tierLabel(percentile) {
  if (!Number.isFinite(percentile)) return "Unknown";
  if (percentile <= 0.25) return "Top Performer";
  if (percentile <= 0.50) return "Mid Tier";
  if (percentile <= 0.75) return "At Risk";
  return "Critical";
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   entity: {
 *     entityId:        string,
 *     label:           string,
 *     rank:            number,
 *     score:           number,
 *     tieBreakReason:  string[],
 *     direction:       string,
 *     velocity:        number,
 *     velocityPerTime: number,
 *     periodCount:     number,
 *     netDelta:        number,
 *     salesTotal:      number,
 *     startValue:      number,
 *     endValue:        number,
 *     deliveryTotal:   number,
 *     timeRange:       { startTimestamp: string, endTimestamp: string, durationMs: number } | null,
 *     action:          string,
 *     urgency:         string,
 *     reason:          string,
 *     alertCount:      number,
 *     percentile:      number,
 *   },
 *   totalCount?: number,
 * }} props
 */
export default function EntityDetailPanel({ entity, totalCount }) {
  const {
    label,
    rank, tieBreakReason, percentile,
    direction, velocityPerTime, periodCount,
    netDelta, salesTotal, startValue, endValue, deliveryTotal,
    timeRange,
    action, urgency, reason, alertCount,
    analyzerIntent,
    wellnessHorizonsFormatted,
  } = entity;

  // ── Derived values ──────────────────────────────────────────────────────────
  const perDay  = toPerDay(velocityPerTime);
  const perWeek = perDay !== null ? perDay * 7 : null;
  const durationDays = timeRange?.durationMs != null
    ? Math.round(timeRange.durationMs / MS_PER_DAY)
    : null;

  const completeness  = computeCompleteness(entity);
  const impactText    = rewriteImpact(entity, completeness);
  const rankInfo      = relativeRank(rank, percentile, totalCount);
  const tieBreakText  = formatTieBreak(tieBreakReason);
  const tier          = tierLabel(percentile);

  // Stability flags — computed for tooltip enrichment only, not for statements
  const stabilityFlags = classifyActivity(entity);
  const stabilityNote  =
    stabilityFlags.isVolatile        ? "High activity throughput relative to net change (volatile)"
    : stabilityFlags.isRecentSpike   ? "Change observed over a short window — trend not yet sustained"
    : stabilityFlags.hasSustainedTrend ? "Consistent direction observed across multiple measurements"
    : "Trend based on limited measurements";

  // Combined tooltip for the data completeness indicator
  const completenessTooltip = `${completeness.description} · ${stabilityNote}`;

  // Time context string
  const timeContext = durationDays != null && durationDays > 0
    ? `Over the last ${durationDays} day${durationDays === 1 ? "" : "s"}`
    : null;

  // ── CSS modifier classes ────────────────────────────────────────────────────
  const netClass = netDelta > 0 ? "ep-detail__kv-val--pos"
                 : netDelta < 0 ? "ep-detail__kv-val--neg" : "";
  const dirClass = direction === "up"   ? "ep-detail__kv-val--up"
                 : direction === "down" ? "ep-detail__kv-val--down" : "";

  // FIX 7 (from prev pass): stronger red/orange accent for critical/high down
  const urgentDownClass =
    direction === "down" && urgency === "critical" ? "ep-detail--urgent-down"
  : direction === "down" && urgency === "high"     ? "ep-detail--high-down"
  : "";

  return (
    <div
      className={`ep-detail ${urgentDownClass}`.trim()}
      role="region"
      aria-label={`Details for ${label}`}
    >

      {/* ── Section 1: Impact — full-width top ──────────────────────── */}
      <div className="ep-detail__section ep-detail__section--impact">
        <h4 className="ep-detail__section-title">What's happening</h4>
        <p className={`ep-detail__impact${!impactText ? " ep-detail__impact--empty" : ""}`}>
          {impactText || "Not enough data available to generate an explanation."}
        </p>
      </div>

      {/* ── Section 2: State ────────────────────────────────────────── */}
      <div className="ep-detail__section">
        <h4 className="ep-detail__section-title">State</h4>
        <dl className="ep-detail__kv">
          <dt className="ep-detail__kv-key">Starting value</dt>
          <dd className="ep-detail__kv-val">{n(startValue, "Not recorded")}</dd>

          <dt className="ep-detail__kv-key">Current value</dt>
          <dd className="ep-detail__kv-val">{n(endValue, "Not recorded")}</dd>

          <dt className="ep-detail__kv-key">Net change</dt>
          <dd className={`ep-detail__kv-val ${netClass}`}>{signed(netDelta)}</dd>

          <dt className="ep-detail__kv-key">Received</dt>
          <dd className="ep-detail__kv-val">
            {Number.isFinite(deliveryTotal) && deliveryTotal > 0 ? n(deliveryTotal) : "None recorded"}
          </dd>

          <dt className="ep-detail__kv-key">Sold / used</dt>
          <dd className="ep-detail__kv-val">
            {Number.isFinite(salesTotal) && salesTotal > 0 ? n(salesTotal) : "None recorded"}
          </dd>
        </dl>
      </div>

      {/* ── Section 3: Trend ────────────────────────────────────────── */}
      <div className="ep-detail__section">
        {/* FIX 3 — time context in section title */}
        <h4 className="ep-detail__section-title">
          {timeContext ? `Trend · ${timeContext}` : "Trend"}
        </h4>
        <dl className="ep-detail__kv">
          <dt className="ep-detail__kv-key">Direction</dt>
          <dd className={`ep-detail__kv-val ${dirClass}`}>
            {direction === "up"   ? "↑ Rising"
           : direction === "down" ? "↓ Falling"
           : direction === "flat" ? "→ Stable"
           : "Not enough data"}
          </dd>

          <dt className="ep-detail__kv-key">Daily rate</dt>
          <dd className={`ep-detail__kv-val ${dirClass}`}>
            {perDay !== null
              ? `${direction === "down" ? "−" : "+"}${dec(perDay)} / day`
              : "—"}
          </dd>

          <dt className="ep-detail__kv-key">Weekly rate</dt>
          <dd className={`ep-detail__kv-val ${dirClass}`}>
            {perWeek !== null
              ? `${direction === "down" ? "−" : "+"}${dec(perWeek)} / week`
              : "—"}
          </dd>

          {timeRange ? (
            <>
              <dt className="ep-detail__kv-key">From</dt>
              <dd className="ep-detail__kv-val" style={{ fontSize: "0.78rem" }}>
                {fmtDate(timeRange.startTimestamp)}
              </dd>
              <dt className="ep-detail__kv-key">To</dt>
              <dd className="ep-detail__kv-val" style={{ fontSize: "0.78rem" }}>
                {fmtDate(timeRange.endTimestamp)}
              </dd>
            </>
          ) : null}

          <dt className="ep-detail__kv-key">Snapshots</dt>
          <dd className="ep-detail__kv-val">
            {Number.isFinite(periodCount) && periodCount > 0
              ? `${periodCount} measurement${periodCount === 1 ? "" : "s"}`
              : "Not enough data"}
          </dd>
        </dl>

        {/* FIX 2 — Data completeness indicator */}
        <div className={`ep-detail__completeness ep-detail__completeness--${completeness.level}`}
             title={completenessTooltip}>
          <span className="ep-detail__completeness-dot" aria-hidden="true" />
          <span className="ep-detail__completeness-label">
            {completeness.label} data
          </span>
        </div>
      </div>

      {/* ── Section 4: Recommendation ───────────────────────────────── */}
      {/* Hierarchy: Action (primary) → Urgency → Reason → Data caveat */}
      <div className="ep-detail__section">
        <h4 className="ep-detail__section-title">Recommended action</h4>

        {/* Primary: Action */}
        <div className="ep-detail__rec-action">
          <ActionPill
            action={action}
            label={analyzerIntent === "weightloss" ? wellnessActionLabel(action) : undefined}
          />
        </div>

        {/* Secondary: Urgency + Alerts */}
        <div className="ep-detail__rec-meta">
          <UrgencyChip urgency={urgency} />
          {alertCount > 0 && <AlertBadge count={alertCount} />}
        </div>

        {analyzerIntent === "weightloss" && wellnessHorizonsFormatted ? (
          <dl className="ep-detail__wellness-horizons">
            <dt>If today&apos;s pace continued (linear)</dt>
            <dd>
              <span>Week: {wellnessHorizonsFormatted.week}</span>
              <span> · Month: {wellnessHorizonsFormatted.month}</span>
              <span> · 6 mo: {wellnessHorizonsFormatted.sixMonths}</span>
              <span> · Year: {wellnessHorizonsFormatted.year}</span>
            </dd>
            <dd className="ep-detail__wellness-disclaimer">
              Illustrative only — real progress is rarely linear. Not medical advice.
            </dd>
          </dl>
        ) : null}

        {/* Supporting: Reason */}
        {reason?.trim() ? (
          <p className="ep-detail__reason">{reason.trim()}</p>
        ) : (
          <p className="ep-detail__reason ep-detail__reason--empty">
            No specific recommendation available.
          </p>
        )}

        {/*
          Data caveat — shown when completeness is low.
          RULE 3: Confidence language must be reflected at every decision-making surface.
          RULE 4: Never present a strong action label without qualifying limited data.
          [FEEDBACK_HOOK] Future: suppress caveat if entity.userFeedback === 'data_confirmed'.
        */}
        {completeness.level === "low" && (
          <p className="ep-detail__rec-caveat">
            This recommendation is based on limited data — treat it as a starting point for investigation rather than a definitive action.
          </p>
        )}
      </div>

      {/* ── Section 5: Rank Context ──────────────────────────────────── */}
      {/* FIX 5 — Top X% / Bottom X% / #N of M */}
      <div className="ep-detail__section ep-detail__section--rank">
        <h4 className="ep-detail__section-title">Rank context</h4>

        <div className="ep-detail__rank-badge">{rankInfo.primary}</div>
        {rankInfo.context && (
          <div className="ep-detail__rank-context">{rankInfo.context}</div>
        )}
        <div className="ep-detail__rank-tier">{tier}</div>

        {tieBreakText && (
          <p className="ep-detail__tiebreak">{tieBreakText}</p>
        )}
      </div>

      {/* ── Section 6: Insights placeholder — full-width bottom ──────── */}
      {/* FIX 6 — Improved label and helper text */}
      <div className="ep-detail__section ep-detail__section--insights">
        <h4 className="ep-detail__section-title">Insights</h4>
        <div className="ep-detail__insights-inner">
          <button
            type="button"
            className="ep-detail__insights-btn"
            disabled
            aria-disabled="true"
            title="Comparative analysis coming soon"
          >
            📊 Compare Changes
          </button>
          <p className="ep-detail__insights-hint">
            See how this item is evolving over time — comparative analysis across periods is coming soon.
          </p>
        </div>
      </div>

    </div>
  );
}

/**
 * rateUtils.js
 *
 * Shared pure-function helpers for the rate + projection models used by
 * inventoryAnalysis, salesAnalysis, workforceAnalysis, and wellnessAnalysis.
 *
 * No I/O, no side effects. Nothing intent-specific lives here.
 *
 * Duplicated code removed by this module:
 *   daysBetween  — was copied into inventory, workforce, and wellness analysis files
 *   formatDate   — was copied into inventory, workforce, and wellness analysis files
 *   feasibility  — would have been copied into all four analysis files
 */

/**
 * Number of whole days between two dates (positive when d2 > d1).
 *
 * @param {Date | string} d1
 * @param {Date | string} d2
 * @returns {number}
 */
export function daysBetween(d1, d2) {
  const MS_PER_DAY = 86_400_000;
  return Math.round((new Date(d2).getTime() - new Date(d1).getTime()) / MS_PER_DAY);
}

/**
 * Format a date string as "Month D, YYYY" (en-US locale).
 *
 * @param {string} dateStr  ISO date string or any Date-parseable string.
 * @returns {string}        Formatted string, or the original if unparseable.
 */
export function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Feasibility signal: compares the required rate to the current rate and returns
 * a plain-language note when the required increase is material.
 *
 * Tiers (ratio = neededRate / currentRate):
 *   ratio < 1.2  → null          (on track or small adjustment)
 *   1.2 – 1.49  → "moderate increase needed"
 *   1.5 – 1.99  → "significant increase needed"
 *   2.0 – 4.0   → "may be difficult to sustain"
 *   > 4.0       → "unlikely to be reachable within the timeframe"
 *
 * Both rates must be positive and finite; returns null otherwise.
 *
 * @param {number} currentRate  Measured rate (must be > 0).
 * @param {number} neededRate   Rate required to hit the goal (must be > 0).
 * @returns {string | null}
 */
export function feasibilityNote(currentRate, neededRate) {
  if (
    !Number.isFinite(currentRate) || !Number.isFinite(neededRate) ||
    currentRate <= 0 || neededRate <= 0
  ) return null;

  const ratio = neededRate / currentRate;
  if (ratio < 1.2) return null;
  if (ratio < 1.5) return "This would take a moderate step up from your current pace.";
  if (ratio < 2.0) return "This would require a significant step up from your current pace.";
  if (ratio <= 4.0) {
    return "This may be difficult to sustain at your current level — it might be worth revisiting the timeline or adjusting the goal.";
  }
  return "At this gap, the target is unlikely to be reachable within the timeframe — consider adjusting the goal or timeline.";
}

// ── Goal “rateDerivation” display (strings only; does not change model math) ──

/**
 * Rounds a weight (lb) for on-screen copy.
 * @param {number} lb
 * @returns {string}
 */
export function formatWeightLbForDisplay(lb) {
  if (!Number.isFinite(lb)) return "—";
  if (Math.abs(lb) >= 100) return String(Math.round(lb));
  return (Math.round(lb * 10) / 10).toFixed(1);
}

/**
 * |lbs/week| for goal copy: avoids noisy decimals on very small rates.
 * @param {number} absLbsPerWeek
 * @returns {string}
 */
export function formatLbsPerWeekNumberForDisplay(absLbsPerWeek) {
  if (!Number.isFinite(absLbsPerWeek) || absLbsPerWeek < 0) return "0";
  if (absLbsPerWeek < 0.1) return (Math.round(absLbsPerWeek * 100) / 100).toFixed(2);
  if (absLbsPerWeek < 10) return (Math.round(absLbsPerWeek * 10) / 10).toFixed(1);
  return String(Math.round(absLbsPerWeek));
}

/**
 * Throughput or depletion: natural ending clause using “about” and per-week when the
 * daily amount would be an awkwardly small decimal.
 *
 * @param {number} perDay   Observed per-day amount (from the existing model).
 * @param {string} unitNoun e.g. "tasks", "units"
 * @returns {string}
 */
export function formatRateDerivationPaceAbout(perDay, unitNoun) {
  if (!Number.isFinite(perDay) || perDay < 0) {
    return `about 0 ${unitNoun} per day`;
  }
  if (perDay < 0.1) {
    const w = perDay * 7;
    const rounded = w >= 1 ? Math.round(w * 10) / 10 : Math.round(w * 100) / 100;
    return `about ${rounded} ${unitNoun} per week`;
  }
  if (perDay < 10) {
    return `about ${(Math.round(perDay * 10) / 10).toFixed(1)} ${unitNoun} per day`;
  }
  return `about ${Math.round(perDay)} ${unitNoun} per day`;
}

/**
 * Weight goal: line explaining average change, preferring lb/week for readability.
 *
 * @param {number} startLb
 * @param {number} endLb
 * @param {number} durationDays
 * @param {number} lbsPerDay  Same rate the model already uses.
 * @returns {string}
 */
export function formatWellnessWeightRateDerivationLine(startLb, endLb, durationDays, lbsPerDay) {
  const dLabel = `${durationDays} day${durationDays !== 1 ? "s" : ""}`;
  const sw     = formatWeightLbForDisplay(startLb);
  const ew     = formatWeightLbForDisplay(endLb);
  if (!Number.isFinite(lbsPerDay)) {
    return `From about ${sw} to about ${ew} lbs over ${dLabel}.`;
  }
  const perWeek = lbsPerDay * 7;
  if (Math.abs(perWeek) < 0.05) {
    return `From about ${sw} to about ${ew} lbs over ${dLabel} — the net change is very small.`;
  }
  const mag = Math.abs(perWeek) >= 1 ? Math.abs(perWeek).toFixed(1) : Math.abs(perWeek).toFixed(2);
  if (perWeek < 0) {
    return `From about ${sw} to about ${ew} lbs over ${dLabel} — about ${mag} lb per week of loss on average.`;
  }
  if (perWeek > 0) {
    return `From about ${sw} to about ${ew} lbs over ${dLabel} — about ${mag} lb per week of gain on average.`;
  }
  return `From about ${sw} to about ${ew} lbs over ${dLabel} — about ${mag} lb per week on average.`;
}

/**
 * Sales goal: period-over-period growth, rounded counts and “about” language.
 *
 * @param {number} salesTotal
 * @param {number} deliveryTotal
 * @param {number} currentPct  Whole-number percent (from existing display path).
 * @param {string} trendWord   "growth" | "decline"
 * @returns {string}
 */
export function formatSalesGoalRateDerivation(salesTotal, deliveryTotal, currentPct, trendWord) {
  const cur = Math.round(salesTotal);
  const pri = Math.round(deliveryTotal);
  return `This period: about ${cur} sales vs about ${pri} last period — about ${currentPct}% ${trendWord} (period over period).`;
}

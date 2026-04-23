/**
 * salesAnalysis.js
 *
 * Post-processing for Business Analyzer "sales" intent.
 * Pure functions — no I/O, no side effects.
 *
 * Consumes ONLY merged[] from the pipeline. No raw dataset event access.
 * runPipeline.js ensures merged[] is always populated for this intent via
 * transformEventsToMetrics() which runs in place of computeStateDelta.
 *
 * Pipeline field semantics for sales:
 *   salesTotal    = units sold this period   (endValue)
 *   deliveryTotal = units sold prior period  (startValue, compare mode)
 *   netDelta      = salesTotal − deliveryTotal  (period-over-period change)
 *   direction     = "up" | "down" | "flat"  (derived from netDelta by interpretTrends)
 *
 * Rate model — growth rate (period-over-period):
 *   currentRate  = (salesTotal − deliveryTotal) / deliveryTotal
 *   projection   = salesTotal × (1 + rate)^periods  ← compound when periods > 1
 *   neededRate   = (target − salesTotal) / salesTotal
 *
 * velocityPerTime is NOT used in any calculation in this file.
 */

import { feasibilityNote, formatSalesGoalRateDerivation } from "./rateUtils.js";

/** @typedef {import("./engineDisplayFormatters.js").MergedEntity & { analyzerIntent?: string, intentPrimary?: boolean, intentAnalysis?: object }} Row */

// ── Rate + projection model ───────────────────────────────────────────────────

/**
 * Growth rate for sales: period-over-period fractional change.
 * Returns null when no prior-period data is available (deliveryTotal = 0).
 *
 * @param {Row} row
 * @returns {number | null}
 */
export function extractRate(row) {
  const salesTotal    = Number(row?.salesTotal    ?? 0);
  const deliveryTotal = Number(row?.deliveryTotal ?? 0);
  if (deliveryTotal === 0) return null;
  return (salesTotal - deliveryTotal) / deliveryTotal;
}

/**
 * Forward model: projected sales after `periods` at the current growth rate.
 *
 * Uses compound growth (salesTotal × (1 + rate)^periods) to avoid underestimating
 * growth trends. For single-period projection (periods = 1) this simplifies to
 * salesTotal × (1 + rate), identical to the linear case.
 *
 * @param {number} rate     Growth rate (fractional, e.g. 0.10 = 10%).
 * @param {number} current  Current period sales.
 * @param {number} [periods=1]  Number of periods to project forward.
 * @returns {number | null}
 */
export function projectOutcome(rate, current, periods = 1) {
  if (!Number.isFinite(rate) || !Number.isFinite(current) || !Number.isFinite(periods)) return null;
  return Math.round(current * Math.pow(1 + rate, periods));
}

/**
 * Inverse model: required growth rate to reach `target` from `current` in one period.
 *
 * @param {number} target  Sales goal for next period.
 * @param {number} current Current period sales.
 * @returns {number | null}
 */
export function requiredRate(target, current) {
  if (!Number.isFinite(target) || !Number.isFinite(current) || current === 0) return null;
  return (target - current) / current;
}

function salesGoalDataConfidence(salesTotal, deliveryTotal) {
  const low = salesTotal < 4 || deliveryTotal < 4;
  if (!low) return "";
  return " With limited activity data, projections may be less reliable.";
}

/** Same ratio language as throughput goals; uses model’s positive growth rates only. */
function salesPaceRatioRealismAppend(currentRate, neededRate) {
  if (!Number.isFinite(currentRate) || !Number.isFinite(neededRate) || currentRate <= 0 || neededRate <= 0) return "";
  const r = neededRate / currentRate;
  if (r > 5) return " At this level, the target is likely not realistic within the timeframe.";
  if (r > 3) return " This would require a major increase from your current pace.";
  return "";
}

const SALES_GOAL_GAP_WHY =
  " This gap is mainly driven by the difference between your current pace and the time remaining.";

function salesMostPracticalOption(neededRate, currentRate) {
  if (Number.isFinite(neededRate) && Number.isFinite(currentRate) && currentRate > 0 && neededRate > 3 * currentRate) {
    return "Most practical option: Leaning on your best-performing products or channels can cover part of the gap with less net-new demand than a broad growth push.";
  }
  return "Most practical option: Tuning conversion and offers on what you already sell is often the highest return before you spend to reach new buyers.";
}

const SALES_ON_TRACK_BEST =
  "Most practical option: Keep execution steady on the mix that is already working, then look for a single high-confidence improvement to repeat next period.";

/**
 * Goal-based analysis: compares the user's target against the current growth rate
 * and determines if they are on track, plus what growth is required if not.
 *
 * Output structure:
 *   1. Restate goal
 *   2. Show projected outcome at current rate
 *   3. Show required rate if goal is not met
 *   4. Feasibility note if gap is material
 *   5. 2–3 strategies (paths forward)
 *
 * Returns null when no goal. Returns a { summary, strategies } object otherwise.
 *
 * @param {Row | null} primaryRow
 * @param {Row[]}      allRows
 * @param {{ targetValue?: string | number, targetDate?: string } | null | undefined} goal
 * @returns {{ summary: string, strategies: string[], rateDerivation?: string } | null}
 */
export function generateGoalAnalysis(primaryRow, allRows, goal) {
  if (!primaryRow || !goal) return null;

  const targetValue = Number(goal.targetValue);
  if (!Number.isFinite(targetValue) || targetValue <= 0) return null;

  const salesTotal    = Number(primaryRow.salesTotal    ?? 0);
  const deliveryTotal = Number(primaryRow.deliveryTotal ?? 0);
  if (salesTotal === 0 && deliveryTotal === 0) {
    return { summary: "Not enough data to calculate a projection.", strategies: [] };
  }

  const currentRate = extractRate(primaryRow);

  // Single period only — no rate, give directional answer
  if (currentRate === null) {
    if (salesTotal >= targetValue) {
      let summary = `Your goal is ${targetValue} sales next period. You recorded ${salesTotal} this period — you're already at or above your target.`;
      summary += salesGoalDataConfidence(salesTotal, deliveryTotal);
      return {
        summary,
        strategies: [
          "Protect what's working — avoid unnecessary changes to pricing or channels when momentum is good.",
          "Track the source — understanding which products or channels drove results makes them easier to repeat.",
          "Most practical option: Keep following what already produced this result while you add another period to measure momentum.",
        ],
      };
    }
    let summary = `Your goal is ${targetValue} sales next period. You recorded ${salesTotal} this period. Without a prior period to compare against, it's not yet possible to project a growth rate — adding a second period will unlock this.`;
    summary += salesGoalDataConfidence(salesTotal, deliveryTotal);
    return {
      summary,
      strategies: [
        "Most practical option: Add one more complete period of sales first — the clearest next step is a comparison, not a bigger goal.",
      ],
    };
  }

  const projectedValue = projectOutcome(currentRate, salesTotal) ?? 0;
  const neededRate     = requiredRate(targetValue, salesTotal);
  const currentPct     = Math.round(Math.abs(currentRate) * 100);
  const neededPct      = neededRate !== null ? Math.round(Math.abs(neededRate) * 100) : null;
  const trendWord      = currentRate >= 0 ? "growth" : "decline";
  const gap            = Math.round(targetValue - projectedValue);

  if (projectedValue >= targetValue) {
    const rateDerivation = formatSalesGoalRateDerivation(salesTotal, deliveryTotal, currentPct, trendWord);
    let summary = `Your goal is ${targetValue} sales next period. Based on your current momentum of about ${currentPct}% ${trendWord}, you're projected to reach ${projectedValue} — looking on track to exceed your target.`;
    summary += salesGoalDataConfidence(salesTotal, deliveryTotal);
    return {
      summary,
      rateDerivation,
      strategies: [
        "Protect what's working — avoid unnecessary changes to pricing or channels when momentum is good.",
        "Track the source — understanding which products or channels drove growth makes the result easier to repeat next period.",
        SALES_ON_TRACK_BEST,
      ],
    };
  }

  if (neededPct !== null) {
    let summary = `Your goal is ${targetValue} sales next period. At your current ${trendWord} of about ${currentPct}%, you're projected to reach ${projectedValue} — about ${gap} short of your target. To close that gap, you'd need to grow at about ${neededPct}%.`;
    const note = neededRate !== null && currentRate > 0
      ? feasibilityNote(currentRate, neededRate)
      : null;
    if (note) summary += ` ${note}`;
    if (neededRate !== null && currentRate > 0) {
      summary += salesPaceRatioRealismAppend(currentRate, neededRate);
    }
    summary += SALES_GOAL_GAP_WHY;
    summary += salesGoalDataConfidence(salesTotal, deliveryTotal);
    const rateDerivation = formatSalesGoalRateDerivation(salesTotal, deliveryTotal, currentPct, trendWord);
    const strategies     = [
      "Improve conversion — small adjustments to pricing, offers, or the buying experience can lift results without needing more traffic.",
      "Increase exposure — growing reach through marketing or new channels creates more opportunities to sell.",
      "Focus on top performers — concentrating effort on your strongest items often delivers faster gains than spreading attention across everything.",
    ];
    if (neededRate !== null && currentRate > 0) {
      strategies.push(salesMostPracticalOption(neededRate, currentRate));
    } else {
      strategies.push(
        "Most practical option: Stabilize the trend you have, then test one focused lift to conversion or reach before widening the plan.",
      );
    }
    return {
      summary,
      rateDerivation,
      strategies,
    };
  }

  return null;
}

// ── Analysis generators ───────────────────────────────────────────────────────

/**
 * 1–2 sentence summary of the most important sales signal.
 *
 * @param {Row | null} primaryRow
 * @param {Row[]}      allRows
 * @returns {string}
 */
export function generateInterpretation(primaryRow, allRows) {
  if (!primaryRow) return "Not enough data to analyze.";

  const { label, salesTotal, deliveryTotal, direction } = primaryRow;
  const hasPriorPeriod = allRows.some((r) => (r.deliveryTotal ?? 0) > 0);
  const total    = allRows.length;
  const growing  = allRows.filter((r) => r.direction === "up").length;
  const declining = allRows.filter((r) => r.direction === "down").length;

  // No activity at all
  if (allRows.every((r) => (r.salesTotal ?? 0) === 0 && (r.deliveryTotal ?? 0) === 0)) {
    return "No sales data was recorded for this period — add activity to generate an analysis.";
  }

  let sentence;

  if (hasPriorPeriod && (deliveryTotal ?? 0) > 0) {
    const delta = (salesTotal ?? 0) - deliveryTotal;
    const pct   = Math.round(Math.abs(delta / deliveryTotal) * 100);

    if (direction === "up") {
      sentence = `${label} is your top performer — ${salesTotal} units sold this period, up ${pct}% from the prior period (${deliveryTotal}).`;
    } else if (direction === "down") {
      sentence = `${label} leads in volume but is down ${pct}% from the prior period (${deliveryTotal} → ${salesTotal} units).`;
    } else {
      sentence = `${label} is your top item with ${salesTotal} units sold — consistent with the prior period.`;
    }
  } else if ((salesTotal ?? 0) > 0) {
    sentence = `${label} is your best performer with ${salesTotal} units sold this period.`;
  } else {
    sentence = `No sales were recorded this period${total > 1 ? ` across ${total} items` : ""}.`;
  }

  if (total > 1 && hasPriorPeriod) {
    if (growing > 0 && declining > 0) {
      sentence += ` ${growing} item${growing > 1 ? "s are" : " is"} growing; ${declining} ${declining > 1 ? "are" : "is"} declining period-over-period.`;
    } else if (growing > 0) {
      sentence += ` ${growing} of ${total} items show period-over-period growth.`;
    } else if (declining > 0) {
      sentence += ` ${declining} of ${total} items are down compared to last period.`;
    }
  }

  return sentence;
}

/**
 * 1–3 specific, actionable recommendations based on pipeline signals.
 *
 * @param {Row | null} primaryRow
 * @param {Row[]}      allRows
 * @returns {string[]}
 */
export function generateActions(primaryRow, allRows) {
  if (!primaryRow) return [];

  // No activity recorded
  if (allRows.every((r) => (r.salesTotal ?? 0) === 0 && (r.deliveryTotal ?? 0) === 0)) {
    return ["Add sales data for this period to see specific recommendations."];
  }

  const actions = [];

  // Zero-sales items
  const zeroSales = allRows.filter((r) => (r.salesTotal ?? 0) === 0);
  if (zeroSales.length > 0) {
    const names = zeroSales.slice(0, 2).map((r) => r.label).join(", ");
    const more  = zeroSales.length > 2 ? ` and ${zeroSales.length - 2} other${zeroSales.length - 2 > 1 ? "s" : ""}` : "";
    actions.push(`Review ${names}${more} — no sales were recorded; investigate demand, pricing, or listing visibility.`);
  }

  // Declining items (period-over-period)
  const declining = allRows.filter((r) => r.direction === "down" && (r.deliveryTotal ?? 0) > 0);
  if (declining.length > 0 && actions.length < 3) {
    const names = declining.slice(0, 2).map((r) => r.label).join(", ");
    const more  = declining.length > 2 ? ` and ${declining.length - 2} other${declining.length - 2 > 1 ? "s" : ""}` : "";
    actions.push(`Investigate the decline in ${names}${more} — compare pricing, promotions, or channel changes since the prior period.`);
  }

  // Growing items
  const topMover = allRows.find((r) => r.direction === "up" && (r.salesTotal ?? 0) > 0);
  if (topMover && actions.length < 3) {
    actions.push(`Lean into ${topMover.label}'s momentum — consider increased visibility, promotions, or bundle opportunities.`);
  }

  if (actions.length === 0) {
    actions.push("Sales appear consistent across tracked items — identify top contributors to focus promotional and stocking efforts.");
  }

  return actions.slice(0, 3);
}

/**
 * Hedged period-over-period projection.
 * Returns null when only one period of data exists or the change is minimal.
 *
 * @param {Row | null} primaryRow
 * @param {Row[]}      allRows
 * @returns {string | null}
 */
export function generateProjection(primaryRow, _allRows) {
  if (!primaryRow) return null;

  const { label, salesTotal, deliveryTotal, direction } = primaryRow;

  if ((deliveryTotal ?? 0) === 0) return null;
  const pct = Math.round(Math.abs(((salesTotal ?? 0) - deliveryTotal) / deliveryTotal) * 100);
  if (pct < 5) return null;

  if (direction === "up") {
    return `${label} is up ${pct}% period-over-period. If this trend continues, it may account for a larger share of total sales next period. This is a directional estimate based on one comparison — additional periods are needed to confirm the trend.`;
  }
  if (direction === "down") {
    return `${label} is down ${pct}% compared to last period. Without intervention, this decline may persist — review what changed and consider a targeted response. This is a directional estimate only.`;
  }
  return null;
}

// ── Enrich ────────────────────────────────────────────────────────────────────

/**
 * Attach sales analysis to the merged pipeline rows.
 *
 * merged[] is guaranteed non-empty for this intent: runPipeline.js pre-processes
 * the dataset via transformEventsToMetrics(), ensuring pipeline output exists for
 * every entity.
 *
 * If merged is somehow empty (e.g. no entities entered), returns it unchanged —
 * EntityPerformanceScreen shows the no-data state.
 *
 * @param {Row[]} merged
 * @param {{ goal?: { targetValue?: string | number, targetDate?: string } | null }} dataset
 * @returns {Row[]}
 */
export function enrichSalesForOutput(merged, dataset) {
  if (!Array.isArray(merged) || merged.length === 0) return merged ?? [];

  const goal = dataset?.goal ?? null;

  // Primary = highest salesTotal (top item by volume this period)
  const primary = [...merged].sort((a, b) => (b.salesTotal ?? 0) - (a.salesTotal ?? 0))[0];

  const interpretation = generateInterpretation(primary, merged);
  const actions        = generateActions(primary, merged);
  const projection     = generateProjection(primary, merged);
  const goalAnalysis   = generateGoalAnalysis(primary, merged, goal);

  return merged.map((row) => ({
    ...row,
    analyzerIntent: "sales",
    ...(row.entityId === primary?.entityId
      ? { intentPrimary: true, intentAnalysis: { interpretation, actions, projection, goalAnalysis } }
      : {}),
  }));
}

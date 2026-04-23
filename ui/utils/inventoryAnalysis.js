/**
 * inventoryAnalysis.js
 *
 * Post-processing for Business Analyzer "inventory" intent.
 * Operates exclusively on merged pipeline output fields — no raw dataset access required.
 * Pure functions — no I/O, no side effects.
 *
 * Pipeline fields used:
 *   label, direction, netDelta, salesTotal, deliveryTotal, endValue,
 *   rank, urgency, action, periodCount
 *
 * Rate model — depletion (units per day):
 *   currentRate  = salesTotal / durationDays   ← direct measurement, no velocityPerTime
 *   projection   = endValue − currentRate × daysToDeadline
 *   maxRate      = (endValue − target) / daysToDeadline  (max allowable daily loss)
 *
 * durationDays is derived from dataset.periodStart / dataset.periodEnd in the enrich
 * function and threaded into extractRate, generateProjection, and generateGoalAnalysis.
 */

import { daysBetween, formatDate, formatRateDerivationPaceAbout } from "./rateUtils.js";

/**
 * Inventory-specific feasibility note: describes how hard it is to REDUCE depletion.
 * Uses the same tiers as rateUtils.feasibilityNote but with "reduction" language.
 *
 * @param {number} currentRate      Observed depletion rate (units/day).
 * @param {number} maxAllowableRate Max allowable depletion rate to stay above target.
 * @returns {string | null}
 */
function depletionFeasibilityNote(currentRate, maxAllowableRate) {
  if (
    !Number.isFinite(currentRate) || !Number.isFinite(maxAllowableRate) ||
    currentRate <= 0 || maxAllowableRate <= 0
  ) return null;
  const ratio = currentRate / maxAllowableRate; // how many times over the allowed limit
  if (ratio < 1.2) return null;
  if (ratio < 1.5) return "This would take a moderate reduction in outflow — or a planned restock to make up the difference.";
  if (ratio < 2.0) return "This would require a significant cut in outflow, or a substantial restock, to stay on track.";
  if (ratio <= 4.0) {
    return "This target may be difficult to hit at your current outflow rate — consider a restock or revisiting the deadline.";
  }
  return "At this gap, the target is unlikely to be reachable within the timeframe — consider adjusting the goal or timeline.";
}

/** @typedef {import("./engineDisplayFormatters.js").MergedEntity & { analyzerIntent?: string }} Row */

/** Urgency sort weight — lower = more urgent. */
const URGENCY_WEIGHT = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Pick the primary row: most urgent entity, falling back to rank order.
 * @param {Row[]} rows
 * @returns {Row | null}
 */
function pickPrimary(rows) {
  if (!rows || rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const ua = URGENCY_WEIGHT[a.urgency] ?? 4;
    const ub = URGENCY_WEIGHT[b.urgency] ?? 4;
    if (ua !== ub) return ua - ub;
    return (a.rank ?? 99) - (b.rank ?? 99);
  })[0];
}

/**
 * 1–2 sentence summary of the most important stock signal.
 *
 * @param {Row | null} primaryRow
 * @param {Row[]}      allRows
 * @returns {string | null}
 */
export function generateInterpretation(primaryRow, allRows) {
  if (!primaryRow) return null;

  const { label, direction, netDelta, salesTotal, deliveryTotal } = primaryRow;
  const total    = allRows.length;
  const declining = allRows.filter((r) => r.direction === "down").length;
  const gaining   = allRows.filter((r) => r.direction === "up").length;

  let sentence;
  if (direction === "down") {
    const loss = Math.abs(netDelta ?? 0);
    sentence = `${label} is your most urgent item — stock is down ${loss} unit${loss !== 1 ? "s" : ""}`;
    if ((salesTotal ?? 0) > 0) sentence += ` with ${salesTotal} sold`;
    if ((deliveryTotal ?? 0) > 0) sentence += ` and ${deliveryTotal} restocked`;
    sentence += " this period.";
  } else if (direction === "up") {
    sentence = `${label} is your top mover — up ${netDelta} unit${netDelta !== 1 ? "s" : ""} after ${salesTotal ?? 0} sold and ${deliveryTotal ?? 0} restocked.`;
  } else {
    const hasSales = (salesTotal ?? 0) > 0;
    sentence = hasSales
      ? `${label} is holding steady — ${salesTotal} units sold, matched by restocking.`
      : `${label} shows no movement this period — no sales or restocking recorded.`;
  }

  if (total > 1) {
    if (declining > 0 && gaining > 0) {
      sentence += ` Across all ${total} products, ${declining} are declining and ${gaining} are gaining.`;
    } else if (declining > 0) {
      sentence += ` ${declining} of ${total} product${declining > 1 ? "s are" : " is"} in decline.`;
    } else if (gaining > 0) {
      sentence += ` ${gaining} of ${total} product${gaining > 1 ? "s are" : " is"} growing.`;
    }
  }

  return sentence;
}

/**
 * 1–3 specific, concrete recommendations based on pipeline urgency and direction signals.
 *
 * @param {Row | null} primaryRow
 * @param {Row[]}      allRows
 * @returns {string[]}
 */
export function generateActions(primaryRow, allRows) {
  if (!primaryRow) return [];

  const actions = [];

  // Reorder needed
  const atRisk = allRows.filter((r) => r.urgency === "critical" || r.urgency === "high");
  if (atRisk.length > 0) {
    const names = atRisk.slice(0, 2).map((r) => r.label).join(", ");
    const more  = atRisk.length > 2 ? ` and ${atRisk.length - 2} other${atRisk.length - 2 > 1 ? "s" : ""}` : "";
    actions.push(`Prioritise reordering ${names}${more} — declining stock with elevated urgency may lead to a stockout if left unaddressed.`);
  }

  // Stagnant items (no sales, no movement)
  const stagnant = allRows.filter((r) => r.direction === "flat" && (r.salesTotal ?? 0) === 0);
  if (stagnant.length > 0 && actions.length < 3) {
    const names = stagnant.slice(0, 2).map((r) => r.label).join(", ");
    actions.push(`Investigate demand for ${names}${stagnant.length > 2 ? ` and ${stagnant.length - 2} other${stagnant.length - 2 > 1 ? "s" : ""}` : ""} — no sales movement suggests a pricing, visibility, or demand issue.`);
  }

  // Top performers
  const topMover = allRows.find((r) => r.direction === "up" && (r.salesTotal ?? 0) > 0 && r.urgency === "low");
  if (topMover && actions.length < 3) {
    actions.push(`${topMover.label} is moving well — ensure stock stays ahead of demand and consider promoting it.`);
  }

  if (actions.length === 0) {
    actions.push("Stock levels are stable — continue monitoring at your normal cadence and check reorder points for any items approaching minimums.");
  }

  return actions.slice(0, 3);
}

/**
 * Hedged stockout projection based on the observed depletion rate.
 * Returns null when no depletion data, direction is not down, or horizon > 180 days.
 *
 * durationDays must come from the recorded period (dataset.periodStart → dataset.periodEnd).
 * velocityPerTime is NOT used — the rate is computed directly from salesTotal.
 *
 * @param {Row | null} primaryRow
 * @param {Row[]}      allRows
 * @param {number}     durationDays  Length of the recorded period (0 = unknown).
 * @returns {string | null}
 */
export function generateProjection(primaryRow, allRows, durationDays) {
  if (!primaryRow) return null;

  const { label, endValue, direction } = primaryRow;
  if (direction !== "down") return null;
  if (!Number.isFinite(endValue) || endValue <= 0) return null;

  const currentRate = extractRate(primaryRow, durationDays);
  if (currentRate === null || currentRate <= 0) return null;

  const daysToZero = Math.round(endValue / currentRate);
  if (daysToZero > 180) return null;

  return `At this pace, ${label} could run out of stock in roughly ${daysToZero} day${daysToZero !== 1 ? "s" : ""}. This is based on your recorded outflow rate — actual timing will depend on demand shifts and any restocking you have planned.`;
}

// ── Rate + projection model ───────────────────────────────────────────────────

/**
 * Depletion rate: units sold per day, derived directly from activity data.
 * Uses salesTotal (units sold this period) ÷ durationDays.
 *
 * Does NOT use velocityPerTime — that field is optional pipeline metadata and
 * not a reliable primary input for goal calculations.
 *
 * Returns null when durationDays ≤ 0 or no sales were recorded.
 *
 * @param {Row}   row
 * @param {number} durationDays  Length of the recorded period in days.
 * @returns {number | null}
 */
export function extractRate(row, durationDays) {
  const sold = Number(row?.salesTotal ?? 0);
  if (!Number.isFinite(durationDays) || durationDays <= 0 || sold === 0) return null;
  return sold / durationDays; // units sold per day
}

/**
 * Forward model: projected stock level after `days` at the current depletion rate.
 *
 * @param {number} rate    Units depleted per day.
 * @param {number} current Current stock (endValue).
 * @param {number} days    Days to project forward.
 * @returns {number | null}
 */
export function projectOutcome(rate, current, days) {
  if (!Number.isFinite(rate) || !Number.isFinite(current) || !Number.isFinite(days)) return null;
  return current - rate * days;
}

/**
 * Inverse model: maximum allowable daily depletion to remain at or above `target` after `days`.
 *
 * @param {number} target   Minimum acceptable stock level.
 * @param {number} current  Current stock level.
 * @param {number} days     Days until deadline.
 * @returns {number | null}
 */
export function requiredRate(target, current, days) {
  if (!Number.isFinite(target) || !Number.isFinite(current) || !Number.isFinite(days) || days <= 0) return null;
  return (current - target) / days; // max allowable daily loss
}

/** Copy only — depletion “stress” = current outflow ÷ max allowable. */
function depletionRatioRealismAppend(currentRate, maxAllowableRate) {
  if (
    !Number.isFinite(currentRate) || !Number.isFinite(maxAllowableRate) ||
    maxAllowableRate <= 0
  ) return "";
  const r = currentRate / maxAllowableRate;
  if (r > 5) return " At this level, the target is likely not realistic within the timeframe.";
  if (r > 3) return " This would require a major increase from your current pace.";
  return "";
}

function inventoryGoalDataConfidence(durationDays, soldInPeriod) {
  const parts = [];
  if (durationDays > 0 && durationDays < 3) {
    parts.push(`Based on a short ${durationDays}-day period, this estimate may vary more than usual.`);
  }
  if (soldInPeriod > 0 && soldInPeriod < 4) {
    parts.push("With limited activity data, projections may be less reliable.");
  }
  if (parts.length === 0) return "";
  return " " + parts.join(" ");
}

const INVENTORY_GOAL_GAP_WHY =
  " This gap is mainly driven by the difference between your current pace and the time remaining.";

/**
 * @param {number} ratioCurrentOverMax
 */
function inventoryMostPracticalOption(ratioCurrentOverMax) {
  if (Number.isFinite(ratioCurrentOverMax) && ratioCurrentOverMax > 3) {
    return "Most practical option: A planned restock that lands before the shortfall window is usually the most reliable lever when you are this far from the line.";
  }
  return "Most practical option: Pairing a modest restock with a small pull-back on outflow is often easier than betting everything on a single big move.";
}

const INVENTORY_ON_TRACK_BEST =
  "Most practical option: Keep a simple watch on stock and lead times so you can react if demand steps up.";

/**
 * Goal-based analysis: compares target stock level + deadline against the observed
 * depletion rate, then describes the projected outcome, required action, and feasibility.
 *
 * Output structure:
 *   1. Restate goal
 *   2. Projected outcome at current rate
 *   3. Required rate / restock to meet goal
 *   4. Feasibility note (if gap is material)
 *   5. 2–3 strategies (paths forward)
 *
 * Returns null when no goal is set or deadline has passed.
 * Returns a { summary, strategies } object when data is insufficient (strategies = []).
 *
 * @param {Row | null} primaryRow
 * @param {Row[]}      allRows
 * @param {{ targetValue?: string | number, targetDate?: string } | null | undefined} goal
 * @param {number}     durationDays  Length of the recorded period (0 = unknown).
 * @returns {{ summary: string, strategies: string[], rateDerivation?: string } | null}
 */
export function generateGoalAnalysis(primaryRow, allRows, goal, durationDays) {
  if (!primaryRow || !goal) return null;

  const targetValue = Number(goal.targetValue);
  const targetDate  = String(goal.targetDate ?? "").trim();
  if (!Number.isFinite(targetValue) || targetValue < 0 || !targetDate) return null;

  const currentUnits = Number(primaryRow.endValue ?? 0);
  if (!Number.isFinite(currentUnits)) {
    return { summary: "Not enough data to calculate a projection.", strategies: [] };
  }

  const currentRate = extractRate(primaryRow, durationDays);

  // No depletion data — answer the static question only
  if (currentRate === null) {
    if (currentUnits >= targetValue) {
      return {
        summary: `${primaryRow.label} is at ${currentUnits} units — above your target of ${targetValue}. No outflow was recorded this period, so you look on track as long as demand stays low. With limited activity data, projections may be less reliable.`,
        strategies: [
          "Keep monitoring — stock levels can shift quickly, so regular check-ins help you catch changes early.",
          "Have a restock plan ready — knowing your lead times means you can act quickly if demand picks up.",
          "Most practical option: Keep a light monitoring cadence and keep a restock path ready the moment outflow returns.",
        ],
      };
    }
    const needed = Math.ceil(targetValue - currentUnits);
    return {
      summary: `${primaryRow.label} is at ${currentUnits} units, which is below your target of ${targetValue}. No outflow was recorded this period — to reach the target, you'd need a restock of roughly ${needed} unit${needed !== 1 ? "s" : ""}. With limited activity data, projections may be less reliable.${INVENTORY_GOAL_GAP_WHY}`,
      strategies: [
        "Restock — bringing inventory back above the target with a planned order is the most direct path.",
        "Assess demand first — if there's been little recent activity, it may be worth checking whether demand has changed before committing to a large order.",
        "Most practical option: Sizing a restock to the gap you have now is usually clearer than waiting without sales signal.",
      ],
    };
  }

  const daysToDeadline = daysBetween(new Date(), new Date(targetDate));
  if (daysToDeadline <= 0) return null;

  const projectedValue   = Math.round(projectOutcome(currentRate, currentUnits, daysToDeadline) ?? 0);
  const daysRemaining    = `${daysToDeadline} day${daysToDeadline !== 1 ? "s" : ""}`;
  const durationLabel    = `${durationDays} day${durationDays !== 1 ? "s" : ""}`;
  const soldInPeriod     = Number(primaryRow.salesTotal ?? 0);

  if (projectedValue >= targetValue) {
    const rateDerivation = `Depletion: ${soldInPeriod} units over ${durationLabel} — ${formatRateDerivationPaceAbout(currentRate, "units")}.`;
    let summary = `Your goal is to keep at least ${targetValue} units in stock by ${formatDate(targetDate)} — you have ${daysRemaining} remaining. Starting from your current stock of ${currentUnits} units, the current depletion rate is ${formatRateDerivationPaceAbout(currentRate, "units")} (${soldInPeriod} units sold across the ${durationLabel} period). At that rate, you're projected to have around ${projectedValue} units by the deadline — on track to stay above your minimum.`;
    summary += inventoryGoalDataConfidence(durationDays, soldInPeriod);
    return {
      summary,
      rateDerivation,
      strategies: [
        "Keep monitoring — demand can shift, so regular stock checks help you stay ahead of any surprises.",
        "Have a restock plan ready — knowing your lead times means you can act quickly if outflow accelerates.",
        INVENTORY_ON_TRACK_BEST,
      ],
    };
  }

  // Below target: compute shortfall, max allowable rate, and feasibility
  const daysToShortfall  = Math.max(0, Math.round((currentUnits - targetValue) / currentRate));
  const shortfall        = Math.abs(Math.round(targetValue - projectedValue));
  const maxAllowableRate = requiredRate(targetValue, currentUnits, daysToDeadline);
  const maxRatePhrase    = maxAllowableRate !== null && maxAllowableRate > 0
    ? formatRateDerivationPaceAbout(maxAllowableRate, "units")
    : null;

  let summary = `Your goal is to keep at least ${targetValue} units in stock by ${formatDate(targetDate)} — you have ${daysRemaining} remaining. Starting from your current stock of ${currentUnits} units, the current depletion rate is ${formatRateDerivationPaceAbout(currentRate, "units")} (${soldInPeriod} units sold across the ${durationLabel} period). At that rate, stock would drop below the target in roughly ${daysToShortfall} day${daysToShortfall !== 1 ? "s" : ""}, ending up around ${projectedValue} units — about ${shortfall} unit${shortfall !== 1 ? "s" : ""} short of your minimum.`;
  summary += ` To stay above that level, you'd need to slow outflow to ${maxRatePhrase ?? "a much lower daily level than you have now"}, or plan a restock of roughly ${shortfall} unit${shortfall !== 1 ? "s" : ""}.`;

  const note = maxAllowableRate !== null && maxAllowableRate > 0
    ? depletionFeasibilityNote(currentRate, maxAllowableRate)
    : null;
  if (note) summary += ` ${note}`;

  const ratioStress = maxAllowableRate !== null && maxAllowableRate > 0
    ? currentRate / maxAllowableRate
    : NaN;
  if (maxAllowableRate !== null && maxAllowableRate > 0) {
    summary += depletionRatioRealismAppend(currentRate, maxAllowableRate);
  }
  summary += INVENTORY_GOAL_GAP_WHY;
  summary += inventoryGoalDataConfidence(durationDays, soldInPeriod);

  const rateDerivation = `Depletion: ${soldInPeriod} units over ${durationLabel} — ${formatRateDerivationPaceAbout(currentRate, "units")}.`;
  const strats         = [
    "Reduce outflow — consider slowing sales velocity through pricing adjustments or by pausing promotions on this item.",
    "Restock — placing an order before the shortfall window closes gives you breathing room to stay above the minimum.",
    "Do both — a modest restock combined with a small reduction in outflow can often be easier to achieve than relying on either approach alone.",
  ];
  strats.push(inventoryMostPracticalOption(ratioStress));
  return {
    summary,
    rateDerivation,
    strategies: strats,
  };
}

// ── Enrich ────────────────────────────────────────────────────────────────────

// ── Enrich ────────────────────────────────────────────────────────────────────

/**
 * Attach inventory analysis to the merged pipeline rows.
 * Sets analyzerIntent, intentPrimary, and intentAnalysis on the appropriate rows.
 *
 * Reads dataset.periodStart / dataset.periodEnd to compute durationDays for
 * rate calculations. No event data is accessed directly.
 *
 * @param {Row[]} merged
 * @param {{
 *   goal?:        { targetValue?: string | number, targetDate?: string } | null,
 *   periodStart?: string,
 *   periodEnd?:   string,
 * }} dataset
 * @returns {Row[]}
 */
export function enrichInventoryForOutput(merged, dataset) {
  if (!Array.isArray(merged) || merged.length === 0) return merged ?? [];

  const goal = dataset?.goal ?? null;
  const durationDays =
    dataset?.periodStart && dataset?.periodEnd
      ? Math.max(0, daysBetween(dataset.periodStart, dataset.periodEnd))
      : 0;

  const primary = pickPrimary(merged);

  const interpretation = generateInterpretation(primary, merged);
  const actions        = generateActions(primary, merged);
  const projection     = generateProjection(primary, merged, durationDays);
  const goalAnalysis   = generateGoalAnalysis(primary, merged, goal, durationDays);

  return merged.map((row) => ({
    ...row,
    analyzerIntent: "inventory",
    ...(row.entityId === primary?.entityId
      ? { intentPrimary: true, intentAnalysis: { interpretation, actions, projection, goalAnalysis } }
      : {}),
  }));
}

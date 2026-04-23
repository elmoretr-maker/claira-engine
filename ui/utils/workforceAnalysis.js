/**
 * workforceAnalysis.js
 *
 * Post-processing for Business Analyzer "workforce" intent.
 * Pure functions — no I/O, no side effects.
 *
 * Consumes ONLY merged[] from the pipeline. No raw dataset event access.
 * runPipeline.js ensures merged[] is always populated for this intent via
 * transformEventsToMetrics() which runs in place of computeStateDelta.
 *
 * Pipeline field semantics for workforce:
 *   salesTotal    = output completed (sum of saleEvents)   — endValue
 *   deliveryTotal = output assigned  (sum of deliveryEvents) — startValue
 *   netDelta      = completed − assigned
 *   direction     = "up" | "down" | "flat"
 *
 * dataset fields read (config, not event access):
 *   workforceOutputType ("tasks" | "hours" | "revenue") — for unit labels
 *   periodStart / periodEnd — for durationDays in throughput calculation
 *   goal — user-set completion target and deadline
 *
 * Rate model — throughput (output per day):
 *   currentRate  = salesTotal / durationDays   ← consistent unit: output/day
 *   projection   = currentRate × daysToDeadline
 *   neededRate   = targetValue / daysToDeadline
 *
 * completionRate (ratio) is retained as a display helper for interpretation and
 * actions only — it is NOT used for goal projections or rate comparisons.
 *
 * velocityPerTime is NOT used in any calculation in this file.
 */

import { daysBetween, formatDate, feasibilityNote, formatRateDerivationPaceAbout } from "./rateUtils.js";

/** @typedef {import("./engineDisplayFormatters.js").MergedEntity & { analyzerIntent?: string, intentPrimary?: boolean, intentAnalysis?: object }} Row */

// ── Unit labels ───────────────────────────────────────────────────────────────

/**
 * @param {"tasks"|"hours"|"revenue"|string|null|undefined} outputType
 * @returns {{ done: string, assigned: string }}
 */
function unitLabels(outputType) {
  switch (outputType) {
    case "hours":   return { done: "hours logged",      assigned: "hours scheduled" };
    case "revenue": return { done: "revenue generated", assigned: "target / quota"  };
    default:        return { done: "tasks completed",   assigned: "tasks assigned"  };
  }
}

// ── Completion rate helper ────────────────────────────────────────────────────

/** @param {Row} row @returns {number | null} */
function completionRate(row) {
  const assigned = row.deliveryTotal ?? 0;
  if (assigned === 0) return null;
  return (row.salesTotal ?? 0) / assigned;
}

// ── Rate + projection model ───────────────────────────────────────────────────

/**
 * Throughput rate: output completed per day.
 *
 * Standardized on throughput (output/day) rather than completion ratio to provide
 * a consistent unit for projections, comparisons, and deadline math.
 *
 * completionRate (ratio) is retained as a separate display helper for interpretation
 * and actions, but is NOT used for goal analysis or projection calculations.
 *
 * Returns null when durationDays ≤ 0 or no output was recorded.
 *
 * @param {Row}    row
 * @param {number} durationDays  Length of the recorded period in days.
 * @returns {number | null}
 */
export function extractRate(row, durationDays) {
  const completed = Number(row?.salesTotal ?? 0);
  if (!Number.isFinite(durationDays) || durationDays <= 0 || completed === 0) return null;
  return completed / durationDays; // output per day
}

/**
 * Forward model: projected team output given throughput rate and available days.
 *
 * @param {number} throughputPerDay  Output per day (units/day).
 * @param {number} days              Days available.
 * @returns {number | null}
 */
export function projectOutcome(throughputPerDay, days) {
  if (!Number.isFinite(throughputPerDay) || !Number.isFinite(days)) return null;
  return Math.round(throughputPerDay * days);
}

/**
 * Inverse model: required throughput per day to complete `target` units by deadline.
 *
 * @param {number} target  Total output needed.
 * @param {number} days    Days until deadline.
 * @returns {number | null}
 */
export function requiredRate(target, days) {
  if (!Number.isFinite(target) || !Number.isFinite(days) || days <= 0) return null;
  return target / days;
}

const WORKFORCE_BEHIND_STRATEGY_CLEAR = "Clear blockers — even small impediments accumulate; finding what's slowing the team often has an outsized effect on throughput.";
const WORKFORCE_BEHIND_STRATEGY_REDIST = "Redistribute workload — if some team members are underloaded, shifting assignments can raise overall capacity without adding people.";
const WORKFORCE_BEHIND_STRATEGY_TIMELINE = "Revisit the timeline — if the deadline is flexible, a modest extension may be a more sustainable option than a sharp increase in pace.";

/**
 * If the required pace is more than 3× current, list the timeline option first; otherwise
 * keep the default order. Reordering only; no new strategies.
 */
function orderWorkforceStrategiesForGap(currentRate, neededRate) {
  if (
    Number.isFinite(currentRate) && currentRate > 0 &&
    Number.isFinite(neededRate) && neededRate > currentRate * 3
  ) {
    return [WORKFORCE_BEHIND_STRATEGY_TIMELINE, WORKFORCE_BEHIND_STRATEGY_CLEAR, WORKFORCE_BEHIND_STRATEGY_REDIST];
  }
  return [WORKFORCE_BEHIND_STRATEGY_CLEAR, WORKFORCE_BEHIND_STRATEGY_REDIST, WORKFORCE_BEHIND_STRATEGY_TIMELINE];
}

/** Copy only — not used in numeric model. */
function workforceGoalDataConfidence(durationDays, totalCompleted) {
  const parts = [];
  if (durationDays > 0 && durationDays < 3) {
    parts.push(`Based on a short ${durationDays}-day period, this estimate may vary more than usual.`);
  }
  if (totalCompleted > 0 && totalCompleted < 4) {
    parts.push("With limited activity data, projections may be less reliable.");
  }
  if (parts.length === 0) return "";
  return " " + parts.join(" ");
}

/** @param {number} currentPace  Required ÷ current ratio uses same units as the model. */
function paceRatioRealismAppend(currentPace, requiredPace) {
  if (!Number.isFinite(currentPace) || !Number.isFinite(requiredPace) || currentPace <= 0 || requiredPace <= 0) return "";
  const r = requiredPace / currentPace;
  if (r > 5) return " At this level, the target is likely not realistic within the timeframe.";
  if (r > 3) return " This would require a major increase from your current pace.";
  return "";
}

const GOAL_GAP_WHY =
  " This gap is mainly driven by the difference between your current pace and the time remaining.";

/**
 * @param {"onTrack" | "behind"} kind
 * @param {number} [neededRate]
 * @param {number} [currentRate]
 */
function workforceMostPracticalOption(kind, neededRate, currentRate) {
  if (kind === "onTrack") {
    return "Most practical option: Keep the current rhythm and catch small delays before they add up to real slip.";
  }
  if (!Number.isFinite(neededRate) || !Number.isFinite(currentRate) || currentRate <= 0) {
    return "Most practical option: Tackle blockers and workload balance first — they are often the fastest way to change throughput without adding people.";
  }
  if (neededRate > 3 * currentRate) {
    return "Most practical option: Revisiting the timeline slightly, if you can, would bring the required pace much closer to what the team is already doing.";
  }
  return "Most practical option: Clearing blockers and evening out work is often the smallest change with the largest effect on output.";
}

/**
 * Goal-based analysis: projects whether the team will hit a completion target by
 * the deadline, using throughput-per-day as the single consistent rate model.
 *
 * Falls back to a completion-ratio message when durationDays is unknown (no period set).
 * The fallback does not feed into any rate comparison — it is informational only.
 *
 * Output structure:
 *   1. Restate goal
 *   2. Show projected outcome at current throughput
 *   3. Show required throughput if not on track
 *   4. Feasibility note if gap is material
 *   5. 2–3 strategies (paths forward)
 *
 * Returns null when no goal. Returns a { summary, strategies } object otherwise.
 *
 * @param {Row | null}                 primaryRow
 * @param {Row[]}                      allRows
 * @param {{ targetValue?: string | number, targetDate?: string } | null | undefined} goal
 * @param {string | null | undefined}  outputType
 * @param {number}                     durationDays  Historical period length (0 = unknown).
 * @returns {{ summary: string, strategies: string[], rateDerivation?: string } | null}
 */
export function generateGoalAnalysis(primaryRow, allRows, goal, outputType, durationDays) {
  if (!primaryRow || !goal) return null;

  const targetValue = Number(goal.targetValue);
  if (!Number.isFinite(targetValue) || targetValue <= 0) return null;

  const { done: doneLabel } = unitLabels(outputType);
  const unit = doneLabel.split(" ")[0]; // "tasks" | "hours" | "revenue"

  const totalCompleted = allRows.reduce((s, r) => s + Number(r.salesTotal   ?? 0), 0);
  const totalAssigned  = allRows.reduce((s, r) => s + Number(r.deliveryTotal ?? 0), 0);
  if (totalCompleted === 0 && totalAssigned === 0) {
    return { summary: "Not enough data to calculate a projection.", strategies: [] };
  }

  const targetDate     = String(goal.targetDate ?? "").trim();
  const hasDeadline    = !!targetDate;
  const daysToDeadline = hasDeadline ? daysBetween(new Date(), new Date(targetDate)) : null;

  // ── Throughput path (primary — when both period duration and deadline are known) ──
  if (durationDays > 0 && daysToDeadline !== null && daysToDeadline > 0) {
    const currentRate    = totalCompleted / durationDays; // output/day
    const projectedValue = projectOutcome(currentRate, daysToDeadline) ?? 0;
    const neededRate     = requiredRate(targetValue, daysToDeadline) ?? 0;
    const gap            = Math.round(targetValue - projectedValue);
    const daysRemaining  = `${daysToDeadline} day${daysToDeadline !== 1 ? "s" : ""}`;
    const durationLabel  = `${durationDays} day${durationDays !== 1 ? "s" : ""}`;

    if (projectedValue >= targetValue) {
      const rateDerivation = `Pace: ${totalCompleted} ${unit} over ${durationLabel} — ${formatRateDerivationPaceAbout(currentRate, unit)}.`;
      let summary = `Your goal is to complete ${targetValue} ${unit} by ${formatDate(targetDate)} — you have ${daysRemaining} remaining. Based on your recent period (${totalCompleted} ${unit} completed in ${durationLabel}), your team's current pace is ${formatRateDerivationPaceAbout(currentRate, unit)}. At that pace, the team is on track — projected to add around ${projectedValue} more ${unit} by the deadline.`;
      summary += workforceGoalDataConfidence(durationDays, totalCompleted);
      return {
        summary,
        rateDerivation,
        strategies: [
          "Maintain the current rhythm — avoid overloading team members to preserve the pace that's working.",
          "Watch for early blockers — throughput can drop quickly when unresolved issues are allowed to accumulate.",
          workforceMostPracticalOption("onTrack"),
        ],
      };
    }

    let summary = `Your goal is to complete ${targetValue} ${unit} by ${formatDate(targetDate)} — you have ${daysRemaining} remaining. Based on your recent period (${totalCompleted} ${unit} completed in ${durationLabel}), your team's current pace is ${formatRateDerivationPaceAbout(currentRate, unit)}. At that pace, the team will add approximately ${projectedValue} more ${unit} by the deadline — coming in about ${gap} ${unit} short of ${targetValue}. To close that gap, the team would need to average ${formatRateDerivationPaceAbout(neededRate, unit)}.`;
    const note = feasibilityNote(currentRate, neededRate);
    if (note) summary += ` ${note}`;
    summary += paceRatioRealismAppend(currentRate, neededRate);
    summary += GOAL_GAP_WHY;
    summary += workforceGoalDataConfidence(durationDays, totalCompleted);
    const rateDerivation = `Pace: ${totalCompleted} ${unit} over ${durationLabel} — ${formatRateDerivationPaceAbout(currentRate, unit)}.`;
    const strategies = orderWorkforceStrategiesForGap(currentRate, neededRate);
    strategies.push(workforceMostPracticalOption("behind", neededRate, currentRate));
    return {
      summary,
      rateDerivation,
      strategies,
    };
  }

  // ── Completion-ratio path (informational fallback when period duration is unknown) ──
  if (totalAssigned > 0) {
    const ratePct        = Math.round((totalCompleted / totalAssigned) * 100);
    const daysRemaining  = daysToDeadline !== null && daysToDeadline > 0
      ? ` — ${daysToDeadline} day${daysToDeadline !== 1 ? "s" : ""} remaining`
      : "";
    if (totalCompleted >= totalAssigned) {
      let summary = `Your team is completing ${ratePct}% of assigned ${doneLabel}${daysRemaining}. At this rate, you appear on track to reach ${targetValue} ${unit}${hasDeadline ? ` by ${formatDate(targetDate)}` : ""} — as long as assignment volumes stay consistent. Set a period start and end for a throughput-based projection.`;
      summary += workforceGoalDataConfidence(durationDays, totalCompleted);
      return {
        summary,
        strategies: [
          "Maintain the current rhythm — avoid overloading team members to preserve the pace that's working.",
          "Add a period start and end to unlock a throughput-based projection with more precision.",
          workforceMostPracticalOption("onTrack"),
        ],
      };
    }
    const neededByRate = Math.ceil(targetValue / (totalCompleted / totalAssigned));
    let summary = `Your team is completing ${ratePct}% of assigned ${doneLabel}${daysRemaining}. At this rate, you'd need around ${neededByRate} ${unit} assigned to reach ${targetValue}${hasDeadline ? ` by ${formatDate(targetDate)}` : ""}. Set a period start and end to unlock a throughput-based projection.`;
    summary += workforceGoalDataConfidence(durationDays, totalCompleted);
    summary += GOAL_GAP_WHY;
    return {
      summary,
      strategies: [
        "Most practical option: Add a period with start and end dates first — without it, the clearest next step is to unlock throughput-based numbers before pushing harder on assignments.",
      ],
    };
  }

  return { summary: "Not enough data to calculate a projection.", strategies: [] };
}

// ── Analysis generators ───────────────────────────────────────────────────────

/**
 * 1–2 sentence summary of team output performance.
 *
 * @param {Row | null}                 primaryRow
 * @param {Row[]}                      allRows
 * @param {string | null | undefined}  outputType
 * @returns {string}
 */
export function generateInterpretation(primaryRow, allRows, outputType) {
  if (!primaryRow) return "Not enough data to analyze.";

  const { label, salesTotal, deliveryTotal } = primaryRow;
  const { done: doneLabel } = unitLabels(outputType);
  const total    = allRows.length;

  // No activity recorded
  if (allRows.every((r) => (r.salesTotal ?? 0) === 0 && (r.deliveryTotal ?? 0) === 0)) {
    return "No output data was recorded for this period — add completed and assigned figures to generate an analysis.";
  }

  const assigned = deliveryTotal ?? 0;
  let sentence;

  if (assigned > 0) {
    const rate = (salesTotal ?? 0) / assigned;
    const pct  = Math.round(rate * 100);

    if (rate >= 0.9) {
      sentence = `${label} has a strong completion rate — ${salesTotal} of ${assigned} ${doneLabel} (${pct}%).`;
    } else if (rate >= 0.7) {
      sentence = `${label} completed ${salesTotal} of ${assigned} ${doneLabel} (${pct}%) — on track with room for improvement.`;
    } else {
      sentence = `${label} has a low completion rate — ${salesTotal} of ${assigned} ${doneLabel} completed (${pct}%), which may indicate a capacity or support issue.`;
    }
  } else {
    sentence = (salesTotal ?? 0) > 0
      ? `${label} recorded ${salesTotal} ${doneLabel} this period — no assigned target was provided for comparison.`
      : `No output was recorded for ${label} this period.`;
  }

  if (total > 1) {
    const struggling = allRows.filter((r) => { const cr = completionRate(r); return cr !== null && cr < 0.7; }).length;
    const strong     = allRows.filter((r) => { const cr = completionRate(r); return cr !== null && cr >= 0.9; }).length;

    if (struggling > 0) {
      sentence += ` ${struggling} team member${struggling > 1 ? "s are" : " is"} below a 70% completion rate.`;
    } else if (strong > 0) {
      sentence += ` ${strong} team member${strong > 1 ? "s are" : " is"} at or above 90%.`;
    }
  }

  return sentence;
}

/**
 * 1–3 specific, actionable recommendations.
 *
 * @param {Row | null}                 primaryRow
 * @param {Row[]}                      allRows
 * @param {string | null | undefined}  outputType
 * @returns {string[]}
 */
export function generateActions(primaryRow, allRows, outputType) {
  if (!primaryRow) return [];

  // No activity recorded
  if (allRows.every((r) => (r.salesTotal ?? 0) === 0 && (r.deliveryTotal ?? 0) === 0)) {
    return ["Add completed and assigned output data to see specific recommendations."];
  }

  const actions = [];
  const { done: doneLabel } = unitLabels(outputType);

  // Under-performers (below 70% completion)
  const struggling = allRows.filter((r) => { const cr = completionRate(r); return cr !== null && cr < 0.7; });
  if (struggling.length > 0) {
    const names = struggling.slice(0, 2).map((r) => r.label).join(", ");
    const more  = struggling.length > 2 ? ` and ${struggling.length - 2} other${struggling.length - 2 > 1 ? "s" : ""}` : "";
    actions.push(`Check in with ${names}${more} — completion rates are below 70%, which may indicate blockers, overloading, or unclear priorities.`);
  }

  // Overloaded (fewer than 50% completed of what was assigned)
  const overloaded = allRows.filter((r) => { const cr = completionRate(r); return cr !== null && cr < 0.5; });
  if (overloaded.length > 0 && actions.length < 3) {
    const noun = doneLabel.split(" ")[0]; // "tasks" / "hours" / "revenue"
    actions.push(`Review assignment volume — ${overloaded.length > 1 ? `${overloaded.length} team members have` : `${overloaded[0].label} has`} significantly more ${noun} assigned than completed; consider redistributing workload.`);
  }

  // High performers (at or above 90%)
  const highPerformers = allRows.filter((r) => { const cr = completionRate(r); return cr !== null && cr >= 0.9 && (r.salesTotal ?? 0) > 0; });
  if (highPerformers.length > 0 && actions.length < 3) {
    const names = highPerformers.slice(0, 2).map((r) => r.label).join(", ");
    actions.push(`${names} ${highPerformers.length === 1 ? "is" : "are"} completing at a high rate — consider whether ${highPerformers.length === 1 ? "they" : "these team members"} can take on additional assignments or mentor others.`);
  }

  if (actions.length === 0) {
    actions.push("Team output appears consistent — continue tracking over multiple periods to identify patterns and support individuals before issues escalate.");
  }

  return actions.slice(0, 3);
}

/**
 * Hedged capacity outlook based on current completion rate.
 * Returns null when there is no assigned comparison or the rate is healthy.
 *
 * @param {Row | null}                 primaryRow
 * @param {Row[]}                      allRows
 * @param {string | null | undefined}  outputType
 * @returns {string | null}
 */
export function generateProjection(primaryRow, allRows, outputType) {
  if (!primaryRow) return null;

  const { label, salesTotal, deliveryTotal } = primaryRow;
  if ((deliveryTotal ?? 0) === 0) return null;

  const rate = (salesTotal ?? 0) / deliveryTotal;
  if (!Number.isFinite(rate)) return null;

  const validRates = allRows.map(completionRate).filter((r) => r !== null);
  const teamAvg    = validRates.length > 0
    ? validRates.reduce((s, r) => s + r, 0) / validRates.length
    : null;

  if (rate < 0.6) {
    return `At the current completion rate (${Math.round(rate * 100)}%), ${label} may continue to fall behind assigned volume. This is a single-period snapshot — multiple periods would clarify whether this is a trend or an anomaly.`;
  }

  if (teamAvg !== null && teamAvg < 0.7) {
    return `The team's average completion rate is ${Math.round(teamAvg * 100)}% this period. If the current assignment volumes and pace persist, unfinished work may accumulate. This is a single-period estimate.`;
  }

  return null;
}

// ── Enrich ────────────────────────────────────────────────────────────────────

/**
 * Attach workforce analysis to the merged pipeline rows.
 *
 * merged[] is guaranteed non-empty for this intent: runPipeline.js pre-processes
 * the dataset via transformEventsToMetrics(), ensuring pipeline output exists for
 * every entity.
 *
 * Dataset fields read (config access only):
 *   workforceOutputType — drives unit labels
 *   periodStart / periodEnd — derive durationDays for throughput calculation
 *   goal — user-set completion target and deadline
 *
 * @param {Row[]} merged
 * @param {{
 *   workforceOutputType?: string | null,
 *   periodStart?: string,
 *   periodEnd?:   string,
 *   goal?: { targetValue?: string | number, targetDate?: string } | null,
 * }} dataset
 * @returns {Row[]}
 */
export function enrichWorkforceForOutput(merged, dataset) {
  if (!Array.isArray(merged) || merged.length === 0) return merged ?? [];

  const outputType = dataset.workforceOutputType ?? null;
  const goal       = dataset.goal ?? null;

  // Derive historical period length for throughput rate (0 when not stored)
  const durationDays =
    dataset.periodStart && dataset.periodEnd
      ? Math.max(0, daysBetween(dataset.periodStart, dataset.periodEnd))
      : 0;

  // Primary = best completion rate, then by volume
  const primary = [...merged].sort((a, b) => {
    const ra = completionRate(a) ?? -1;
    const rb = completionRate(b) ?? -1;
    if (rb !== ra) return rb - ra;
    return (b.salesTotal ?? 0) - (a.salesTotal ?? 0);
  })[0];

  const interpretation = generateInterpretation(primary, merged, outputType);
  const actions        = generateActions(primary, merged, outputType);
  const projection     = generateProjection(primary, merged, outputType);
  const goalAnalysis   = generateGoalAnalysis(primary, merged, goal, outputType, durationDays);

  return merged.map((row) => ({
    ...row,
    analyzerIntent: "workforce",
    ...(row.entityId === primary?.entityId
      ? { intentPrimary: true, intentAnalysis: { interpretation, actions, projection, goalAnalysis } }
      : {}),
  }));
}

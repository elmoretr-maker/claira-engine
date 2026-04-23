/**
 * wellnessAnalysis.js
 *
 * Post-processing for Business Analyzer "weightloss" intent: attach wellness-specific
 * labels, linear projections from pipeline velocity, and goal-oriented suggestions.
 * Pure functions — no I/O.
 *
 * Rate model for goal analysis — weight change (lbs per day):
 *   currentRate  = (endValue − startValue) / durationDays   ← direct measurement
 *   projection   = currentWeight + currentRate × daysToDeadline
 *   neededRate   = (targetWeight − currentWeight) / daysToDeadline
 *
 * velocityPerTime is NOT used for goal analysis. It remains in projectLinearHorizons
 * for the horizon-display section (1 wk / 1 mo / 6 mo / 1 yr estimates) which is
 * separate from the decision engine.
 */

import {
  daysBetween,
  formatDate,
  feasibilityNote,
  formatWellnessWeightRateDerivationLine,
  formatWeightLbForDisplay,
  formatLbsPerWeekNumberForDisplay,
} from "./rateUtils.js";

const MS_PER_DAY = 86_400_000;

/** @type {Record<string, string>} */
const WELLNESS_ACTION_LABELS = {
  reorder:    "Adjust habits",
  promote:    "Keep momentum",
  monitor:    "Keep monitoring",
  investigate: "Review pattern",
};

/**
 * @param {string} action
 * @returns {string}
 */
export function wellnessActionLabel(action) {
  const a = String(action ?? "monitor");
  return WELLNESS_ACTION_LABELS[a] ?? a;
}

/**
 * Linear extrapolation of observed velocity (units/ms) over common horizons.
 *
 * @param {number} velocityPerTime
 * @returns {{
 *   perWeekLb: number,
 *   perMonthLb: number,
 *   perSixMonthsLb: number,
 *   perYearLb: number,
 * }}
 */
// ── Sleep quality classifier ──────────────────────────────────────────────────

/** @param {number|null} h @returns {"low"|"fair"|"adequate"|null} */
function classifySleepQuality(h) {
  if (!Number.isFinite(h)) return null;
  if (h < 6)  return "low";
  if (h < 7)  return "fair";
  return "adequate";
}

// ── Note parsers (FIX 1 & 2) ─────────────────────────────────────────────────
// Extract real numbers from free-text notes. Never invent values — return null
// when a pattern is absent. All parsing is conservative: first match only.

/**
 * Find the first explicit count in a note (e.g. "4 snacks", "3 meals", "2 times").
 * @param {string|null} note
 * @returns {number|null}
 */
function parseCountFromNote(note) {
  if (!note) return null;
  // Patterns: "4 snacks", "4 per day", "4/day", "4x", "4 times", "~4"
  const m = note.match(/(?:^|[\s(~])(\d{1,2})(?:\s*(?:snacks?|meals?|times?|x|\/day|per day)|\s|$)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 20 ? n : null; // sanity-gate: 1–20 is plausible
  }
  return null;
}

/**
 * Find the first explicit calorie value in a note (e.g. "~400 kcal", "400 cal", "400 calories").
 * @param {string|null} note
 * @returns {number|null}
 */
function parseKcalFromNote(note) {
  if (!note) return null;
  const m = note.match(/[~≈]?\s*(\d{2,5})\s*(?:kcal|cal(?:ories?)?)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    return n >= 50 && n <= 10000 ? n : null; // sanity-gate
  }
  return null;
}

// ── Wellness summary ──────────────────────────────────────────────────────────

/**
 * Build a structured summary of all wellness data available from the dataset and
 * the pipeline-enriched rows. Used as the single source of truth for all
 * downstream insight generators.
 *
 * @param {Record<string, unknown>} wellness   — dataset.wellness
 * @param {Record<string, unknown>} primaryRow — merged pipeline row for primary metric
 * @param {Record<string, unknown>[]} allRows  — all merged rows for this dataset
 * @returns {object} WellnessSummary
 */
export function computeWellnessSummary(wellness, primaryRow, allRows) {
  // ── FIX 1: per-domain single-source enforcement ───────────────────────────
  // wellness.structured is written by transformLogsToWellnessInputs.
  //
  // RULE: if a domain's structured block exists, ALL fields for that domain
  // come from structured — even when individual fields are null. This prevents
  // mixing a structured count with a parsed calorie value from an old note.
  //
  // FALLBACK: only use note parsers when a domain is ENTIRELY absent from
  // structured (i.e. legacy datasets that pre-date the intake step).
  const s                  = wellness?.structured ?? null;
  const hasStructuredData  = s !== null;
  const hasStructuredSleep  = s?.sleep  != null;
  const hasStructuredMeals  = s?.meals  != null;
  const hasStructuredSnacks = s?.snacks != null;

  // Sleep hours — sourced from structured OR legacy field; never both
  const sleepHoursRaw = hasStructuredSleep ? s.sleep.averageHours : wellness?.sleepHours;
  const sleepHours    = Number(sleepHoursRaw ?? NaN);
  const goalWeightLb  = Number(wellness?.goalWeightLb ?? NaN);

  const netDelta   = Number(primaryRow?.netDelta    ?? NaN);
  const endValue   = Number(primaryRow?.endValue    ?? NaN);
  const startValue = Number(primaryRow?.startValue  ?? NaN);
  const durationMs = Number(primaryRow?.timeRange?.durationMs ?? NaN);
  const periodCount = Number(primaryRow?.periodCount ?? 0);

  const durationDays = Number.isFinite(durationMs) ? Math.round(durationMs / MS_PER_DAY) : null;
  const perWeek = (Number.isFinite(netDelta) && durationDays !== null && durationDays > 0)
    ? (netDelta / durationDays) * 7 : null;

  const direction = String(primaryRow?.direction ?? "unknown");

  const weightChange = {
    value:      Number.isFinite(netDelta)   ? netDelta   : null,
    direction,
    durationDays,
    startValue: Number.isFinite(startValue) ? startValue : null,
    endValue:   Number.isFinite(endValue)   ? endValue   : null,
    perWeek,
  };

  const validGoal    = Number.isFinite(goalWeightLb) && goalWeightLb > 0;
  const weightToGoal = (validGoal && Number.isFinite(endValue)) ? endValue - goalWeightLb : null;

  // Sleep bedtime / wake — sourced from structured OR legacy fields; never both
  const rawBed  = hasStructuredSleep ? s.sleep.bedtime  : wellness?.sleepBed;
  const rawWake = hasStructuredSleep ? s.sleep.wakeTime : wellness?.sleepWake;

  const sleepValid = Number.isFinite(sleepHours);
  const sleep = {
    hoursPerNight: sleepValid ? sleepHours : null,
    bedTime:  (typeof rawBed  === "string" && rawBed)  ? rawBed  : null,
    wakeTime: (typeof rawWake === "string" && rawWake) ? rawWake : null,
    quality:  classifySleepQuality(sleepValid ? sleepHours : null),
  };

  const mealsNote  = typeof wellness?.mealsNote  === "string" && wellness.mealsNote.trim()  ? wellness.mealsNote.trim()  : null;
  const snacksNote = typeof wellness?.snacksNote === "string" && wellness.snacksNote.trim() ? wellness.snacksNote.trim() : null;

  // Per-domain single source (FIX 1).
  // Each domain is either ALL from structured OR ALL from note parsers — never mixed.
  // When structured domain exists but a field is null, null is kept (not patched from parsers).
  const meals = {
    note:          mealsNote,
    frequency:     hasStructuredMeals  ? (s.meals.count           ?? null) : parseCountFromNote(mealsNote),
    estimatedKcal: hasStructuredMeals  ? (s.meals.averageDailyKcal ?? null) : parseKcalFromNote(mealsNote),
  };
  const snacks = {
    note:          snacksNote,
    frequency:     hasStructuredSnacks ? (s.snacks.averagePerDay    ?? null) : parseCountFromNote(snacksNote),
    estimatedKcal: hasStructuredSnacks ? (s.snacks.averageDailyKcal ?? null) : parseKcalFromNote(snacksNote),
  };

  // totalDailyKcal — only computed when BOTH domains share the same source.
  // Combining one structured value with one parsed value produces a precision mismatch.
  const totalDailyKcal =
    (hasStructuredMeals && hasStructuredSnacks)
      ? (s.meals.averageDailyKcal != null && s.snacks.averageDailyKcal != null
          ? s.meals.averageDailyKcal + s.snacks.averageDailyKcal
          : null)
      : (!hasStructuredMeals && !hasStructuredSnacks &&
         meals.estimatedKcal != null && snacks.estimatedKcal != null)
          ? meals.estimatedKcal + snacks.estimatedKcal
          : null; // mixed sources — withheld to prevent false precision

  const rows = Array.isArray(allRows) ? allRows : [];

  const activityRow = rows.find(r => {
    if (r.wellnessPrimary) return false;
    const lbl = String(r.label ?? "").toLowerCase();
    return lbl.includes("step") || lbl.includes("activit") || lbl.includes("exercise") || lbl.includes("walk");
  }) ?? null;

  const calorieRow = rows.find(r => {
    if (r.wellnessPrimary) return false;
    const lbl = String(r.label ?? "").toLowerCase();
    return lbl.includes("calor") || lbl.includes("intake") || lbl.includes("kcal") || lbl.includes("food");
  }) ?? null;

  // Qualitative energy comparison — only when BOTH intake + activity rows exist
  let energyComparison = null;
  if (calorieRow && activityRow) {
    const cDir = String(calorieRow.direction ?? "unknown");
    const aDir = String(activityRow.direction  ?? "unknown");
    let qualitativeRead = "unclear";
    if      (cDir === "up"   && aDir !== "up")   qualitativeRead = "higher";
    else if (cDir === "down" && aDir !== "down")  qualitativeRead = "lower";
    else if (cDir === "up"   && aDir === "down")  qualitativeRead = "higher";
    else if (cDir === "down" && aDir === "up")    qualitativeRead = "lower";
    energyComparison = { qualitativeRead, confidence: "low", intakeTrend: cDir, activityTrend: aDir };
  }

  let consistencyLevel = "limited";
  if (periodCount >= 5) consistencyLevel = "good";
  else if (periodCount >= 3) consistencyLevel = "moderate";

  // FIX 3: expose structured activity so downstream functions can use it even
  // when no pipeline activityRow entity exists. Null when intake not used.
  const structuredActivity = s?.activity ?? null;

  // Dev debug — shows per-domain source, confirming no cross-domain mixing
  console.debug(
    "[wellness:summary] sleep=%s meals=%s snacks=%s | snacksFreq=%s snacksKcal=%s mealsFreq=%s mealsKcal=%s sleepH=%s actDays=%s",
    hasStructuredSleep  ? "structured" : "legacy",
    hasStructuredMeals  ? "structured" : "note-parsed",
    hasStructuredSnacks ? "structured" : "note-parsed",
    snacks.frequency    ?? "—", snacks.estimatedKcal ?? "—",
    meals.frequency     ?? "—", meals.estimatedKcal  ?? "—",
    sleep.hoursPerNight ?? "—",
    structuredActivity?.daysPerWeek ?? "—",
  );

  return {
    weightChange,
    goalWeightLb:      validGoal ? goalWeightLb : null,
    weightToGoal,
    sleep,
    meals,
    snacks,
    totalDailyKcal,
    activityRow,
    calorieRow,
    consistencyLevel,
    energyComparison,
    hasCalorieData:    calorieRow !== null,
    hasActivityData:   activityRow !== null,
    hasSleepData:      sleep.hoursPerNight !== null,
    hasMealsNote:      meals.note !== null,
    hasSnacksNote:     snacks.note !== null || snacks.frequency != null,
    periodCount,
    // FIX 3 — structured intake activity (may be null)
    structuredActivity,
    // FIX 5 — data integrity metadata
    hasStructuredData,
    dataQuality: s?.dataQuality ?? null,
    daysLogged:  s?.daysLogged  ?? null,
  };
}

// ── Actionable insights ───────────────────────────────────────────────────────

/**
 * Generate 2–4 prioritized actionable insights tied to actual user data.
 * Each follows the Observation → Impact → Action format.
 *
 * Priority order: weight/goal → sleep/activity → snacks → data quality
 *
 * Language rules (from design doc):
 *   - Every interpretive sentence carries at least one hedge ("may", "might", "appears", etc.)
 *   - User-specific numbers always referenced
 *   - No clinical or robotic phrasing
 *
 * @param {ReturnType<computeWellnessSummary>} summary
 * @returns {Array<{ id: string, observation: string, impact: string, action: string }>}
 */
export function generateActionableInsights(summary) {
  const insights = [];
  const {
    weightChange, goalWeightLb, weightToGoal,
    sleep, meals, snacks, activityRow, structuredActivity,
    consistencyLevel, hasSleepData, hasSnacksNote, hasMealsNote, periodCount,
  } = summary;

  // ── P1: Weight trend + goal ───────────────────────────────────────────────
  const wc   = weightChange;
  const abs  = wc.value != null ? Math.abs(wc.value).toFixed(1) : null;
  const rate = wc.perWeek != null ? ` (about ${Math.abs(wc.perWeek).toFixed(1)} lb/week)` : "";
  const dStr = wc.durationDays ? ` over ${wc.durationDays} day${wc.durationDays === 1 ? "" : "s"}` : "";

  if (wc.direction === "down" && abs !== null) {
    if (goalWeightLb != null && weightToGoal != null && weightToGoal > 0) {
      insights.push({
        id: "weight-progress",
        observation: `Your weight has decreased by ${abs} lb${dStr}${rate}.`,
        impact: `You're ${weightToGoal.toFixed(1)} lb from your stated goal of ${goalWeightLb} lb — at this pace, you're making progress without a drastic change in habits.`,
        action: `Keep logging your weight at the same time of day for consistency — morning readings after waking tend to be the most comparable across days.`,
      });
    } else {
      insights.push({
        id: "weight-down",
        observation: `Your weight has decreased by ${abs} lb${dStr}${rate}.`,
        impact: `A downward trend may support your goal — though a single reading can shift by 1–2 lb based on hydration, meals, or time of day, so the trend matters more than any one number.`,
        action: `Continue logging at a consistent time each day to keep readings comparable — at least 3 measurements will give a clearer trend line.`,
      });
    }
  } else if (wc.direction === "up" && abs !== null) {
    // FIX 4: anchor to actual behaviors if available
    const behaviorAnchor = snacks.frequency != null
      ? `${snacks.frequency} snacks per day`
      : hasMealsNote ? "your current meal pattern" : null;
    insights.push({
      id: "weight-up",
      observation: `Your weight has increased by ${abs} lb${dStr}.`,
      impact: `This may reflect ${behaviorAnchor ? `a combination of ${behaviorAnchor} and` : "changes in"} activity level, fluid retention, or parts of your routine not fully captured in the log.`,
      action: `If this direction isn't your goal, start by reviewing snack frequency and movement together — those two levers together tend to have more impact than either alone.`,
    });
  } else if (wc.direction === "flat") {
    // FIX 4: remove "relatively" — use actual net change if available
    const netStr = wc.value != null && Math.abs(wc.value) < 2
      ? `${Math.abs(wc.value).toFixed(1)} lb net change`
      : "minimal net change";
    insights.push({
      id: "weight-stable",
      observation: `Your weight shows ${netStr}${dStr} — the trend is flat for this period.`,
      impact: `If you're aiming for change, your current habits may be closely balanced — intake and output are roughly offsetting each other based on what's logged.`,
      action: `Adjusting one behavior at a time — either meal timing, snack frequency, or adding a short walk — makes it easier to see which change is actually moving the number.`,
    });
  }

  // ── P2a: Sleep (low or fair quality) ─────────────────────────────────────
  if (hasSleepData && (sleep.quality === "low" || sleep.quality === "fair")) {
    const hrs = sleep.hoursPerNight.toFixed(1);
    const gap = Math.abs(7 - sleep.hoursPerNight).toFixed(1);
    // FIX 6: anchor to actual bedtime and actual hours, not generic advice
    const bedTarget = sleep.bedTime
      ? ` — if you're currently going to bed around ${sleep.bedTime}, moving that ${gap} hour${Number(gap) === 1 ? "" : "s"} earlier would bring you to the commonly suggested range`
      : ` — that's ${gap} hour${Number(gap) === 1 ? "" : "s"} short of the commonly suggested range`;
    insights.push({
      id: "sleep-low",
      observation: `You're getting ${hrs} hours of sleep per night${bedTarget}.`,
      impact: `At ${hrs} hours, sleep may be affecting appetite — research links shorter sleep to increased hunger signals the next day, which can make snacking harder to manage.`,
      action: `Try moving bedtime 20–30 minutes earlier for one week and track whether hunger or snacking patterns change — it's a small shift with potentially noticeable effects.`,
    });
  }

  // ── P2b: Activity — pipeline metric declining OR structured intake ────────
  if (activityRow && activityRow.direction === "down") {
    const lbl       = activityRow.label ?? "activity";
    const endVal    = Number.isFinite(activityRow.endValue) ? activityRow.endValue.toLocaleString() : null;
    const endClause = endVal ? ` (currently at ${endVal})` : "";
    insights.push({
      id: "activity-down",
      observation: `Your ${lbl}${endClause} has been trending down this period.`,
      impact: `Lower recorded ${lbl} means the activity side of your intake-vs-movement balance is shrinking — if intake stays the same, that gap may widen over time.`,
      action: `Adding 20–30 minutes of movement 2–3 times per week is a realistic starting point — even short walks tend to show up in step and activity metrics fairly quickly.`,
    });
  } else if (!activityRow && structuredActivity?.daysPerWeek != null && insights.length < 4) {
    // FIX 3: structured intake has activity data but no pipeline entity row exists.
    // Surface it as an actionable insight so user data is never silently dropped.
    const d    = structuredActivity.daysPerWeek;
    const m    = structuredActivity.avgMinutesPerSession;
    const intens = structuredActivity.intensity;
    const dFmt = Number.isInteger(d) ? String(d) : d.toFixed(1);
    const mStr = m ? ` (${m} min/session)` : "";
    const iStr = intens && intens !== "moderate" ? `, ${intens} intensity` : "";
    if (d > 0) {
      insights.push({
        id: "activity-intake",
        observation: `You logged about ${dFmt} active day${Math.round(d) === 1 ? "" : "s"} per week${mStr}${iStr}.`,
        impact: d < 3
          ? `${dFmt} active days per week is a starting point — increasing to 3–4 days tends to have a bigger effect on the intake-vs-movement balance over time.`
          : `${dFmt} active days per week is a solid foundation — maintaining this alongside your dietary habits supports gradual progress.`,
        action: d < 5
          ? `Adding one more active session per week — even a 20-minute walk — builds consistency without a drastic change to your routine.`
          : `Varying your session types (strength, cardio, flexibility) can prevent plateaus at this activity level.`,
      });
    }
  }

  // ── P3a: Snacks — FIX 6: use real frequency + kcal if parsed ────────────
  if (hasSnacksNote && insights.length < 4) {
    const freq    = snacks.frequency;
    const kcal    = snacks.estimatedKcal;
    const freqStr = freq != null ? `${freq} snack${freq === 1 ? "" : "s"} per day` : "frequent snacking";
    const kcalStr = kcal != null ? ` (~${kcal} kcal/day from snacks alone)` : "";
    insights.push({
      id: "snacks-note",
      observation: `Your logs mention ${freqStr}${kcalStr}.`,
      impact: `${freq != null && freq >= 3
        ? `${freq} snacks per day can add up meaningfully — even without knowing exact calories, frequent snacking tends to contribute more to daily intake than people expect.`
        : `Snacks can contribute a meaningful share of daily intake — understanding when and why you snack is often the first step to adjusting the pattern.`}`,
      action: `${freq != null
        ? `If ${freq} snacks is your current baseline, experimenting with cutting one occasion and replacing it with water or a short walk for a week can help you see whether the habit is hunger-driven or routine-driven.`
        : `Tracking snack occasions for a week — just a count per day — tends to surface patterns that aren't obvious from memory alone.`}`,
    });
  }

  // ── P3b: Meals — FIX 2: describe behavior if kcal unknown ───────────────
  if (hasMealsNote && meals.frequency != null && insights.length < 4) {
    const kcalStr = meals.estimatedKcal != null ? ` (~${meals.estimatedKcal} kcal)` : "";
    insights.push({
      id: "meals-note",
      observation: `Your logs mention ${meals.frequency} meal${meals.frequency === 1 ? "" : "s"} per day${kcalStr}.`,
      impact: `Meal frequency and timing affect when hunger signals peak — ${meals.frequency} meals${meals.estimatedKcal == null ? " without logged calories" : ""} makes it harder to estimate the full daily intake picture, but the pattern itself is useful context.`,
      action: `Note the approximate portion size at each meal for a few days — you don't need exact grams, just a rough sense (small/medium/large). That context often changes how you interpret the weight trend.`,
    });
  }

  // ── P3c: Data sparsity ────────────────────────────────────────────────────
  if (consistencyLevel === "limited" && periodCount < 3 && insights.length < 4) {
    insights.push({
      id: "data-quality",
      observation: `You have ${periodCount} weight measurement${periodCount === 1 ? "" : "s"} logged so far.`,
      impact: `With ${periodCount} data point${periodCount === 1 ? "" : "s"}, any trend shown is a rough direction — a single weigh-in difference of 1–2 lb can look like a strong trend when it may just be normal daily variation.`,
      action: `Log your weight at the same time of day for the next 2 weeks — even 4–5 total readings will make the trend line substantially more reliable.`,
    });
  }

  return insights.slice(0, 4);
}

// ── Combined behavioral insight ───────────────────────────────────────────────

/**
 * Generate a single combined explanation when 2+ behavioral factors are present.
 * Only returned when the combination adds something beyond individual insights.
 *
 * @param {ReturnType<computeWellnessSummary>} summary
 * @returns {string|null}
 */
export function deriveCombinedInsight(summary) {
  const { sleep, snacks, meals, activityRow, hasSnacksNote, hasActivityData, structuredActivity } = summary;

  // FIX 3: include structured activity from intake when no pipeline activityRow
  const hasAnyActivity = hasActivityData || structuredActivity?.daysPerWeek != null;

  const active = [];
  if (sleep.quality === "low" || sleep.quality === "fair") active.push("sleep");
  if (hasSnacksNote || snacks.frequency != null)           active.push("snacks");
  if (hasAnyActivity)                                      active.push("activity");

  if (active.length < 2) return null;

  // Build behavior-specific anchors — use real numbers when available
  const sleepStr = sleep.hoursPerNight != null
    ? `${sleep.hoursPerNight.toFixed(1)} hours of sleep per night`
    : "shorter-than-recommended sleep";
  const snackStr = snacks.frequency != null
    ? `${snacks.frequency} snack${snacks.frequency === 1 ? "" : "s"} per day${snacks.estimatedKcal != null ? ` (~${snacks.estimatedKcal} kcal)` : ""}`
    : "frequent snacking";

  // FIX 3: use structured activity label when no pipeline entity row
  const actLbl = activityRow?.label ?? (
    structuredActivity?.daysPerWeek != null
      ? `${structuredActivity.daysPerWeek.toFixed(1)} day/week activity`
      : "recorded activity"
  );
  const actTrend = activityRow?.direction === "down"
    ? `${actLbl} trending down`
    : `${actLbl} staying steady`;
  const mealStr = meals.frequency != null
    ? `${meals.frequency} meals per day`
    : null;

  const parts = [];

  if (active.includes("sleep") && active.includes("snacks")) {
    // FIX 5: reference both real values in the same sentence
    parts.push(`Getting ${sleepStr} and ${snackStr} may be reinforcing each other — shorter sleep raises hunger signals the next day, which can make ${snacks.frequency != null ? `those ${snacks.frequency} snack occasions` : "snacking"} harder to resist.`);
  }
  if (active.includes("activity") && active.includes("snacks")) {
    const intakeHint = snacks.estimatedKcal != null
      ? ` With ${snackStr}, that intake side is more concrete than the movement side right now.`
      : "";
    parts.push(`${actTrend.charAt(0).toUpperCase() + actTrend.slice(1)} while also logging ${snackStr} means the gap between what you're eating and what you're moving may be growing.${intakeHint}`);
  }
  if (active.includes("sleep") && active.includes("activity") && !active.includes("snacks")) {
    parts.push(`${sleepStr.charAt(0).toUpperCase() + sleepStr.slice(1)} can directly reduce energy available for movement — so ${actTrend} may partly be a downstream effect of the sleep pattern rather than a separate habit.`);
  }

  if (parts.length === 0) return null;

  // Add meal context if available and not already dominant
  const mealSuffix = mealStr && !parts[0].includes("meal")
    ? ` Combined with ${mealStr}, these logged behaviors together shape your intake pattern more than any single one alone.`
    : " These behaviors together shape the pattern more than any single factor alone.";

  return parts.join(" ") + mealSuffix;
}

// ── Energy context note ───────────────────────────────────────────────────────

/**
 * Energy-context paragraph for "What this means".
 *
 * Design-doc rules enforced here:
 *   FIX 1 — no "deficit/surplus" framing; use "intake compared to recorded activity"
 *   FIX 2 — always include limitation sentence when intake/activity discussed
 *   FIX 3 — every interpretive claim carries a hedge word
 *   FIX 4 — weight change stated first; intake/activity as secondary lens only
 *   FIX 4 mismatch — never "resolve" a mismatch with a confident metabolic story
 *
 * @param {ReturnType<computeWellnessSummary>} summary
 * @returns {{ body: string, limitationNote: string } | null}
 */
export function deriveEnergyContextNote(summary) {
  const {
    weightChange, energyComparison,
    hasCalorieData, hasActivityData,
    snacks, meals, activityRow, structuredActivity,
    consistencyLevel, periodCount,
  } = summary;

  if (!weightChange.value && weightChange.direction === "unknown") return null;

  const dir     = weightChange.direction;
  const abs     = weightChange.value != null ? Math.abs(weightChange.value).toFixed(1) : null;
  const days    = weightChange.durationDays;
  const daysStr = days ? ` over ${days} day${days === 1 ? "" : "s"}` : "";

  const limitationNote = "This does not include your body's baseline energy needs, so these comparisons are directional estimates.";

  const weightLead =
    dir === "down" && abs ? `Your weight decreased by ${abs} lb${daysStr}.` :
    dir === "up"   && abs ? `Your weight increased by ${abs} lb${daysStr}.` :
    abs                   ? `Your weight shows a net change of ${abs} lb${daysStr}.` :
                            `Your weight shows minimal change${daysStr}.`;

  // Early-data guard — low confidence, no strong conclusions
  if (consistencyLevel === "limited" || periodCount < 3) {
    return {
      body: `${weightLead} Based on ${periodCount} measurement${periodCount === 1 ? "" : "s"}, this is an early estimate — the direction may shift as you add more data.`,
      limitationNote,
    };
  }

  // Build behavioral anchor from real logged data
  const snackAnchor = snacks.frequency != null
    ? `${snacks.frequency} snack${snacks.frequency === 1 ? "" : "s"} per day${snacks.estimatedKcal != null ? ` (~${snacks.estimatedKcal} kcal)` : ""}`
    : null;
  const mealAnchor  = meals.frequency != null
    ? `${meals.frequency} meal${meals.frequency === 1 ? "" : "s"} per day`
    : null;

  // FIX 3: use structured activity label+trend when no pipeline activityRow
  const hasActMetric = hasActivityData || structuredActivity?.daysPerWeek != null;
  const actLabel =
    activityRow?.label ?? (
      structuredActivity?.daysPerWeek != null
        ? `${structuredActivity.daysPerWeek.toFixed(1)} active days/week`
        : "recorded activity"
    );
  const actTrend =
    activityRow?.direction === "down" ? "trending down"
    : activityRow?.direction === "up"  ? "trending up"
    : activityRow                      ? "holding steady"
    : structuredActivity?.daysPerWeek != null ? "from your intake log"
    : "limited";

  // Build the behavioral clause — reference actual habits, not abstract intake/burn
  let behaviorClause = "";
  if (snackAnchor && hasActMetric) {
    behaviorClause = ` With ${snackAnchor} and ${actLabel} ${actTrend}, your routine${dir === "down" ? " appears to be supporting" : dir === "up" ? " may be adding to" : " shows a balance around"} your current trend — though this is a directional read, not a full calorie account.`;
  } else if (snackAnchor && mealAnchor) {
    behaviorClause = ` With ${mealAnchor} and ${snackAnchor}, your intake pattern may be ${dir === "down" ? "working in the direction of your goal" : dir === "up" ? "contributing to the upward trend" : "roughly offsetting other changes"} — though exact amounts aren't logged.`;
  } else if (snackAnchor) {
    behaviorClause = ` With ${snackAnchor} logged, snacks alone may be adding a noticeable share of daily intake — though without a full meal picture, this is a partial read.`;
  } else if (hasActMetric) {
    behaviorClause = ` Your ${actLabel} is ${actTrend} — ${dir === "down" ? "movement supporting the downward trend" : dir === "up" ? "reduced movement may be a contributing factor" : "activity holding steady alongside the stable weight"}, based on what's logged.`;
  }

  // No intake/activity data at all → weight-only
  if (!hasCalorieData && !hasActivityData && !snackAnchor && !mealAnchor) {
    const interpretation =
      dir === "down"
        ? "Based on your logs, this may reflect habits that are supporting your goal — though day-to-day variation, fluid shifts, and factors not logged here can all influence the reading."
        : dir === "up"
          ? "Based on your logs, this may reflect changes in intake, activity, or other factors — weight change can have many contributing causes that aren't fully captured in a simple log."
          : `Your weight held within a narrow range${daysStr} — this may reflect habits that are closely balanced, or it may reflect measurement timing differences.`;
    return { body: `${weightLead} ${interpretation}`, limitationNote };
  }

  // With full energy comparison + behavioral anchor (FIX 4 mismatch handling)
  if (energyComparison) {
    const { qualitativeRead } = energyComparison;
    let mismatchNote = "";

    if (dir === "down" && qualitativeRead === "higher") {
      mismatchNote = `Despite intake metrics trending ${energyComparison.intakeTrend} and activity ${energyComparison.activityTrend}, weight still fell — fluid shifts, logging gaps, or factors not captured here may explain the difference.`;
    } else if (dir === "up" && qualitativeRead === "lower") {
      mismatchNote = `Weight rose despite intake metrics trending ${energyComparison.intakeTrend} — other factors are likely involved (fluid retention, logged-vs-actual activity gaps, or timing effects).`;
    } else if (qualitativeRead === "higher") {
      mismatchNote = `Based on your logged intake and ${actLabel} (${actTrend}), intake may be tracking higher relative to recorded movement — directional estimate only.`;
    } else if (qualitativeRead === "lower") {
      mismatchNote = `Based on your logged intake and ${actLabel} (${actTrend}), intake may be tracking lower relative to recorded movement — directional estimate only.`;
    } else {
      mismatchNote = `The relationship between your logged intake and ${actLabel} isn't clearly directional for this period — more data will help.`;
    }

    return { body: `${weightLead} ${mismatchNote}${behaviorClause}`, limitationNote };
  }

  // Behavioral context only (no full calorie+activity metric pair)
  return {
    body: `${weightLead}${behaviorClause || " Based on your logs, specific habit drivers aren't fully visible yet — adding meal or activity metrics will give a clearer intake-vs-movement picture."}`,
    limitationNote,
  };
}

// ── Projection note ───────────────────────────────────────────────────────────

/**
 * Soft projection paragraph for the Projection section.
 * FIX 3: never deterministic, never promises specific outcomes.
 *
 * @param {ReturnType<computeWellnessSummary>} summary
 * @returns {string}
 */
export function deriveProjectionNote(summary) {
  const { weightChange, goalWeightLb, weightToGoal, consistencyLevel } = summary;

  if (!weightChange.value || weightChange.direction === "unknown") {
    return "If your current pattern continues and logging stays consistent, trends will become clearer over the coming weeks — small changes often compound in ways that are hard to predict in the short term.";
  }

  if (weightChange.direction === "down") {
    const rateStr = weightChange.perWeek != null
      ? ` (currently about ${Math.abs(weightChange.perWeek).toFixed(1)} lb/week based on this window)`
      : "";
    const goalNote = (goalWeightLb != null && weightToGoal != null && weightToGoal > 0)
      ? ` You're about ${weightToGoal.toFixed(1)} lb from your stated goal — at a similar pace you might approach it over the coming weeks, though real progress is rarely linear.`
      : "";
    const caveat = consistencyLevel === "limited"
      ? " With limited measurements so far, this estimate may shift as you add more data."
      : " Day-to-day variation is normal — a single measurement shift doesn't override the overall direction.";
    return `If similar patterns continue${rateStr}, you might see gradual changes over time.${goalNote}${caveat} These are directional estimates — consistency and factors not captured here still matter.`;
  }

  if (weightChange.direction === "up") {
    return "If current patterns continue, the upward trend may persist — but habits, season, and other factors can shift trends in either direction. These are directional estimates only, based on available data.";
  }

  // flat
  return "Weight stability over this window may continue if habits stay similar — or trends may emerge as more data is logged. Small, consistent changes tend to show up in measurements over 2–4 weeks rather than immediately.";
}

// ── Primary takeaway (single sentence) ────────────────────────────────────────

/**
 * Single-sentence entry point for "What this means" — weight trend + soft alignment language.
 * Must stay one sentence; prioritizes observed weight pattern over detailed mechanics.
 *
 * @param {Record<string, unknown>} primaryRow — merged row for primary wellness metric (e.g. weight)
 * @param {Record<string, unknown> | undefined} wellness — dataset.wellness
 * @returns {string}
 */
export function deriveWellnessPrimaryTakeaway(primaryRow, _wellness) {
  const dir = String(primaryRow?.direction ?? "unknown");
  const net = Number(primaryRow?.netDelta ?? 0);

  if (dir === "down" && Number.isFinite(net) && net < 0) {
    return "You're currently in a pattern that may support gradual weight loss.";
  }
  if (dir === "up" && Number.isFinite(net) && net > 0) {
    return "Your current routine may be leading to gradual weight gain based on your logged trend.";
  }
  if (dir === "flat" || !Number.isFinite(net) || Math.abs(net) < 1e-9) {
    return "Your routine appears relatively balanced, with some variability across days.";
  }
  return "Based on your logs, your weight changed over this period — other factors may also affect results.";
}

export function projectLinearHorizons(velocityPerTime) {
  const v = Number(velocityPerTime);
  if (!Number.isFinite(v)) {
    return { perWeekLb: 0, perMonthLb: 0, perSixMonthsLb: 0, perYearLb: 0 };
  }
  const perDay = v * MS_PER_DAY;
  return {
    perWeekLb:      perDay * 7,
    perMonthLb:     perDay * 30,
    perSixMonthsLb: perDay * 182,
    perYearLb:      perDay * 365,
  };
}

// ── Data quality note (FIX 2 + 3) ────────────────────────────────────────────

/**
 * Translate data completeness gaps into a single plain-language sentence (or two).
 * Used in the "What this means" section to surface limitations without alarming language.
 *
 * Rules:
 *   - Max 1–2 sentences
 *   - Plain English only — no field names, no technical jargon
 *   - Shown only when there is something worth saying
 *   - Never duplicates the existing variability / consistency notes
 *
 * @param {Record<string, unknown>} wellness — dataset.wellness
 * @param {ReturnType<computeWellnessSummary>} summary
 * @returns {string|null}
 */
/**
 * Returns a plain-language note about data completeness.
 * Returns `{ message: string, type: "positive" | "warning" }` or `null`.
 *
 * @param {object|null} wellness
 * @param {object} summary
 * @returns {{ message: string, type: "positive"|"warning" } | null}
 */
function deriveDataQualityNote(wellness, summary) {
  const report  = wellness?.validationReport;
  const quality = summary.dataQuality ?? report?.dataQuality ?? null;
  const days    = summary.daysLogged  ?? report?.daysLogged  ?? null;
  const warnings = report?.warnings ?? [];

  // ── Positive path: high-quality data, no warnings ────────────────────────
  if (quality === "good" && warnings.length === 0) {
    return {
      type:    "positive",
      message: "Your logs are consistent and detailed, which makes these insights more reliable.",
    };
  }

  // ── Warning path: surface specific gaps ──────────────────────────────────
  const gaps = [];
  if (!summary.hasSleepData)
    gaps.push("sleep timing");
  if (summary.meals.frequency != null && summary.meals.estimatedKcal === null)
    gaps.push("meal portion sizes");
  if (summary.snacks.frequency != null && summary.snacks.estimatedKcal === null)
    gaps.push("snack calories");
  if (!summary.structuredActivity && !summary.hasActivityData)
    gaps.push("activity details");

  const gapSentence = gaps.length > 0
    ? `Some details weren't fully captured (${gaps.join(", ")}), so parts of this analysis are estimated.`
    : null;

  // Day-count note — only when truly sparse
  const daySentence =
    (quality === "limited" || (days != null && days < 3))
      ? `This is based on ${days != null ? `${days} day${days === 1 ? "" : "s"}` : "limited"} of data — adding more will improve accuracy.`
      : null;

  if (!gapSentence && !daySentence) return null;
  return {
    type:    "warning",
    message: [gapSentence, daySentence].filter(Boolean).join(" "),
  };
}

/**
 * @param {number} lb
 * @returns {string}
 */
function fmtLb(lb) {
  if (!Number.isFinite(lb)) return "—";
  const sign = lb > 0 ? "+" : lb < 0 ? "−" : "";
  const abs = Math.abs(lb);
  const n = abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
  return `${sign}${n} lb`;
}

// ── Rate + projection model (wellness) ───────────────────────────────────────

/**
 * Weight change rate: lbs per day derived from actual measurements.
 * Uses (endValue − startValue) / durationDays — the direct observed change.
 *
 * Does NOT use velocityPerTime — that field is optional pipeline metadata and
 * is unreliable as a primary input for goal calculations.
 *
 * Negative result = weight loss (endValue < startValue). Returns null when
 * durationDays ≤ 0 or weight values are missing / invalid.
 *
 * @param {Record<string, unknown>} row
 * @param {number} durationDays  Length of the tracked period in days.
 * @returns {number | null}
 */
export function extractRate(row, durationDays) {
  const startWeight = Number(row?.startValue ?? 0);
  const endWeight   = Number(row?.endValue   ?? 0);
  if (!Number.isFinite(durationDays) || durationDays <= 0) return null;
  if (!Number.isFinite(startWeight) || startWeight <= 0 || !Number.isFinite(endWeight) || endWeight <= 0) return null;
  return (endWeight - startWeight) / durationDays; // lbs/day (negative = loss)
}

/**
 * Forward model: projected weight after `days` at the current daily rate.
 *
 * @param {number} rate     Weight change per day (negative = loss).
 * @param {number} current  Current weight in lbs.
 * @param {number} days     Days to project forward.
 * @returns {number | null}
 */
export function projectOutcome(rate, current, days) {
  if (!Number.isFinite(rate) || !Number.isFinite(current) || !Number.isFinite(days)) return null;
  return current + rate * days;
}

/**
 * Inverse model: required daily rate to move from `current` to `target` in `days`.
 *
 * @param {number} target   Goal weight in lbs.
 * @param {number} current  Current weight in lbs.
 * @param {number} days     Days until deadline.
 * @returns {number | null}
 */
export function requiredRate(target, current, days) {
  if (!Number.isFinite(target) || !Number.isFinite(current) || !Number.isFinite(days) || days <= 0) return null;
  return (target - current) / days; // negative = required loss per day
}

/** Wellness strategies for closing a weight-loss gap or getting moving. */
const WELLNESS_LOSS_STRATEGIES = [
  "Increase activity — adding regular movement (walks, workouts, daily steps) is often the most controllable lever and compounds over time.",
  "Adjust your intake — even moderate changes to portions or meal timing can shift the weekly trend meaningfully over several weeks.",
  "Improve consistency — sleep quality and regular routines have an outsized effect on body composition, often more than any single habit change.",
];

/** Wellness strategies for maintaining or staying on track. */
const WELLNESS_MAINTAIN_STRATEGIES = [
  "Stay consistent — the biggest risk when progress is going well is making sudden changes; keep doing what's working.",
  "Keep logging — regular data makes it easier to see whether the trend holds or needs a small adjustment.",
];

/**
 * Goal-based analysis for wellness.
 * Compares the observed weight-change rate (endValue − startValue) / durationDays
 * against what is required to reach the goal weight by the target date.
 *
 * Output structure:
 *   1. Restate goal
 *   2. Projected outcome at current rate
 *   3. Required rate to hit goal if not on track
 *   4. Feasibility note if gap is material
 *   5. 2–3 strategies (paths forward)
 *
 * Returns null when no goal or insufficient data. Never fabricates values.
 *
 * @param {Record<string, unknown>} primaryRow   Pipeline row for the weight metric.
 * @param {object} wellness                       dataset.wellness (goalWeightLb source).
 * @param {{ targetValue?: string | number, targetDate?: string } | null | undefined} goal
 * @param {number} durationDays                   Length of the tracked period in days.
 * @returns {{ summary: string, strategies: string[], rateDerivation?: string } | null}
 */
function wellnessWeightRateDerivation(primaryRow, durationDays, lbsPerDay) {
  const startWeight = Number(primaryRow?.startValue ?? 0);
  const endWeight   = Number(primaryRow?.endValue   ?? 0);
  return formatWellnessWeightRateDerivationLine(startWeight, endWeight, durationDays, lbsPerDay);
}

function generateGoalAnalysis(primaryRow, wellness, goal, durationDays) {
  // Resolve goal weight: prefer formData.goal.targetValue, fall back to wellness.goalWeightLb
  const goalFromStep     = goal?.targetValue ? Number(goal.targetValue) : null;
  const goalFromWellness = Number(wellness?.goalWeightLb ?? 0);
  const targetWeight     = goalFromStep ?? (goalFromWellness > 0 ? goalFromWellness : null);

  if (!targetWeight || !Number.isFinite(targetWeight) || targetWeight <= 0) return null;

  const currentWeight = Number(primaryRow?.endValue ?? 0);
  if (!Number.isFinite(currentWeight) || currentWeight <= 0) {
    return { summary: "Not enough data to calculate a projection.", strategies: [] };
  }

  const lbsPerDay = extractRate(primaryRow, durationDays);
  if (lbsPerDay === null) {
    return { summary: "Not enough data to calculate a projection.", strategies: [] };
  }

  const lbsPerWeek = lbsPerDay * 7;
  const isLossGoal = targetWeight < currentWeight;

  const targetDate     = String(goal?.targetDate ?? "").trim();
  const hasDeadline    = !!targetDate;
  const daysToDeadline = hasDeadline ? daysBetween(new Date(), new Date(targetDate)) : null;

  // ── Deadline path ────────────────────────────────────────────────────────
  if (hasDeadline && daysToDeadline !== null && daysToDeadline > 0) {
    const projectedWeight = projectOutcome(lbsPerDay, currentWeight, daysToDeadline) ?? currentWeight;
    const needed          = requiredRate(targetWeight, currentWeight, daysToDeadline);
    const reqPerWeek      = needed !== null ? formatLbsPerWeekNumberForDisplay(Math.abs(needed * 7)) : null;
    const curPerWeek      = formatLbsPerWeekNumberForDisplay(Math.abs(lbsPerWeek));

    const daysRemaining = `${daysToDeadline} day${daysToDeadline !== 1 ? "s" : ""}`;

    if (isLossGoal) {
      if (lbsPerDay >= 0) {
        // Trending flat or gaining — no current loss
        if (reqPerWeek === null) return null;
        const feasibility = needed !== null
          ? feasibilityNote(0.001, Math.abs(needed)) // current ≈ 0, any required rate is a large ask
          : null;
        let summary = `Your goal is to reach ${targetWeight} lbs by ${formatDate(targetDate)} — you have ${daysRemaining} remaining. Starting from ${formatWeightLbForDisplay(currentWeight)} lbs, your current trend is flat or moving in the other direction. To lose about ${formatWeightLbForDisplay(currentWeight - targetWeight)} lbs in time, you'd need to average about ${reqPerWeek} lbs of loss per week.`;
        if (feasibility) summary += ` ${feasibility}`;
        return {
          summary,
          rateDerivation: wellnessWeightRateDerivation(primaryRow, durationDays, lbsPerDay),
          strategies: WELLNESS_LOSS_STRATEGIES,
        };
      }

      if (projectedWeight <= targetWeight) {
        return {
          summary: `Your goal is to reach ${targetWeight} lbs by ${formatDate(targetDate)} — you have ${daysRemaining} remaining. Starting from ${formatWeightLbForDisplay(currentWeight)} lbs, at your current rate of about ${curPerWeek} lbs per week, you're trending toward around ${formatWeightLbForDisplay(projectedWeight)} lbs — looking good, you're on track.`,
          rateDerivation: wellnessWeightRateDerivation(primaryRow, durationDays, lbsPerDay),
          strategies: WELLNESS_MAINTAIN_STRATEGIES,
        };
      }

      if (reqPerWeek === null) return null;
      // Current loss rate exists but insufficient — compute feasibility
      const curLossPerDay = Math.abs(lbsPerDay);
      const reqLossPerDay = needed !== null ? Math.abs(needed) : 0;
      const gapLb        = formatWeightLbForDisplay(projectedWeight - targetWeight);
      const note = reqLossPerDay > 0 ? feasibilityNote(curLossPerDay, reqLossPerDay) : null;
      let summary = `Your goal is to reach ${targetWeight} lbs by ${formatDate(targetDate)} — you have ${daysRemaining} remaining. Starting from ${formatWeightLbForDisplay(currentWeight)} lbs, at your current rate of about ${curPerWeek} lbs per week, you're trending toward around ${formatWeightLbForDisplay(projectedWeight)} lbs — about ${gapLb} lbs above your target. To close that gap, you'd need to increase your rate of loss to about ${reqPerWeek} lbs per week.`;
      if (note) summary += ` ${note}`;
      return {
        summary,
        rateDerivation: wellnessWeightRateDerivation(primaryRow, durationDays, lbsPerDay),
        strategies: WELLNESS_LOSS_STRATEGIES,
      };
    }

    // Maintenance or gain goal
    const outcomeLabel = projectedWeight >= targetWeight ? "on target" : "slightly short of where you want to be";
    return {
      summary: `Your goal is to reach ${targetWeight} lbs by ${formatDate(targetDate)} — you have ${daysRemaining} remaining. Starting from ${formatWeightLbForDisplay(currentWeight)} lbs, your current trend puts you at around ${formatWeightLbForDisplay(projectedWeight)} lbs by then — ${outcomeLabel}.`,
      rateDerivation: wellnessWeightRateDerivation(primaryRow, durationDays, lbsPerDay),
      strategies: WELLNESS_MAINTAIN_STRATEGIES,
    };
  }

  // ── No deadline: project when the goal will be reached ──────────────────
  if (isLossGoal && lbsPerDay < 0) {
    const daysToGoal  = Math.round((currentWeight - targetWeight) / Math.abs(lbsPerDay));
    const weeksToGoal = (daysToGoal / 7).toFixed(1);
    return {
      summary: `At your current rate of about ${formatLbsPerWeekNumberForDisplay(Math.abs(lbsPerWeek))} lbs per week, you're trending toward ${targetWeight} lbs in roughly ${weeksToGoal} week${weeksToGoal !== "1.0" ? "s" : ""}. This is a directional estimate — small shifts in habit or measurement timing can move the timeline.`,
      rateDerivation: wellnessWeightRateDerivation(primaryRow, durationDays, lbsPerDay),
      strategies: WELLNESS_MAINTAIN_STRATEGIES,
    };
  }

  return null;
}

/**
 * Enrich merged pipeline rows for weightloss datasets (primary metric = first entity).
 *
 * @param {Record<string, unknown>[]} merged
 * @param {{ intent?: string, wellness?: Record<string, unknown>, entities?: Array<{ entityId: string }> }} dataset
 * @returns {Record<string, unknown>[]}
 */
export function enrichMergedForWellnessIntent(merged, dataset) {
  if (dataset?.intent !== "weightloss" || !Array.isArray(merged) || merged.length === 0) {
    return merged;
  }

  const wellness  = dataset.wellness ?? {};
  const primaryId =
    (typeof wellness.primaryEntityId === "string" && wellness.primaryEntityId
      ? wellness.primaryEntityId
      : dataset.entities?.[0]?.entityId) ?? "";

  // Pre-compute summary + intelligence BEFORE the map so allRows is available
  const rawPrimary = merged.find(r => String(r?.entityId ?? "") === primaryId) ?? merged[0];
  const summary            = computeWellnessSummary(wellness, rawPrimary, merged);
  const actionableInsights = generateActionableInsights(summary);
  const computedCombined   = deriveCombinedInsight(summary);
  const energyNote         = deriveEnergyContextNote(summary);
  const projectionNote     = deriveProjectionNote(summary);

  const goalLb  = Number(wellness.goalWeightLb);
  const hasGoal = Number.isFinite(goalLb) && goalLb > 0;

  // Compute historical period length for rate calculation (endValue − startValue) / durationDays
  const durationDays =
    dataset.periodStart && dataset.periodEnd
      ? Math.max(0, daysBetween(String(dataset.periodStart), String(dataset.periodEnd)))
      : 0;

  // Pre-compute goal analysis for the primary row (uses both dataset.goal and wellness.goalWeightLb)
  const datasetGoal  = dataset.goal ?? null;
  const goalAnalysis = generateGoalAnalysis(rawPrimary, wellness, datasetGoal, durationDays);

  return merged.map((row) => {
    const r  = { ...row };
    const id = String(r.entityId ?? "");
    r.analyzerIntent = "weightloss";

    if (id === primaryId) {
      const vpt     = Number(r.velocityPerTime ?? 0);
      const horizons = projectLinearHorizons(vpt);
      const endVal  = Number(r.endValue ?? 0);

      r.wellnessPrimary  = true;
      r.wellnessHorizons = horizons;

      const wk = fmtLb(horizons.perWeekLb);
      const mo = fmtLb(horizons.perMonthLb);
      const sm = fmtLb(horizons.perSixMonthsLb);
      const yr = fmtLb(horizons.perYearLb);
      r.wellnessHorizonsFormatted = {
        week:      wk === "—" ? "—" : `${wk} lb`,
        month:     mo === "—" ? "—" : `${mo} lb`,
        sixMonths: sm === "—" ? "—" : `${sm} lb`,
        year:      yr === "—" ? "—" : `${yr} lb`,
      };

      // ── Fallback interpretation detail (used when energyNote is absent) ───
      let goalHint = "";
      if (hasGoal && Number.isFinite(endVal)) {
        const gap = endVal - goalLb;
        if (gap > 0.5)       goalHint = ` About ${gap.toFixed(1)} lb above your stated goal — small, steady changes add up.`;
        else if (gap < -0.5) goalHint = ` You're below your goal weight — focus on sustainable maintenance or guided gain.`;
        else                 goalHint = ` You're close to your goal weight — prioritize consistency and recovery.`;
      }
      const dir = String(r.direction ?? "unknown");
      const trendHint =
        dir === "down" ? "Trend is downward — if this reflects intentional loss, keep sleep and regular meals steady."
        : dir === "up" ? "Trend is upward — review intake patterns and activity if this isn't your goal."
        :                "Trend is flat — consider adjusting one habit at a time for a clearer signal.";
      r.wellnessInterpretationDetail = `${trendHint}${goalHint}`;

      // ── New intelligence fields ───────────────────────────────────────────
      r.wellnessPrimaryTakeaway    = deriveWellnessPrimaryTakeaway(r, wellness);
      r.wellnessSummary            = summary;
      r.wellnessActionableInsights = actionableInsights;
      r.wellnessEnergyNote         = energyNote;
      r.wellnessProjectionNote     = projectionNote;
      // FIX 2: plain-language data quality note (null when data is complete)
      r.wellnessDataQualityNote    = deriveDataQualityNote(wellness, summary);

      // combinedInsight: user-supplied string wins; otherwise computed
      r.wellnessCombinedInsight =
        typeof wellness.combinedInsight === "string" && wellness.combinedInsight
          ? wellness.combinedInsight
          : (computedCombined ?? null);

      const pc = Number(r.periodCount ?? 0);
      r.wellnessConsistencyNote =
        pc >= 3 ? "Your routine shows moderate consistency across logged measurements."
        : pc >= 2 ? "Your logging includes a few measurement points — more consistency over time may clarify trends."
        :           "With limited measurement points, patterns may shift as you add more data.";

      r.wellnessVariabilityNote =
        pc < 3 ? "These estimates are based on available data and may not capture normal day-to-day variation." : null;

      r.wellnessSuggestion = r.wellnessInterpretationDetail;
      const baseReason = String(r.reason ?? "").trim();
      r.reason = [baseReason, r.wellnessSuggestion].filter(Boolean).join(" ").trim();

      // Goal analysis — attached as intentAnalysis.goalAnalysis so the screen can render it
      // uniformly alongside the other intent goal sections
      if (goalAnalysis !== null) {
        r.intentAnalysis = { goalAnalysis };
      }
    }

    return r;
  });
}

/**
 * wellnessLogs.js
 *
 * Structured daily log data model and transformation layer for the
 * wellness / weightloss intake system.
 *
 * Converts user-entered daily logs (Mode A baseline or Mode B daily
 * tracking) into the `wellness` object shape that computeWellnessSummary
 * already understands — without modifying that function.
 *
 * Priority rule: structured values always override free-text note parsers.
 * Notes generated here are formatted so the existing parsers still work if
 * structured fields are absent (backward compatibility).
 *
 * @typedef {{
 *   date:     string,
 *   weight:   { value: string|number, unit: string },
 *   sleep:    { bedtime: string, wakeTime: string },
 *   meals: {
 *     breakfast: { description: string, portion: string },
 *     lunch:     { description: string, portion: string },
 *     dinner:    { description: string, portion: string },
 *   },
 *   snacks:   Array<{ id: number, description: string, calories: string|number }>,
 *   activity: { durationMinutes: string|number, intensity: string, caloriesBurned: string|number },
 * }} DailyLog
 *
 * @typedef {{
 *   weightValue:               string|number,
 *   weightUnit:                string,
 *   weightTime:                string,
 *   sleepBed:                  string,
 *   sleepWake:                 string,
 *   meals: {
 *     breakfast: { description: string, portion: string },
 *     lunch:     { description: string, portion: string },
 *     dinner:    { description: string, portion: string },
 *   },
 *   snacks:                    Array<{ id: number, description: string, calories: string|number }>,
 *   snacksPerDay:              string|number,
 *   activityDaysPerWeek:       string|number,
 *   activityMinutesPerSession: string|number,
 *   activityIntensity:         string,
 *   activityCaloriesBurned:    string|number,
 * }} BaselineIntake
 */

// ── Portion → kcal rough estimate ────────────────────────────────────────────
// These are conservative mid-range estimates; the UI clearly labels them as
// rough approximations. They influence the note that feeds into the parsers.

const PORTION_KCAL = {
  none:   0,
  light:  300,
  medium: 500,
  heavy:  750,
};

/**
 * @param {"none"|"light"|"medium"|"heavy"|null|undefined} portion
 * @returns {number|null}
 */
function portionToKcal(portion) {
  return portion != null && PORTION_KCAL[portion] != null ? PORTION_KCAL[portion] : null;
}

// ── Sleep duration ────────────────────────────────────────────────────────────

/**
 * Compute hours from two HH:MM strings (native <input type="time"> format).
 * Handles overnight crossing — e.g. bed 23:00, wake 07:00 → 8 h.
 * @param {string|null|undefined} bedtime
 * @param {string|null|undefined} wakeTime
 * @returns {number|null}
 */
function computeSleepHours(bedtime, wakeTime) {
  if (!bedtime || !wakeTime) return null;
  const parseHHMM = (t) => {
    const m = String(t).match(/^(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  };
  const b = parseHHMM(bedtime);
  const w = parseHHMM(wakeTime);
  if (b === null || w === null) return null;
  let diff = w - b;
  if (diff <= 0) diff += 24 * 60; // crosses midnight
  return Math.round((diff / 60) * 10) / 10;
}

// ── Factory functions ─────────────────────────────────────────────────────────

/**
 * Create an empty daily log entry for a given ISO date.
 * @param {string} date — YYYY-MM-DD
 * @returns {DailyLog}
 */
export function createEmptyDailyLog(date) {
  return {
    date,
    weight:  { value: "", unit: "lb" },
    sleep:   { bedtime: "", wakeTime: "" },
    meals: {
      breakfast: { description: "", portion: "" },
      lunch:     { description: "", portion: "" },
      dinner:    { description: "", portion: "" },
    },
    snacks:   [],
    activity: { durationMinutes: "", intensity: "moderate", caloriesBurned: "" },
  };
}

/**
 * Create a default (empty) baseline intake object for Mode A.
 * @returns {BaselineIntake}
 */
export function createDefaultBaselineIntake() {
  return {
    weightValue:               "",
    weightUnit:                "lb",
    weightTime:                "morning",
    sleepBed:                  "",
    sleepWake:                 "",
    meals: {
      breakfast: { description: "", portion: "medium" },
      lunch:     { description: "", portion: "medium" },
      dinner:    { description: "", portion: "medium" },
    },
    snacks:                    [{ id: 1, description: "", calories: "" }],
    snacksPerDay:              "",
    activityDaysPerWeek:       "",
    activityMinutesPerSession: "",
    activityIntensity:         "moderate",
    activityCaloriesBurned:    "",
  };
}

// ── Internal aggregation helpers ──────────────────────────────────────────────

/** @param {number[]} arr @returns {number|null} */
function avg(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Return most-common value in an array, or null if empty. */
function mostCommon(arr) {
  if (arr.length === 0) return null;
  const freq = {};
  for (const v of arr) freq[v] = (freq[v] ?? 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
}

// ── Transformation layer ──────────────────────────────────────────────────────

/**
 * Transform structured intake data into the `wellness` object shape that
 * computeWellnessSummary understands.
 *
 * The returned object is spread onto the dataset's `wellness` field in
 * BusinessAnalyzerWizard.assembleDataset(), overriding legacy free-text values.
 *
 * Notes generated here are formatted so the existing note-parsers
 * (parseCountFromNote / parseKcalFromNote) extract the correct numbers when
 * called by computeWellnessSummary. Structured fields are also stored directly
 * in `wellness.structured` for the output layer to read if needed.
 *
 * @param {DailyLog[]}    dailyLogs
 * @param {BaselineIntake} baseline
 * @param {"baseline"|"guided"} mode
 * @returns {object} Partial wellness extension
 */
export function transformLogsToWellnessInputs(dailyLogs = [], baseline = {}, mode = "baseline") {
  const logs       = Array.isArray(dailyLogs) ? dailyLogs.filter(Boolean) : [];
  const bl         = baseline ?? {};
  const useBaseline = mode === "baseline" || logs.length === 0;

  const MEAL_TYPES = /** @type {const} */ (["breakfast", "lunch", "dinner"]);

  // ── Sleep ─────────────────────────────────────────────────────────────────

  let avgSleepHours = null;
  let sleepBed      = bl.sleepBed  || null;
  let sleepWake     = bl.sleepWake || null;

  if (!useBaseline) {
    const durations = logs
      .map(l => computeSleepHours(l.sleep?.bedtime, l.sleep?.wakeTime))
      .filter(h => h !== null);
    const a = avg(durations);
    if (a !== null) avgSleepHours = Math.round(a * 10) / 10;

    const firstWithBed  = logs.find(l => l.sleep?.bedtime);
    const firstWithWake = logs.find(l => l.sleep?.wakeTime);
    if (firstWithBed?.sleep?.bedtime)   sleepBed  = firstWithBed.sleep.bedtime;
    if (firstWithWake?.sleep?.wakeTime) sleepWake = firstWithWake.sleep.wakeTime;
  }

  // Compute hours from baseline bedtime/wake if not already derived from logs
  if (avgSleepHours === null && sleepBed && sleepWake) {
    avgSleepHours = computeSleepHours(sleepBed, sleepWake);
  }

  // ── Snacks ────────────────────────────────────────────────────────────────

  let avgSnacksPerDay    = null;
  let avgSnackKcalPerDay = null;
  let snackItems         = [];
  let snackDaysObserved  = 0;

  if (useBaseline) {
    const perDay = Number(bl.snacksPerDay);
    if (Number.isFinite(perDay) && perDay >= 0) avgSnacksPerDay = perDay;

    const blSnacks  = Array.isArray(bl.snacks) ? bl.snacks : [];
    const withKcal  = blSnacks.filter(s => Number.isFinite(Number(s.calories)) && Number(s.calories) > 0);
    if (withKcal.length > 0) {
      avgSnackKcalPerDay = Math.round(withKcal.reduce((sum, s) => sum + Number(s.calories), 0));
    }
    snackItems = blSnacks.map(s => s.description).filter(Boolean).slice(0, 5);
    snackDaysObserved = avgSnacksPerDay != null || snackItems.length > 0 ? 1 : 0;
  } else {
    const daysWithSnacks = logs.filter(l => Array.isArray(l.snacks));
    snackDaysObserved    = daysWithSnacks.length;

    if (daysWithSnacks.length > 0) {
      const freqs = daysWithSnacks.map(l => l.snacks.length);
      const a     = avg(freqs);
      if (a !== null) avgSnacksPerDay = Math.round(a * 10) / 10;

      const allSnacks   = logs.flatMap(l => (Array.isArray(l.snacks) ? l.snacks : []));
      const snacksKcal  = allSnacks.filter(s => Number.isFinite(Number(s.calories)) && Number(s.calories) > 0);
      if (snacksKcal.length > 0) {
        const totalKcal    = snacksKcal.reduce((a_, s) => a_ + Number(s.calories), 0);
        avgSnackKcalPerDay = Math.round(totalKcal / daysWithSnacks.length);
      }
      snackItems = [...new Set(allSnacks.map(s => s.description).filter(Boolean))].slice(0, 5);
    }
  }

  // ── Meals ─────────────────────────────────────────────────────────────────

  let avgMealKcalPerDay = null;
  let portions          = { breakfast: null, lunch: null, dinner: null };
  let mealsEatenCount   = 3;
  let mealDaysObserved  = 0;

  if (useBaseline) {
    const blMeals = bl.meals ?? {};
    let totalKcal = 0;
    let counted   = 0;
    for (const m of MEAL_TYPES) {
      const p    = blMeals[m]?.portion;
      const kcal = portionToKcal(p);
      portions[m] = p ?? null;
      if (kcal != null) { totalKcal += kcal; counted++; }
    }
    if (counted > 0) {
      avgMealKcalPerDay = totalKcal;
      mealDaysObserved  = 1;
    }
    mealsEatenCount = MEAL_TYPES.filter(m => {
      const p = blMeals[m]?.portion;
      return p && p !== "none";
    }).length || 3;
  } else {
    const daysWithMeals = logs.filter(l => l.meals);
    mealDaysObserved    = daysWithMeals.length;

    if (daysWithMeals.length > 0) {
      const dailyKcals = daysWithMeals.map(l => {
        let t = 0;
        for (const m of MEAL_TYPES) {
          const kcal = portionToKcal(l.meals?.[m]?.portion);
          if (kcal != null) t += kcal;
        }
        return t;
      }).filter(k => k > 0);

      if (dailyKcals.length > 0) {
        avgMealKcalPerDay = Math.round(avg(dailyKcals));
      }

      for (const m of MEAL_TYPES) {
        const mealPortions = daysWithMeals
          .map(l => l.meals?.[m]?.portion)
          .filter(p => p && p !== "none");
        portions[m] = mostCommon(mealPortions);
      }

      mealsEatenCount = MEAL_TYPES.filter(m =>
        daysWithMeals.some(l => l.meals?.[m]?.portion && l.meals[m].portion !== "none")
      ).length || 3;
    }
  }

  // ── Activity ──────────────────────────────────────────────────────────────

  let activityDaysPerWeek       = null;
  let activityMinutesPerSession = null;
  let activityIntensity         = null;
  let activityDaysObserved      = 0;

  if (useBaseline) {
    const d = Number(bl.activityDaysPerWeek);
    const m = Number(bl.activityMinutesPerSession);
    if (Number.isFinite(d) && d >= 0) activityDaysPerWeek       = d;
    if (Number.isFinite(m) && m > 0)  activityMinutesPerSession = m;
    activityIntensity    = bl.activityIntensity ?? null;
    activityDaysObserved = activityDaysPerWeek != null ? 1 : 0;
  } else {
    const activeLogs     = logs.filter(
      l => Number.isFinite(Number(l.activity?.durationMinutes)) && Number(l.activity.durationMinutes) > 0
    );
    activityDaysObserved = activeLogs.length;

    if (activeLogs.length > 0 && logs.length > 0) {
      activityDaysPerWeek       = Math.round((activeLogs.length / logs.length) * 7 * 10) / 10;
      const mins                = activeLogs.map(l => Number(l.activity.durationMinutes));
      activityMinutesPerSession = Math.round(avg(mins));
      activityIntensity         = mostCommon(activeLogs.map(l => l.activity.intensity).filter(Boolean));
    }
  }

  // ── Data quality ──────────────────────────────────────────────────────────

  const daysLogged  = useBaseline ? 1 : logs.length;
  const dataQuality = daysLogged >= 5 ? "good" : daysLogged >= 3 ? "moderate" : "limited";

  // ── Generate well-formatted notes for the existing parsers ────────────────
  // parseCountFromNote and parseKcalFromNote in wellnessAnalysis.js will
  // extract the exact values we put in here. No change to those functions.

  const snackCount = avgSnacksPerDay != null ? Math.round(avgSnacksPerDay) : null;
  const snacksNote = snackCount != null
    ? [
        `${snackCount} snack${snackCount === 1 ? "" : "s"} per day`,
        avgSnackKcalPerDay != null ? `(~${avgSnackKcalPerDay} kcal)` : null,
        snackItems.length > 0 ? `— ${snackItems.slice(0, 3).join(", ")}` : null,
      ].filter(Boolean).join(" ")
    : null;

  const portionSummary = Object.entries(portions)
    .filter(([, p]) => p && p !== "none")
    .map(([m, p]) => `${m}: ${p}`)
    .join(", ");

  const mealsNote = [
    `${mealsEatenCount} meal${mealsEatenCount === 1 ? "" : "s"} per day`,
    avgMealKcalPerDay != null ? `(~${avgMealKcalPerDay} kcal from portions)` : null,
    portionSummary || null,
  ].filter(Boolean).join(" ");

  // ── Structured block (stored for future use / output layer reads) ─────────

  const structured = {
    snacks: {
      averagePerDay:    avgSnacksPerDay,
      averageDailyKcal: avgSnackKcalPerDay,
      items:            snackItems,
      daysObserved:     snackDaysObserved,
    },
    meals: {
      count:            mealsEatenCount,
      averageDailyKcal: avgMealKcalPerDay,
      portions,
      daysObserved:     mealDaysObserved,
    },
    activity: {
      daysPerWeek:          activityDaysPerWeek,
      avgMinutesPerSession: activityMinutesPerSession,
      intensity:            activityIntensity,
      daysObserved:         activityDaysObserved,
    },
    sleep: {
      averageHours: avgSleepHours,
      bedtime:      sleepBed,
      wakeTime:     sleepWake,
      daysObserved: useBaseline
        ? (avgSleepHours != null ? 1 : 0)
        : logs.filter(l => l.sleep?.bedtime && l.sleep?.wakeTime).length,
    },
    daysLogged,
    dataQuality,
    intakeMode: mode,
  };

  // ── FIX 5: Validation report — no field dropped silently ────────────────
  // Every intake field is explicitly accounted for here. Warnings surface
  // fields that were entered but could not be resolved to a value.
  const validationReport = {
    captured: {
      sleep:    avgSleepHours !== null,
      snacks:   avgSnacksPerDay !== null,
      snackKcal: avgSnackKcalPerDay !== null,
      meals:    avgMealKcalPerDay !== null,
      activity: activityDaysPerWeek !== null,
      weight:   useBaseline
        ? (bl.weightValue !== "" && bl.weightValue != null)
        : logs.some(l => l.weight?.value !== "" && l.weight?.value != null),
    },
    warnings: [
      ...(avgSleepHours === null
        ? ["Sleep duration not computable — bedtime or wake time may be missing"] : []),
      ...(avgSnacksPerDay === null && (useBaseline ? bl.snacks?.length > 0 : logs.some(l => l.snacks?.length))
        ? ["Snack entries present but count could not be derived"] : []),
      ...(avgMealKcalPerDay === null
        ? ["Meal portions not set — calorie estimates for meals unavailable"] : []),
      ...(activityDaysPerWeek === null
        ? ["Activity not logged — activity insights will be limited"] : []),
      ...(!useBaseline && logs.length < 3
        ? [`Only ${logs.length} day${logs.length === 1 ? "" : "s"} logged — early estimate, add more days for deeper insights`] : []),
    ],
    daysLogged,
    dataQuality,
    intakeMode: mode,
  };

  // ── FIX 6: Dev debug — log full structured → summary mapping ─────────────
  console.debug(
    "[wellnessLogs:transform] mode=%s daysLogged=%d dataQuality=%s",
    mode, daysLogged, dataQuality,
    "\n  sleep:", avgSleepHours, "h | bed:", sleepBed, "→ wake:", sleepWake,
    "\n  snacks:", avgSnacksPerDay, "/day ~", avgSnackKcalPerDay, "kcal | items:", snackItems,
    "\n  meals:", mealsEatenCount, "/day ~", avgMealKcalPerDay, "kcal | portions:", portions,
    "\n  activity:", activityDaysPerWeek, "days/wk", activityMinutesPerSession, "min/session", activityIntensity,
    "\n  warnings:", validationReport.warnings,
  );

  // ── Return the wellness extension ─────────────────────────────────────────
  // Spread onto dataset.wellness in assembleDataset(). Structured values
  // override any previously saved free-text notes (FIX 1 priority guarantee).

  return {
    ...(avgSleepHours != null ? { sleepHours: avgSleepHours } : {}),
    ...(sleepBed  ? { sleepBed }  : {}),
    ...(sleepWake ? { sleepWake } : {}),
    ...(snacksNote ? { snacksNote } : {}),
    mealsNote,
    structured,
    validationReport, // FIX 5 — persisted for audit / UI feedback
  };
}

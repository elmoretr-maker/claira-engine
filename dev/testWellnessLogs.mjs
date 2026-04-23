/**
 * Smoke test for wellnessLogs.js — data model and transformation layer.
 */
import {
  transformLogsToWellnessInputs,
  createEmptyDailyLog,
  createDefaultBaselineIntake,
} from "../ui/utils/wellnessLogs.js";

let passed = 0;
let failed = 0;

function ok(label, cond) {
  if (cond) {
    console.log("  ✅", label);
    passed++;
  } else {
    console.log("  ❌", label);
    failed++;
  }
}

// ── Test A: Mode A baseline ───────────────────────────────────────────────────

console.log("\n── Mode A: Quick Baseline ──────────────────────────────────────\n");

const bl = createDefaultBaselineIntake();
bl.sleepBed  = "22:30";
bl.sleepWake = "06:30";
bl.snacksPerDay = "4";
bl.snacks = [
  { id: 1, description: "nuts",  calories: "150" },
  { id: 2, description: "fruit", calories: "100" },
  { id: 3, description: "chips", calories: "100" },
  { id: 4, description: "bar",   calories: "50"  },
];
bl.meals.breakfast.portion = "medium";
bl.meals.lunch.portion     = "medium";
bl.meals.dinner.portion    = "heavy";
bl.activityDaysPerWeek       = "4";
bl.activityMinutesPerSession = "30";
bl.activityIntensity         = "moderate";

const r = transformLogsToWellnessInputs([], bl, "baseline");

ok("sleepHours computed from bed/wake (22:30→06:30 = 8h)", r.sleepHours === 8);
ok("sleepBed preserved", r.sleepBed === "22:30");
ok("sleepWake preserved", r.sleepWake === "06:30");
ok("snacksNote contains '4 snacks per day'", r.snacksNote?.includes("4 snacks per day"));
ok("snacksNote contains kcal total (400)", r.snacksNote?.includes("400 kcal"));
ok("snacksNote lists first snack item", r.snacksNote?.includes("nuts"));
ok("mealsNote contains 3 meals", r.mealsNote?.includes("3 meals per day"));
ok("mealsNote contains kcal from portions (medium+medium+heavy = 500+500+750=1750)",
   r.mealsNote?.includes("1750 kcal"));
ok("structured.snacks.averagePerDay = 4", r.structured.snacks.averagePerDay === 4);
ok("structured.snacks.averageDailyKcal = 400", r.structured.snacks.averageDailyKcal === 400);
ok("structured.snacks.items has nuts", r.structured.snacks.items.includes("nuts"));
ok("structured.sleep.averageHours = 8", r.structured.sleep.averageHours === 8);
ok("structured.activity.daysPerWeek = 4", r.structured.activity.daysPerWeek === 4);
ok("structured.activity.avgMinutesPerSession = 30", r.structured.activity.avgMinutesPerSession === 30);
ok("structured.activity.intensity = moderate", r.structured.activity.intensity === "moderate");
ok("dataQuality = limited (1 day)", r.structured.dataQuality === "limited");

// ── Test B: Mode B guided (multi-day) ────────────────────────────────────────

console.log("\n── Mode B: Guided Daily Log ────────────────────────────────────\n");

const logs = [
  {
    ...createEmptyDailyLog("2026-04-20"),
    sleep: { bedtime: "23:00", wakeTime: "07:00" },
    snacks: [
      { id: 1, description: "apple",  calories: "80"  },
      { id: 2, description: "cheese", calories: "120" },
    ],
    meals: {
      breakfast: { description: "oats",   portion: "medium" },
      lunch:     { description: "salad",  portion: "light"  },
      dinner:    { description: "pasta",  portion: "heavy"  },
    },
    activity: { durationMinutes: "45", intensity: "moderate", caloriesBurned: "" },
  },
  {
    ...createEmptyDailyLog("2026-04-21"),
    sleep: { bedtime: "23:30", wakeTime: "07:30" },
    snacks: [
      { id: 3, description: "nuts",   calories: "150" },
      { id: 4, description: "yogurt", calories: "100" },
      { id: 5, description: "bar",    calories: "200" },
    ],
    meals: {
      breakfast: { description: "eggs",    portion: "medium" },
      lunch:     { description: "wrap",    portion: "medium" },
      dinner:    { description: "chicken", portion: "medium" },
    },
    activity: { durationMinutes: "30", intensity: "light", caloriesBurned: "" },
  },
  {
    ...createEmptyDailyLog("2026-04-22"),
    sleep: { bedtime: "22:00", wakeTime: "06:00" },
    snacks: [
      { id: 6, description: "bar", calories: "200" },
    ],
    meals: {
      breakfast: { description: "toast",  portion: "light"  },
      lunch:     { description: "soup",   portion: "light"  },
      dinner:    { description: "steak",  portion: "heavy"  },
    },
    activity: { durationMinutes: "0", intensity: "light", caloriesBurned: "" },
  },
];

const r2 = transformLogsToWellnessInputs(logs, {}, "guided");

ok("sleepHours averaged across 3 days", typeof r2.sleepHours === "number" && r2.sleepHours > 0);
ok("avg sleep: day1=8h, day2=8h, day3=8h → 8h", r2.sleepHours === 8);
ok("snacksNote generated for guided mode", typeof r2.snacksNote === "string");
ok("snacksNote has correct avg snacks (2+3+1=6/3=2)", r2.snacksNote?.includes("2 snacks per day"));
ok("mealsNote generated", typeof r2.mealsNote === "string");
ok("structured.dataQuality = moderate (3 days)", r2.structured.dataQuality === "moderate");
ok("structured.daysLogged = 3", r2.structured.daysLogged === 3);
ok("structured.activity.daysPerWeek: 2 active days out of 3 × 7 = 4.7", r2.structured.activity.daysPerWeek > 4);
ok("structured.snacks.daysObserved = 3", r2.structured.snacks.daysObserved === 3);
ok("snackItems includes apple", r2.structured.snacks.items.includes("apple"));

// ── Test C: Empty / no data ───────────────────────────────────────────────────

console.log("\n── Edge cases ──────────────────────────────────────────────────\n");

const rEmpty = transformLogsToWellnessInputs([], {}, "baseline");
ok("empty baseline: no sleepHours key", rEmpty.sleepHours === undefined);
ok("empty baseline: mealsNote still generated", typeof rEmpty.mealsNote === "string");
ok("empty baseline: structured.dataQuality = limited", rEmpty.structured.dataQuality === "limited");

const rNoKcal = transformLogsToWellnessInputs([], { snacksPerDay: "3", snacks: [] }, "baseline");
ok("snacks with no kcal: note contains count", rNoKcal.snacksNote?.includes("3 snacks per day"));
ok("snacks with no kcal: note has no kcal value", !rNoKcal.snacksNote?.includes("kcal"));

// ── Test D: validationReport (FIX 5) ─────────────────────────────────────────

console.log("\n── Validation report ───────────────────────────────────────────\n");

// Full baseline — all fields filled, no warnings expected
const rFull = transformLogsToWellnessInputs([], bl, "baseline");
ok("full baseline: no warnings", rFull.validationReport.warnings.length === 0);
ok("full baseline: captured.sleep = true", rFull.validationReport.captured.sleep === true);
ok("full baseline: captured.snacks = true", rFull.validationReport.captured.snacks === true);
ok("full baseline: captured.meals = true", rFull.validationReport.captured.meals === true);
ok("full baseline: captured.activity = true", rFull.validationReport.captured.activity === true);

// Incomplete baseline — no sleep, no portions, no activity
// Note: activityDaysPerWeek = "" → Number("") = 0 = valid answer of "0 days", not null.
// Only sleep and meal-portions are truly missing here.
const blIncomplete = createDefaultBaselineIntake();
blIncomplete.snacksPerDay              = "2";
blIncomplete.sleepBed                  = "";   // missing → sleep warning
blIncomplete.sleepWake                 = "";   // missing → sleep warning
blIncomplete.meals.breakfast.portion   = "";   // no portions → meal warning
blIncomplete.meals.lunch.portion       = "";
blIncomplete.meals.dinner.portion      = "";
blIncomplete.activityDaysPerWeek       = "";   // → 0 (valid), no warning
const rIncomplete = transformLogsToWellnessInputs([], blIncomplete, "baseline");
ok("incomplete baseline: sleep warning present",
   rIncomplete.validationReport.warnings.some(w => w.toLowerCase().includes("sleep")));
ok("incomplete baseline: meal warning present",
   rIncomplete.validationReport.warnings.some(w => w.toLowerCase().includes("meal")));
ok("incomplete baseline: captured.sleep = false",
   rIncomplete.validationReport.captured.sleep === false);
ok("incomplete baseline: captured.meals = false",
   rIncomplete.validationReport.captured.meals === false);
// activityDaysPerWeek = 0 is a valid answer → captured = true, no warning
ok("incomplete baseline: captured.activity = true (0 days is a valid answer)",
   rIncomplete.validationReport.captured.activity === true);

// ── Test E: single-source enforcement (FIX 1) ────────────────────────────────

console.log("\n── Single-source output consistency (FIX 1) ───────────────────\n");

ok("transform: structured block present", r.structured != null);
ok("transform: structured.meals block present", r.structured.meals != null);
ok("transform: structured.snacks block present", r.structured.snacks != null);
ok("transform: structured.sleep block present", r.structured.sleep != null);
ok("transform: structured.activity block present", r.structured.activity != null);

// Verify snacks count and kcal are both from the same structured domain
ok("single-source: snacks.averagePerDay set", r.structured.snacks.averagePerDay === 4);
ok("single-source: snacks.averageDailyKcal set", r.structured.snacks.averageDailyKcal === 400);

// No-portions baseline — structured.meals kcal must be null (not patched from note parsers)
ok("single-source: no-portions meals kcal is null in structured",
   rIncomplete.structured.meals.averageDailyKcal === null);
ok("single-source: incomplete snacks count still set",
   rIncomplete.structured.snacks.averagePerDay === 2);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`
────────────────────────────────────────────────────────────
  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total
`);
if (failed === 0) console.log("wellnessLogs transform tests pass. ✅\n");
else { console.log("Some tests failed. ❌\n"); process.exit(1); }

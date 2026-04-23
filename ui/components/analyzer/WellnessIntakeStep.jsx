/**
 * WellnessIntakeStep.jsx — Step 3 (Daily Habits) for weightloss intent.
 *
 * Structured behavioral intake with two modes:
 *
 *   MODE A — Quick Baseline:
 *     Single screen. Captures typical habits all at once via structured rows:
 *     Body → Sleep → Meals (3 rows) → Snacks (repeatable rows) → Activity.
 *
 *   MODE B — Guided Daily Log:
 *     Day-by-day accordion. Each day has Sleep / Meals / Snacks / Activity / Weight.
 *     Aim: 3–7 days for reliable averages.
 *
 * CONSTRAINT: No analysis or transform logic here.
 *             Data is passed up to BusinessAnalyzerWizard, which calls
 *             transformLogsToWellnessInputs before saving the dataset.
 */

import { useState } from "react";
import {
  createDefaultBaselineIntake,
  createEmptyDailyLog,
} from "../../utils/wellnessLogs.js";
import "./BusinessAnalyzer.css";

// ── Constants ─────────────────────────────────────────────────────────────────

const PORTION_OPTIONS = [
  { value: "",       label: "—" },
  { value: "none",   label: "Skipped" },
  { value: "light",  label: "Light (~300 kcal)" },
  { value: "medium", label: "Medium (~500 kcal)" },
  { value: "heavy",  label: "Heavy (~750 kcal)" },
];

const INTENSITY_OPTIONS = [
  { value: "light",    label: "Light (walking, yoga)" },
  { value: "moderate", label: "Moderate (brisk walk, cycling)" },
  { value: "intense",  label: "Intense (running, HIIT)" },
];

const MEAL_KEYS   = /** @type {const} */ (["breakfast", "lunch", "dinner"]);
const MEAL_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

/** @returns {string} YYYY-MM-DD */
function isoToday() {
  return new Date().toISOString().split("T")[0];
}

/** Format YYYY-MM-DD as "Mon, Apr 22" */
function fmtDate(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("default", { weekday: "short", month: "short", day: "numeric" });
}

// ── Shared sub-components ─────────────────────────────────────────────────────

/**
 * Repeatable snack rows with description + optional calories.
 * @param {{ snacks: Array<{id:number,description:string,calories:string}>, onChange: (next: any[]) => void }} props
 */
function SnackRows({ snacks, onChange }) {
  const rows = Array.isArray(snacks) ? snacks : [];

  function patch(i, update) {
    onChange(rows.map((s, idx) => (idx === i ? { ...s, ...update } : s)));
  }

  function add() {
    onChange([...rows, { id: Date.now(), description: "", calories: "" }]);
  }

  function remove(i) {
    onChange(rows.filter((_, idx) => idx !== i));
  }

  return (
    <div className="wl-snack-block">
      {rows.length > 0 && (
        <div className="wl-snack-header" aria-hidden="true">
          <span className="wl-col-desc">Snack</span>
          <span className="wl-col-kcal">Calories (optional)</span>
          <span className="wl-col-remove" />
        </div>
      )}
      {rows.map((snack, i) => (
        <div key={snack.id ?? i} className="wl-snack-row">
          <input
            type="text"
            className="ba-input wl-col-desc"
            placeholder="e.g. nuts, yogurt"
            value={snack.description ?? ""}
            onChange={e => patch(i, { description: e.target.value })}
            aria-label={`Snack ${i + 1} description`}
          />
          <input
            type="number"
            className="ba-input ba-input--number wl-col-kcal"
            placeholder="—"
            min={0}
            step={10}
            value={snack.calories ?? ""}
            onChange={e => patch(i, { calories: e.target.value })}
            aria-label={`Snack ${i + 1} calories`}
          />
          <button
            type="button"
            className="ba-btn ba-btn--ghost ba-btn--sm ba-btn--danger wl-col-remove"
            onClick={() => remove(i)}
            aria-label={`Remove snack ${i + 1}`}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ba-btn ba-btn--ghost ba-btn--sm wl-snack-add"
        onClick={add}
      >
        + Add snack
      </button>
    </div>
  );
}

/**
 * Three-row meal table: breakfast / lunch / dinner, each with description + portion.
 * @param {{ meals: object, onChange: (next: object) => void }} props
 */
function MealRows({ meals, onChange }) {
  const m = meals ?? {};

  function patchMeal(key, update) {
    onChange({ ...m, [key]: { ...(m[key] ?? {}), ...update } });
  }

  return (
    <div className="wl-meal-block">
      <div className="wl-meal-header" aria-hidden="true">
        <span className="wl-meal-col-label">Meal</span>
        <span className="wl-meal-col-desc">What do you typically eat? (optional)</span>
        <span className="wl-meal-col-portion">Portion</span>
      </div>
      {MEAL_KEYS.map(key => (
        <div key={key} className="wl-meal-row">
          <span className="wl-meal-col-label wl-meal-name">{MEAL_LABELS[key]}</span>
          <input
            type="text"
            className="ba-input wl-meal-col-desc"
            placeholder="optional"
            value={m[key]?.description ?? ""}
            onChange={e => patchMeal(key, { description: e.target.value })}
            aria-label={`${MEAL_LABELS[key]} description`}
          />
          <select
            className="ba-input wl-meal-col-portion"
            value={m[key]?.portion ?? ""}
            onChange={e => patchMeal(key, { portion: e.target.value })}
            aria-label={`${MEAL_LABELS[key]} portion`}
          >
            {PORTION_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

// ── Mode A — Quick Baseline ───────────────────────────────────────────────────

/**
 * @param {{ baseline: object, onChange: (next: object) => void }} props
 */
function BaselineForm({ baseline, onChange }) {
  const bl = baseline ?? {};

  function set(patch) {
    onChange({ ...bl, ...patch });
  }

  return (
    <div className="wl-baseline-form">

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="wl-section">
        <div className="wl-section__title">Body</div>
        <div className="wl-row">
          <label className="ba-label wl-row__label" htmlFor="bl-weight">
            Current weight
          </label>
          <div className="wl-row__controls">
            <input
              id="bl-weight"
              type="number"
              className="ba-input ba-input--number"
              min={0}
              step="0.1"
              placeholder="—"
              value={bl.weightValue ?? ""}
              onChange={e => set({ weightValue: e.target.value })}
            />
            <select
              className="ba-input"
              value={bl.weightUnit ?? "lb"}
              onChange={e => set({ weightUnit: e.target.value })}
              aria-label="Weight unit"
            >
              <option value="lb">lbs</option>
              <option value="kg">kg</option>
            </select>
          </div>
        </div>
        <div className="wl-row">
          <label className="ba-label wl-row__label" htmlFor="bl-weight-time">
            Weigh-in time
          </label>
          <select
            id="bl-weight-time"
            className="ba-input"
            value={bl.weightTime ?? "morning"}
            onChange={e => set({ weightTime: e.target.value })}
          >
            <option value="morning">Morning (after waking)</option>
            <option value="evening">Evening</option>
            <option value="varies">Varies</option>
          </select>
        </div>
      </div>

      {/* ── Sleep ─────────────────────────────────────────────────────────── */}
      <div className="wl-section">
        <div className="wl-section__title">Sleep</div>
        <div className="wl-row">
          <label className="ba-label wl-row__label" htmlFor="bl-bed">
            Typical bedtime
          </label>
          <input
            id="bl-bed"
            type="time"
            className="ba-input"
            value={bl.sleepBed ?? ""}
            onChange={e => set({ sleepBed: e.target.value })}
          />
        </div>
        <div className="wl-row">
          <label className="ba-label wl-row__label" htmlFor="bl-wake">
            Typical wake time
          </label>
          <input
            id="bl-wake"
            type="time"
            className="ba-input"
            value={bl.sleepWake ?? ""}
            onChange={e => set({ sleepWake: e.target.value })}
          />
        </div>
      </div>

      {/* ── Meals ─────────────────────────────────────────────────────────── */}
      <div className="wl-section">
        <div className="wl-section__title">Meals</div>
        <div className="ba-step-helper">
          Estimate how much you typically eat at each meal. Descriptions are optional.
        </div>
        <MealRows
          meals={bl.meals}
          onChange={meals => set({ meals })}
        />
      </div>

      {/* ── Snacks ────────────────────────────────────────────────────────── */}
      <div className="wl-section">
        <div className="wl-section__title">Snacks</div>
        <div className="wl-row">
          <label className="ba-label wl-row__label" htmlFor="bl-snacks-per-day">
            Snacks per day (typical)
          </label>
          <input
            id="bl-snacks-per-day"
            type="number"
            className="ba-input ba-input--number"
            min={0}
            max={20}
            step={1}
            placeholder="0"
            value={bl.snacksPerDay ?? ""}
            onChange={e => set({ snacksPerDay: e.target.value })}
          />
        </div>
        <div className="ba-step-helper">
          List your typical snacks below (optional — helps ground the insights):
        </div>
        <SnackRows
          snacks={bl.snacks ?? []}
          onChange={snacks => set({ snacks })}
        />
      </div>

      {/* ── Activity ──────────────────────────────────────────────────────── */}
      <div className="wl-section">
        <div className="wl-section__title">Activity</div>
        <div className="wl-row">
          <label className="ba-label wl-row__label" htmlFor="bl-act-days">
            Days active per week
          </label>
          <input
            id="bl-act-days"
            type="number"
            className="ba-input ba-input--number"
            min={0}
            max={7}
            step={1}
            placeholder="0"
            value={bl.activityDaysPerWeek ?? ""}
            onChange={e => set({ activityDaysPerWeek: e.target.value })}
          />
        </div>
        <div className="wl-row">
          <label className="ba-label wl-row__label" htmlFor="bl-act-mins">
            Duration per session
          </label>
          <div className="wl-row__controls">
            <input
              id="bl-act-mins"
              type="number"
              className="ba-input ba-input--number"
              min={0}
              max={300}
              placeholder="—"
              value={bl.activityMinutesPerSession ?? ""}
              onChange={e => set({ activityMinutesPerSession: e.target.value })}
            />
            <span className="wl-row__unit">min</span>
          </div>
        </div>
        <div className="wl-row">
          <label className="ba-label wl-row__label" htmlFor="bl-act-intensity">
            Intensity
          </label>
          <select
            id="bl-act-intensity"
            className="ba-input"
            value={bl.activityIntensity ?? "moderate"}
            onChange={e => set({ activityIntensity: e.target.value })}
          >
            {INTENSITY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

    </div>
  );
}

// ── Mode B — Guided Daily Log ─────────────────────────────────────────────────

/**
 * Form for a single day's log entry.
 * @param {{ log: object, onChange: (updated: object) => void }} props
 */
function DayLogForm({ log, onChange }) {
  function patch(update) {
    onChange({ ...log, ...update });
  }

  function patchSleep(update) {
    patch({ sleep: { ...(log.sleep ?? {}), ...update } });
  }

  function patchActivity(update) {
    patch({ activity: { ...(log.activity ?? {}), ...update } });
  }

  function patchWeight(update) {
    patch({ weight: { ...(log.weight ?? {}), ...update } });
  }

  return (
    <div className="wl-day-form">

      {/* Sleep */}
      <div className="wl-day-section">
        <div className="wl-day-section__title">Sleep</div>
        <div className="wl-row wl-row--sm">
          <label className="ba-label wl-row__label" htmlFor={`day-bed-${log.date}`}>
            Went to bed
          </label>
          <input
            id={`day-bed-${log.date}`}
            type="time"
            className="ba-input"
            value={log.sleep?.bedtime ?? ""}
            onChange={e => patchSleep({ bedtime: e.target.value })}
          />
        </div>
        <div className="wl-row wl-row--sm">
          <label className="ba-label wl-row__label" htmlFor={`day-wake-${log.date}`}>
            Woke up
          </label>
          <input
            id={`day-wake-${log.date}`}
            type="time"
            className="ba-input"
            value={log.sleep?.wakeTime ?? ""}
            onChange={e => patchSleep({ wakeTime: e.target.value })}
          />
        </div>
      </div>

      {/* Meals */}
      <div className="wl-day-section">
        <div className="wl-day-section__title">Meals</div>
        <MealRows
          meals={log.meals}
          onChange={meals => patch({ meals })}
        />
      </div>

      {/* Snacks */}
      <div className="wl-day-section">
        <div className="wl-day-section__title">Snacks</div>
        <SnackRows
          snacks={log.snacks ?? []}
          onChange={snacks => patch({ snacks })}
        />
      </div>

      {/* Activity */}
      <div className="wl-day-section">
        <div className="wl-day-section__title">Activity (optional)</div>
        <div className="wl-row wl-row--sm">
          <label className="ba-label wl-row__label" htmlFor={`day-dur-${log.date}`}>
            Duration
          </label>
          <div className="wl-row__controls">
            <input
              id={`day-dur-${log.date}`}
              type="number"
              className="ba-input ba-input--number"
              min={0}
              max={300}
              placeholder="—"
              value={log.activity?.durationMinutes ?? ""}
              onChange={e => patchActivity({ durationMinutes: e.target.value })}
            />
            <span className="wl-row__unit">min</span>
          </div>
        </div>
        <div className="wl-row wl-row--sm">
          <label className="ba-label wl-row__label" htmlFor={`day-int-${log.date}`}>
            Intensity
          </label>
          <select
            id={`day-int-${log.date}`}
            className="ba-input"
            value={log.activity?.intensity ?? "moderate"}
            onChange={e => patchActivity({ intensity: e.target.value })}
          >
            {INTENSITY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Weight */}
      <div className="wl-day-section">
        <div className="wl-day-section__title">Weight (optional)</div>
        <div className="wl-row wl-row--sm">
          <label className="ba-label wl-row__label" htmlFor={`day-wt-${log.date}`}>
            Today's weight
          </label>
          <div className="wl-row__controls">
            <input
              id={`day-wt-${log.date}`}
              type="number"
              className="ba-input ba-input--number"
              min={0}
              step="0.1"
              placeholder="—"
              value={log.weight?.value ?? ""}
              onChange={e => patchWeight({ value: e.target.value })}
            />
            <select
              className="ba-input"
              value={log.weight?.unit ?? "lb"}
              onChange={e => patchWeight({ unit: e.target.value })}
              aria-label="Weight unit"
            >
              <option value="lb">lbs</option>
              <option value="kg">kg</option>
            </select>
          </div>
        </div>
      </div>

    </div>
  );
}

/**
 * Accordion list of daily log cards for Mode B.
 * @param {{
 *   dailyLogs:   object[],
 *   onChangeLog: (index: number, updated: object) => void,
 *   onAddDay:    (date: string) => void,
 *   onRemoveDay: (index: number) => void,
 * }} props
 */
function GuidedForm({ dailyLogs, onChangeLog, onAddDay, onRemoveDay }) {
  const logs = Array.isArray(dailyLogs) ? dailyLogs : [];

  const [expandedDate, setExpandedDate] = useState(
    logs.length > 0 ? logs[logs.length - 1].date : null,
  );

  function toggle(date) {
    setExpandedDate(prev => (prev === date ? null : date));
  }

  function handleAddDay() {
    let nextDate;
    if (logs.length > 0) {
      const last = logs[logs.length - 1].date;
      const d    = new Date(last + "T12:00:00");
      d.setDate(d.getDate() + 1);
      nextDate = d.toISOString().split("T")[0];
      if (nextDate > isoToday()) nextDate = isoToday();
    } else {
      nextDate = isoToday();
    }
    // Avoid duplicate dates
    if (logs.some(l => l.date === nextDate)) return;
    onAddDay(nextDate);
    setExpandedDate(nextDate);
  }

  return (
    <div className="wl-guided-form">
      <div className="ba-step-helper">
        Log a few days of your typical habits.
        Aim for <strong>3–7 days</strong> for more accurate insights.
      </div>

      {logs.length === 0 && (
        <div className="wl-guided-empty">
          No days logged yet — add your first day below.
        </div>
      )}

      <div className="wl-day-list">
        {logs.map((log, i) => {
          const isOpen = expandedDate === log.date;
          return (
            <div key={log.date} className={`wl-day-card${isOpen ? " wl-day-card--open" : ""}`}>
              <div
                className="wl-day-card__header"
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => toggle(log.date)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") toggle(log.date); }}
              >
                <span className="wl-day-card__date">{fmtDate(log.date)}</span>
                <div className="wl-day-card__meta">
                  <button
                    type="button"
                    className="ba-btn ba-btn--ghost ba-btn--sm ba-btn--danger"
                    onClick={e => { e.stopPropagation(); onRemoveDay(i); }}
                    aria-label={`Remove ${fmtDate(log.date)}`}
                  >
                    Remove
                  </button>
                  <span className="wl-day-card__chevron" aria-hidden="true">
                    {isOpen ? "▲" : "▼"}
                  </span>
                </div>
              </div>

              {isOpen && (
                <div className="wl-day-card__body">
                  <DayLogForm
                    log={log}
                    onChange={updated => onChangeLog(i, updated)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {logs.length < 7 && (
        <button
          type="button"
          className="ba-btn ba-btn--ghost wl-add-day-btn"
          onClick={handleAddDay}
        >
          + Add day
        </button>
      )}

      {logs.length > 0 && (
        <div className="ba-step-helper wl-guided-status">
          {logs.length} day{logs.length === 1 ? "" : "s"} logged
          {logs.length < 3 ? " — add more for deeper insights" : " — looking good!"}
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Step 2 component for weightloss intent — structured behavioral intake.
 * Mode ("baseline" | "guided") is chosen in WellnessModeSelectionStep (step 1)
 * and passed through formData.intakeMode — no toggle shown here.
 *
 * @param {{
 *   formData: {
 *     intakeMode?:        "baseline" | "guided",
 *     baselineIntake?:    object,
 *     dailyLogs?:         object[],
 *     wellnessGoalWeight?: string,
 *   },
 *   onChange: (updates: object) => void,
 * }} props
 */
export default function WellnessIntakeStep({ formData, onChange }) {
  const intakeMode     = formData.intakeMode    ?? "baseline";
  const baselineIntake = formData.baselineIntake ?? createDefaultBaselineIntake();
  const dailyLogs      = formData.dailyLogs     ?? [];

  return (
    <div className="ba-step-content">

      {/* Context banner — FIX 4: no metric-builder language */}
      <div className="wl-intake-onboarding">
        This step is about understanding your current habits.
      </div>

      {/* Mode hint (read-only — mode was chosen in the previous step) */}
      <div className="wl-intake-mode-hint wl-intake-mode-hint--passive">
        {intakeMode === "baseline"
          ? "Quick snapshot — fill in your typical daily habits."
          : "Daily log — add each day below and aim for 3–7 entries."}
      </div>

      {/* Active form */}
      {intakeMode === "baseline" ? (
        <BaselineForm
          baseline={baselineIntake}
          onChange={next => onChange({ baselineIntake: next })}
        />
      ) : (
        <GuidedForm
          dailyLogs={dailyLogs}
          onChangeLog={(index, updated) =>
            onChange({ dailyLogs: dailyLogs.map((l, i) => (i === index ? updated : l)) })
          }
          onAddDay={date => onChange({ dailyLogs: [...dailyLogs, createEmptyDailyLog(date)] })}
          onRemoveDay={index => onChange({ dailyLogs: dailyLogs.filter((_, i) => i !== index) })}
        />
      )}

      {/* ── Goal weight — shown in both modes ─────────────────────────────── */}
      <div className="wl-section wl-section--goal">
        <div className="wl-section__title">Your goal</div>
        <div className="wl-row">
          <label className="ba-label wl-row__label" htmlFor="wl-goal-weight">
            Goal weight <span className="ba-label--optional">(optional)</span>
          </label>
          <div className="wl-row__controls">
            <input
              id="wl-goal-weight"
              type="number"
              className="ba-input ba-input--number"
              min={0}
              step="0.1"
              placeholder="—"
              value={formData.wellnessGoalWeight ?? ""}
              onChange={e => onChange({ wellnessGoalWeight: e.target.value })}
            />
            <span className="wl-unit-label">lbs</span>
          </div>
        </div>
      </div>

    </div>
  );
}

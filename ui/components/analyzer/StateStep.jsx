/**
 * StateStep.jsx — Screen 2
 * User enters current quantity per entity + the date of measurement.
 * Produces one snapshot per entity (no fabrication of a second snapshot).
 * Shows warning if only one snapshot period will be available.
 */

import "./BusinessAnalyzer.css";

/** @returns {string} Today as YYYY-MM-DD */
function isoDateToday() {
  return new Date().toISOString().split("T")[0];
}

/**
 * @param {{
 *   formData: {
 *     entities:    Array<{ entityId: string, label: string }>,
 *     stateValues: { [entityId: string]: string | number },
 *     stateDate:   string,
 *   },
 *   onChange: (updates: object) => void,
 *   labels:   import("../../utils/intentLabels.js").IntentLabels,
 *   mode:     "create" | "edit",
 *   intent:   string | null,
 * }} props
 */
export default function StateStep({ formData, onChange, labels, mode, intent }) {
  const entities    = formData.entities    ?? [];
  const stateValues = formData.stateValues ?? {};
  const stateDate = formData.stateDate ?? isoDateToday();

  const isWellness = intent === "weightloss";

  function setWellness(updates) {
    onChange(updates);
  }

  function setValueFor(entityId, val) {
    onChange({ stateValues: { ...stateValues, [entityId]: val } });
  }

  // Show the single-snapshot warning for new datasets (no prior data)
  const showSnapshotWarning = mode === "create";

  return (
    <div className="ba-step-content">
      <div className="ba-step-prompt">{labels.statePrompt}</div>
      <div className="ba-step-helper">{labels.stateHelperText}</div>

      {/* Date of measurement */}
      <div className="ba-state-date-row">
        <label className="ba-label" htmlFor="state-date">As of</label>
        <input
          id="state-date"
          type="date"
          className="ba-input"
          value={stateDate}
          max={isoDateToday()}
          onChange={(e) => onChange({ stateDate: e.target.value })}
        />
      </div>

      {/* Per-entity number inputs */}
      <div className="ba-state-table">
        {entities.map((entity) => (
          <div key={entity.entityId} className="ba-state-row">
            <span className="ba-state-row__label">{entity.label}</span>
            <input
              type="number"
              className="ba-input ba-input--number"
              placeholder="0"
              min={0}
              step={isWellness ? "0.1" : "1"}
              value={stateValues[entity.entityId] ?? ""}
              onChange={(e) => setValueFor(entity.entityId, e.target.value)}
              aria-label={`${labels.stateValueLabel ?? "Value"} for ${entity.label}`}
            />
            <span className="ba-state-row__unit">{(labels.stateValueLabel ?? "").toLowerCase()}</span>
          </div>
        ))}
      </div>

      {isWellness && (
        <div className="ba-wellness-extra">
          <div className="ba-wellness-extra__title">Goals & lifestyle (today)</div>
          <div className="ba-wellness-grid">
            <label className="ba-label" htmlFor="wl-goal">
              Goal weight (lbs, optional)
            </label>
            <input
              id="wl-goal"
              type="number"
              className="ba-input ba-input--number"
              min={0}
              step="0.1"
              placeholder="—"
              value={formData.wellnessGoalWeight ?? ""}
              onChange={(e) => setWellness({ wellnessGoalWeight: e.target.value })}
            />

            <label className="ba-label" htmlFor="wl-bed">
              Bedtime (typical)
            </label>
            <input
              id="wl-bed"
              type="time"
              className="ba-input"
              value={formData.wellnessSleepBed ?? ""}
              onChange={(e) => setWellness({ wellnessSleepBed: e.target.value })}
            />

            <label className="ba-label" htmlFor="wl-wake">
              Wake time (typical)
            </label>
            <input
              id="wl-wake"
              type="time"
              className="ba-input"
              value={formData.wellnessSleepWake ?? ""}
              onChange={(e) => setWellness({ wellnessSleepWake: e.target.value })}
            />

            <label className="ba-label" htmlFor="wl-hours">
              Sleep last night (hours)
            </label>
            <input
              id="wl-hours"
              type="number"
              className="ba-input ba-input--number"
              min={0}
              max={24}
              step="0.25"
              placeholder="—"
              value={formData.wellnessSleepHours ?? ""}
              onChange={(e) => setWellness({ wellnessSleepHours: e.target.value })}
            />
          </div>

          <label className="ba-label" htmlFor="wl-meals">
            Meals note (what you ate, timing, hunger)
          </label>
          <textarea
            id="wl-meals"
            className="ba-input ba-textarea"
            rows={2}
            value={formData.wellnessMealsNote ?? ""}
            onChange={(e) => setWellness({ wellnessMealsNote: e.target.value })}
          />

          <label className="ba-label" htmlFor="wl-snacks">
            Snacks note
          </label>
          <textarea
            id="wl-snacks"
            className="ba-input ba-textarea"
            rows={2}
            value={formData.wellnessSnacksNote ?? ""}
            onChange={(e) => setWellness({ wellnessSnacksNote: e.target.value })}
          />
        </div>
      )}

      {/* Single-snapshot warning — shown in create mode (no prior period data) */}
      {showSnapshotWarning && (
        <div className="ba-warning">
          Add earlier data for more accurate trend analysis.
          With only one measurement, results will show current state only — no trend direction.
          You can append a second period later by editing this dataset.
        </div>
      )}
    </div>
  );
}

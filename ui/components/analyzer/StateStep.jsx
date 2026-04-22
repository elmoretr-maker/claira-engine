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
 * }} props
 */
export default function StateStep({ formData, onChange, labels, mode }) {
  const entities    = formData.entities    ?? [];
  const stateValues = formData.stateValues ?? {};
  const stateDate   = formData.stateDate   ?? isoDateToday();

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
              value={stateValues[entity.entityId] ?? ""}
              onChange={(e) => setValueFor(entity.entityId, e.target.value)}
              aria-label={`${labels.stateValueLabel} for ${entity.label}`}
            />
            <span className="ba-state-row__unit">{labels.stateValueLabel.toLowerCase()}</span>
          </div>
        ))}
      </div>

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

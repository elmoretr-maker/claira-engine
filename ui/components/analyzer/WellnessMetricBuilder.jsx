/**
 * WellnessMetricBuilder.jsx
 *
 * Structured metric rows for weightloss intent — preset/custom name, value, unit, add/remove.
 */

import {
  WELLNESS_METRIC_PRESETS,
  WELLNESS_STANDARD_UNITS,
  createDefaultMetricRow,
  getPresetByKey,
  isStandardUnit,
  newMetricEntityId,
} from "../../utils/wellnessMetrics.js";
import "./BusinessAnalyzer.css";

/**
 * @param {{
 *   metrics:    import("../../utils/wellnessMetrics.js").WellnessMetricRow[],
 *   onChange:   (updates: { metrics: import("../../utils/wellnessMetrics.js").WellnessMetricRow[] }) => void,
 *   labels:     import("../../utils/intentLabels.js").IntentLabels,
 * }} props
 */
export default function WellnessMetricBuilder({ metrics, onChange, labels }) {
  const rows = Array.isArray(metrics) ? metrics : [];

  function setMetrics(next) {
    onChange({ metrics: next });
  }

  if (rows.length === 0) {
    return (
      <div className="ba-step-content ba-metric-builder">
        <div className="ba-step-prompt">{labels.entitiesPrompt}</div>
        <div className="ba-step-helper">
          Add one or more metrics (body weight, sleep, meals, snacks, or your own).
        </div>
        <button
          type="button"
          className="ba-btn ba-btn--primary ba-metric-add"
          onClick={() => setMetrics([createDefaultMetricRow()])}
        >
          + Add first metric
        </button>
      </div>
    );
  }

  /**
   * @param {number} index
   * @param {Partial<import("../../utils/wellnessMetrics.js").WellnessMetricRow>} patch
   */
  function patchRow(index, patch) {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    setMetrics(next);
  }

  /**
   * @param {number} index
   * @param {string} presetKey
   */
  function onPresetChange(index, presetKey) {
    const p = getPresetByKey(presetKey);
    if (p) {
      patchRow(index, { preset: presetKey, name: p.name, unit: p.defaultUnit });
    } else {
      patchRow(index, { preset: "custom" });
    }
  }

  /**
   * @param {number} index
   */
  function removeRow(index) {
    if (rows.length <= 1) return;
    setMetrics(rows.filter((_, i) => i !== index));
  }

  function addRow() {
    const id = newMetricEntityId();
    setMetrics([
      ...rows,
      {
        entityId: id,
        preset:   "custom",
        name:     "",
        unit:     "lbs",
        value:    "",
      },
    ]);
  }

  return (
    <div className="ba-step-content ba-metric-builder">
      <div className="ba-step-prompt">{labels.entitiesPrompt}</div>
      <div className="ba-step-helper">
        Add each metric you track. Choose a suggestion or enter a custom name. Put{" "}
        <strong>body weight first</strong> for pace projections on the results screen.
      </div>

      <div className="ba-metric-rows" role="list">
        {rows.map((row, index) => (
          <div key={row.entityId} className="ba-metric-row" role="listitem">
            <div className="ba-metric-row__main">
              <label className="ba-label ba-metric-row__label" htmlFor={`wm-preset-${row.entityId}`}>
                Metric
              </label>
              <select
                id={`wm-preset-${row.entityId}`}
                className="ba-input ba-metric-row__preset"
                value={
                  WELLNESS_METRIC_PRESETS.some((p) => p.key === row.preset && p.name === row.name)
                    ? row.preset
                    : "custom"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "custom") patchRow(index, { preset: "custom" });
                  else onPresetChange(index, v);
                }}
              >
                {WELLNESS_METRIC_PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>

              <input
                type="text"
                className="ba-input ba-metric-row__name"
                placeholder="Metric name"
                value={row.name}
                onChange={(e) => patchRow(index, { name: e.target.value, preset: "custom" })}
                aria-label={`Metric name ${index + 1}`}
              />
            </div>

            <div className="ba-metric-row__nums">
              <label className="ba-label" htmlFor={`wm-val-${row.entityId}`}>
                Value
              </label>
              <input
                id={`wm-val-${row.entityId}`}
                type="number"
                className="ba-input ba-input--number ba-metric-row__value"
                placeholder="—"
                min={0}
                step="any"
                value={row.value}
                onChange={(e) => patchRow(index, { value: e.target.value })}
                aria-label={`Current value for ${row.name || "metric"}`}
              />

              <label className="ba-label" htmlFor={`wm-unit-${row.entityId}`}>
                Unit
              </label>
              <div className="ba-metric-row__unit-wrap">
                <select
                  id={`wm-unit-${row.entityId}`}
                  className="ba-input ba-metric-row__unit-select"
                  value={isStandardUnit(row.unit) ? row.unit : "custom"}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "custom") patchRow(index, { unit: "" });
                    else patchRow(index, { unit: v });
                  }}
                >
                  {WELLNESS_STANDARD_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u === "score" ? "score (1–10)" : u}
                    </option>
                  ))}
                  <option value="custom">Other…</option>
                </select>
                {!isStandardUnit(row.unit) && (
                  <input
                    type="text"
                    className="ba-input ba-metric-row__unit-custom"
                    placeholder="unit"
                    value={row.unit}
                    onChange={(e) => patchRow(index, { unit: e.target.value })}
                    aria-label="Custom unit"
                  />
                )}
              </div>
            </div>

            <button
              type="button"
              className="ba-btn ba-btn--ghost ba-metric-row__remove"
              onClick={() => removeRow(index)}
              disabled={rows.length <= 1}
              aria-label={`Remove ${row.name || "metric"}`}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="ba-btn ba-btn--ghost ba-metric-add" onClick={addRow}>
        + Add metric
      </button>
    </div>
  );
}

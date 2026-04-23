/**
 * ActivityStep.jsx — Screen 3
 * User enters sales and delivery quantities per entity, plus the reporting period.
 * Event timestamp will be set to periodEnd (not midpoint) by datasetTransformer.
 * Shows warning if no activity data is entered (allowed, not blocked).
 */

import "./BusinessAnalyzer.css";

/** @returns {string} Today as YYYY-MM-DD */
function isoDateToday() {
  return new Date().toISOString().split("T")[0];
}

/** @returns {string} N days ago as YYYY-MM-DD */
function isoDateDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

/**
 * @param {{
 *   formData: {
 *     entities:       Array<{ entityId: string, label: string }>,
 *     salesValues:    { [entityId: string]: string | number },
 *     deliveryValues: { [entityId: string]: string | number },
 *     periodStart:    string,
 *     periodEnd:      string,
 *   },
 *   onChange: (updates: object) => void,
 *   labels:   import("../../utils/intentLabels.js").IntentLabels,
 *   intent:   string | null,
 * }} props
 */
export default function ActivityStep({ formData, onChange, labels, intent }) {
  const entities       = formData.entities       ?? [];
  const salesValues    = formData.salesValues    ?? {};
  const deliveryValues = formData.deliveryValues ?? {};
  const periodStart    = formData.periodStart    ?? isoDateDaysAgo(30);
  const periodEnd      = formData.periodEnd      ?? isoDateToday();
  const today          = isoDateToday();

  const isWellness = intent === "weightloss";
  const baselineStateValues = formData.baselineStateValues ?? {};

  function setBaseline(entityId, val) {
    onChange({
      baselineStateValues: { ...baselineStateValues, [entityId]: val },
    });
  }

  const hasAnyActivity = entities.some(
    (e) =>
      Number(salesValues[e.entityId]    ?? 0) > 0 ||
      Number(deliveryValues[e.entityId] ?? 0) > 0,
  );

  function setSale(entityId, val) {
    onChange({ salesValues: { ...salesValues, [entityId]: val } });
  }
  function setDelivery(entityId, val) {
    onChange({ deliveryValues: { ...deliveryValues, [entityId]: val } });
  }

  return (
    <div className="ba-step-content">
      {/* Period date range */}
      <div className="ba-period-row">
        <label className="ba-label">Reporting period:</label>
        <div className="ba-date-range">
          <input
            type="date"
            className="ba-input"
            value={periodStart}
            max={periodEnd}
            onChange={(e) => onChange({ periodStart: e.target.value })}
            aria-label="Period start date"
          />
          <span className="ba-date-range__sep">to</span>
          <input
            type="date"
            className="ba-input"
            value={periodEnd}
            max={today}
            onChange={(e) => onChange({ periodEnd: e.target.value })}
            aria-label="Period end date"
          />
        </div>
      </div>

      <div className="ba-step-helper">
        Event data will be recorded as of the end date you choose above.
      </div>

      {isWellness && (
        <div className="ba-baseline-block">
          <div className="ba-baseline-block__title">
            Starting measurements (as of <strong>{periodStart}</strong>)
          </div>
          <div className="ba-step-helper">
            Enter where each metric stood at the <em>start</em> of the reporting window so we can compute
            change vs your latest readings. Put your body-weight row first for trend forecasts.
          </div>
          <div className="ba-state-table ba-state-table--compact">
            {entities.map((entity) => (
              <div key={`base-${entity.entityId}`} className="ba-state-row">
                <span className="ba-state-row__label">{entity.label}</span>
                <input
                  type="number"
                  className="ba-input ba-input--number"
                  placeholder="—"
                  min={0}
                  step="0.1"
                  value={baselineStateValues[entity.entityId] ?? ""}
                  onChange={(e) => setBaseline(entity.entityId, e.target.value)}
                  aria-label={`Starting value for ${entity.label}`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity table */}
      <div className="ba-activity-table">
        <div className="ba-activity-header">
          <span className="ba-activity-header__entity">{labels.entityNoun}</span>
          <span className="ba-activity-header__col">{labels.salesLabel}</span>
          <span className="ba-activity-header__col">{labels.deliveryLabel}</span>
        </div>

        {entities.map((entity) => (
          <div key={entity.entityId} className="ba-activity-row">
            <span className="ba-activity-row__label">{entity.label}</span>
            <div className="ba-activity-row__input-group">
              <input
                type="number"
                className="ba-input ba-input--number"
                placeholder="0"
                min={0}
                value={salesValues[entity.entityId] ?? ""}
                onChange={(e) => setSale(entity.entityId, e.target.value)}
                aria-label={`${labels.salesLabel} for ${entity.label}`}
              />
            </div>
            <div className="ba-activity-row__input-group">
              <input
                type="number"
                className="ba-input ba-input--number"
                placeholder="0"
                min={0}
                value={deliveryValues[entity.entityId] ?? ""}
                onChange={(e) => setDelivery(entity.entityId, e.target.value)}
                aria-label={`${labels.deliveryLabel} for ${entity.label}`}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Column helper texts aligned under columns */}
      <div className="ba-activity-helpers">
        <div className="ba-step-helper">{labels.salesHelperText}</div>
        <div className="ba-step-helper">{labels.deliveryHelperText}</div>
      </div>

      {/* No-activity warning — warns but does not block */}
      {!hasAnyActivity && (
        <div className="ba-warning ba-warning--soft">
          Results will be limited without activity data.
          You can add sales and deliveries later by editing this dataset.
        </div>
      )}
    </div>
  );
}

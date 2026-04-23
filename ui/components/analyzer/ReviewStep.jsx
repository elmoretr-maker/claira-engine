/**
 * ReviewStep.jsx — Screen 4
 * Shows a summary of all entered data before saving.
 * Net Change is display-only — computed here for user clarity, NOT stored or sent to engine.
 */

import "./BusinessAnalyzer.css";

/**
 * @param {{
 *   formData: {
 *     entities:       Array<{ entityId: string, label: string }>,
 *     stateValues:    { [entityId: string]: string | number },
 *     salesValues:    { [entityId: string]: string | number },
 *     deliveryValues: { [entityId: string]: string | number },
 *     datasetName:    string,
 *   },
 *   onChange: (updates: { datasetName: string }) => void,
 *   labels:   import("../../utils/intentLabels.js").IntentLabels,
 *   intent:   string | null,
 * }} props
 */
export default function ReviewStep({ formData, onChange, labels, intent }) {
  const {
    entities       = [],
    stateValues    = {},
    salesValues    = {},
    deliveryValues = {},
    datasetName    = "",
  } = formData;

  const isWellness = intent === "weightloss";

  return (
    <div className="ba-step-content">
      <div className="ba-step-prompt">Review your data before saving</div>
      <div className="ba-step-helper">
        {isWellness
          ? "We will chart each metric over your date range, project simple linear trends, and add practical notes. This is not medical advice — talk to a clinician for health decisions."
          : "Net Change is shown for reference only — it is not sent to the engine directly. The engine recalculates all values from your raw data."}
      </div>

      {isWellness && (
        <div className="ba-review-wellness-summary">
          {formData.wellnessGoalWeight ? (
            <div>
              <strong>Goal weight:</strong> {formData.wellnessGoalWeight} lbs
            </div>
          ) : null}
          {(formData.wellnessSleepBed || formData.wellnessSleepWake || formData.wellnessSleepHours) ? (
            <div>
              <strong>Sleep:</strong>{" "}
              {[
                formData.wellnessSleepBed && `bed ${formData.wellnessSleepBed}`,
                formData.wellnessSleepWake && `wake ${formData.wellnessSleepWake}`,
                formData.wellnessSleepHours && `${formData.wellnessSleepHours} h`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          ) : null}
          {formData.wellnessMealsNote ? (
            <div>
              <strong>Meals:</strong> {formData.wellnessMealsNote}
            </div>
          ) : null}
          {formData.wellnessSnacksNote ? (
            <div>
              <strong>Snacks:</strong> {formData.wellnessSnacksNote}
            </div>
          ) : null}
        </div>
      )}

      {/* Summary table */}
      <div className="ba-review-table">
        <div className="ba-review-header">
          <span className="ba-review-header__col">{labels.entityNoun}</span>
          <span className="ba-review-header__col">Current Count</span>
          <span className="ba-review-header__col">{labels.salesLabel}</span>
          <span className="ba-review-header__col">{labels.deliveryLabel}</span>
          <span className="ba-review-header__col">Net Change</span>
        </div>

        {entities.map((entity) => {
          const current  = Number(stateValues[entity.entityId]    ?? 0);
          const sold     = Number(salesValues[entity.entityId]    ?? 0);
          const received = Number(deliveryValues[entity.entityId] ?? 0);
          const net      = received - sold;

          return (
            <div key={entity.entityId} className="ba-review-row">
              <span className="ba-review-row__label">{entity.label}</span>
              <span>{Number.isFinite(current) ? current : "—"}</span>
              <span>{sold     > 0 ? sold     : "—"}</span>
              <span>{received > 0 ? received : "—"}</span>
              <span className={net > 0 ? "ba-net--pos" : net < 0 ? "ba-net--neg" : ""}>
                {net > 0 ? `+${net}` : net < 0 ? `${net}` : "—"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Dataset name */}
      <div className="ba-name-field">
        <label className="ba-label" htmlFor="ba-dataset-name">
          Dataset name
        </label>
        <input
          id="ba-dataset-name"
          type="text"
          className="ba-input ba-input--full"
          value={datasetName}
          onChange={(e) => onChange({ datasetName: e.target.value })}
          placeholder={`e.g. ${labels.intentLabel} — ${new Date().toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`}
        />
      </div>
    </div>
  );
}

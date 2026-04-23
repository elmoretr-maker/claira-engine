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

  // Activity period — shown for all intents so users can verify before running
  const periodStart = formData.periodStart ?? "";
  const periodEnd   = formData.periodEnd   ?? "";
  const periodDays  = (() => {
    if (!periodStart || !periodEnd) return 0;
    const d = Math.round((new Date(periodEnd) - new Date(periodStart)) / 86_400_000);
    return d > 0 ? d : 0;
  })();
  const fmtDate = (/** @type {string} */ s) =>
    s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

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
          {/* Goal weight — set in WellnessIntakeStep */}
          {formData.wellnessGoalWeight ? (
            <div>
              <strong>Goal weight:</strong> {formData.wellnessGoalWeight} lbs
            </div>
          ) : null}

          {/* Intake mode — baseline vs. guided daily log */}
          {formData.intakeMode ? (
            <div>
              <strong>Intake mode:</strong>{" "}
              {formData.intakeMode === "baseline" ? "Quick snapshot (typical habits)" : "Guided daily log"}
              {formData.intakeMode === "guided" && Array.isArray(formData.dailyLogs) && formData.dailyLogs.length > 0
                ? ` · ${formData.dailyLogs.length} day${formData.dailyLogs.length === 1 ? "" : "s"} logged`
                : null}
            </div>
          ) : null}

          {/* Baseline sleep — from baselineIntake (new flow) or legacy fields (old flow) */}
          {(() => {
            const bed  = formData.baselineIntake?.sleepBed  || formData.wellnessSleepBed  || "";
            const wake = formData.baselineIntake?.sleepWake || formData.wellnessSleepWake || "";
            const hrs  = formData.wellnessSleepHours || "";
            if (!bed && !wake && !hrs) return null;
            return (
              <div>
                <strong>Sleep:</strong>{" "}
                {[
                  bed  && `bed ${bed}`,
                  wake && `wake ${wake}`,
                  hrs  && `${hrs} h`,
                ].filter(Boolean).join(" · ")}
              </div>
            );
          })()}

          {/* Baseline weight — from baselineIntake (new flow) */}
          {formData.baselineIntake?.weightValue ? (
            <div>
              <strong>Current weight:</strong>{" "}
              {formData.baselineIntake.weightValue} {formData.baselineIntake?.weightUnit ?? "lb"}
            </div>
          ) : null}

          {/* Legacy meal/snack notes — shown only when old flow was used */}
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

      {/* Activity period — always shown so users can verify before running */}
      {(periodStart || periodEnd) && (
        <div className="ba-review-period">
          <span className="ba-review-period__label">Activity period</span>
          <span className="ba-review-period__value">
            {fmtDate(periodStart)} → {fmtDate(periodEnd)}
            {periodDays > 0 && (
              <span className="ba-review-period__days"> ({periodDays} day{periodDays !== 1 ? "s" : ""})</span>
            )}
            {periodDays === 0 && (
              <span className="ba-review-period__warn"> — set a valid range in the Activity step for accurate projections</span>
            )}
          </span>
        </div>
      )}

      {/* Summary table */}
      <div className="ba-review-table">
        <div className="ba-review-header">
          <span className="ba-review-header__col">{labels.entityNoun}</span>
          <span className="ba-review-header__col">Current Count</span>
          <span className="ba-review-header__col">{labels.outLabel}</span>
          <span className="ba-review-header__col">{labels.inLabel}</span>
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

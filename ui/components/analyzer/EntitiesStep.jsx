/**
 * EntitiesStep.jsx — Screen 1
 * Non-wellness: multi-line textarea of entity names.
 * Weightloss: structured metric builder (name / value / unit per row).
 */

import { parseEntityNames } from "../../utils/datasetTransformer.js";
import WellnessMetricBuilder from "./WellnessMetricBuilder.jsx";
import "./BusinessAnalyzer.css";

/**
 * @param {{
 *   formData: object,
 *   onChange: (updates: object) => void,
 *   labels:   import("../../utils/intentLabels.js").IntentLabels,
 *   intent:   string | null,
 * }} props
 */
export default function EntitiesStep({ formData, onChange, labels, intent }) {
  const raw = formData.entityNamesRaw ?? "";

  if (intent === "weightloss") {
    return (
      <WellnessMetricBuilder
        metrics={formData.metrics ?? []}
        onChange={onChange}
        labels={labels}
      />
    );
  }

  const parsed = parseEntityNames(raw);

  return (
    <div className="ba-step-content">
      <div className="ba-step-prompt">{labels.entitiesPrompt}</div>
      <div className="ba-step-helper">
        One {labels.entityNoun.toLowerCase()} per line.
        We will track each one separately and compare them in the results.
      </div>

      <textarea
        className="ba-textarea"
        rows={8}
        placeholder={labels.entitiesPlaceholder}
        value={raw}
        onChange={(e) => onChange({ entityNamesRaw: e.target.value })}
        autoFocus
        aria-label={`${labels.entityNounPlural} — one per line`}
      />

      {parsed.length > 0 && (
        <div className="ba-entities-preview">
          <div className="ba-preview-label">
            {parsed.length} {parsed.length === 1 ? labels.entityNoun : labels.entityNounPlural} detected:
          </div>
          <div className="ba-pill-list">
            {parsed.map((e) => (
              <span key={e.entityId} className="ba-pill">{e.label}</span>
            ))}
          </div>
        </div>
      )}

      {raw.trim().length > 0 && parsed.length === 0 && (
        <div className="ba-warning ba-warning--soft">
          No valid items found. Try entering each name on its own line.
        </div>
      )}
    </div>
  );
}

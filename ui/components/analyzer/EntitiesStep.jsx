/**
 * EntitiesStep.jsx — Screen 1
 * User enters entity names (one per line).
 * Parsed list is shown in real time as a preview.
 */

import { parseEntityNames } from "../../utils/datasetTransformer.js";
import "./BusinessAnalyzer.css";

/**
 * @param {{
 *   formData: { entityNamesRaw?: string },
 *   onChange: (updates: { entityNamesRaw: string }) => void,
 *   labels:   import("../../utils/intentLabels.js").IntentLabels,
 * }} props
 */
export default function EntitiesStep({ formData, onChange, labels }) {
  const raw    = formData.entityNamesRaw ?? "";
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
        // eslint-disable-next-line jsx-a11y/no-autofocus
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

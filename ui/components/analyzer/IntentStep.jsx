/**
 * IntentStep.jsx — Screen 0
 * User selects what they want help understanding.
 * Selection drives all field labels in downstream steps.
 */

import { INTENT_OPTIONS } from "../../utils/intentLabels.js";
import "./BusinessAnalyzer.css";

/**
 * @param {{
 *   value:    string | null,
 *   onChange: (updates: { intent: string }) => void,
 * }} props
 */
export default function IntentStep({ value, onChange }) {
  return (
    <div className="ba-step-content">
      <div className="ba-step-prompt">
        What do you want help understanding or improving?
      </div>
      <div className="ba-step-helper">
        Your answer shapes how we guide you — field names and prompts will adapt to your context.
      </div>

      <div className="ba-intent-grid">
        {INTENT_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            className={`ba-intent-card${value === opt.key ? " ba-intent-card--selected" : ""}`}
            onClick={() => onChange({ intent: opt.key })}
          >
            <span className="ba-intent-card__label">{opt.label}</span>
            <span className="ba-intent-card__desc">{opt.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

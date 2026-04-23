/**
 * WellnessModeSelectionStep.jsx — Step 1 for weightloss intent (replaces "Items").
 *
 * Presents two intake modes as clickable cards:
 *   - Quick snapshot  → formData.intakeMode = "baseline"
 *   - Track for a few days → formData.intakeMode = "guided"
 *
 * Advancing is gated on a selection having been made (isStepValid checks intakeMode).
 */

import "./BusinessAnalyzer.css";

/**
 * @param {{
 *   formData: { intakeMode?: string },
 *   onChange: (updates: object) => void,
 * }} props
 */
export default function WellnessModeSelectionStep({ formData, onChange }) {
  const selected = formData.intakeMode ?? null;

  function pick(mode) {
    onChange({ intakeMode: mode });
  }

  return (
    <div className="ba-step-content">
      <div className="ba-step-prompt">How would you like to get started?</div>
      <div className="ba-step-helper">
        This helps us tailor how we understand your routine.
      </div>
      <div className="ba-step-helper">
        Both options give you the same insights — the difference is depth and accuracy over time.
      </div>

      <div className="wls-mode-cards">

        {/* ── Option 1: Quick snapshot ─────────────────────────────────────── */}
        <button
          type="button"
          className={`wls-mode-card${selected === "baseline" ? " wls-mode-card--selected" : ""}`}
          onClick={() => pick("baseline")}
          aria-pressed={selected === "baseline"}
        >
          <div className="wls-mode-card__badge">Instant results</div>
          <div className="wls-mode-card__title">Quick snapshot</div>
          <div className="wls-mode-card__subtitle">Takes ~2 minutes</div>
          <div className="wls-mode-card__desc">
            Describe your typical daily habits once and get immediate insights.
          </div>
          <div className="wls-mode-card__cta">
            {selected === "baseline" ? "✓ Selected" : "Start now →"}
          </div>
        </button>

        {/* ── Option 2: Track for a few days ───────────────────────────────── */}
        <button
          type="button"
          className={`wls-mode-card${selected === "guided" ? " wls-mode-card--selected" : ""}`}
          onClick={() => pick("guided")}
          aria-pressed={selected === "guided"}
        >
          <div className="wls-mode-card__badge wls-mode-card__badge--rec">Deeper insights</div>
          <div className="wls-mode-card__title">Track for a few days</div>
          <div className="wls-mode-card__subtitle">3–7 days for best results</div>
          <div className="wls-mode-card__desc">
            Log your habits day by day for insights grounded in your actual patterns.
          </div>
          <div className="wls-mode-card__cta">
            {selected === "guided" ? "✓ Selected" : "Start assessment →"}
          </div>
        </button>

      </div>
    </div>
  );
}

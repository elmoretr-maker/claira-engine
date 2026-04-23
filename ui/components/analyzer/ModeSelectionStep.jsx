/**
 * ModeSelectionStep.jsx — Generic reusable mode-selection card step.
 *
 * No intent-specific content is hardcoded here.
 * Callers pass card definitions as props; the component only handles layout and
 * selection state.
 *
 * WellnessModeSelectionStep.jsx wraps this with wellness-specific content.
 * BusinessAnalyzerWizard passes intentConfig.modes for inventory and sales.
 *
 * @param {{
 *   prompt:   string,
 *   helpers?: string[],
 *   cards:    Array<{
 *     key:          string,
 *     badge:        string,
 *     badgeVariant: "default" | "accent",
 *     title:        string,
 *     subtitle:     string,
 *     desc:         string,
 *     cta:          string,
 *   }>,
 *   value:    string | null,
 *   onChange: (key: string) => void,
 * }} props
 */
import "./BusinessAnalyzer.css";

export default function ModeSelectionStep({ prompt, helpers = [], cards = [], value, onChange }) {
  return (
    <div className="ba-step-content">
      <div className="ba-step-prompt">{prompt}</div>

      {helpers.map((h, i) => (
        <div key={i} className="ba-step-helper">{h}</div>
      ))}

      <div className="wls-mode-cards">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            className={`wls-mode-card${value === card.key ? " wls-mode-card--selected" : ""}`}
            onClick={() => onChange(card.key)}
            aria-pressed={value === card.key}
          >
            <div className={[
              "wls-mode-card__badge",
              card.badgeVariant === "accent" ? "wls-mode-card__badge--rec" : "",
            ].filter(Boolean).join(" ")}>
              {card.badge}
            </div>
            <div className="wls-mode-card__title">{card.title}</div>
            <div className="wls-mode-card__subtitle">{card.subtitle}</div>
            <div className="wls-mode-card__desc">{card.desc}</div>
            <div className="wls-mode-card__cta">
              {value === card.key ? "✓ Selected" : card.cta}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

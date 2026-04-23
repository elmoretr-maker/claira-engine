/**
 * OutputTypeStep.jsx — Workforce-only pre-selection step.
 *
 * Asks "What does output look like for your team?" before the entity list step.
 * The selected type is stored in formData.workforceOutputType and used by
 * getActivityLabels("workforce", outputType) to substitute ActivityStep column labels.
 *
 * Three options: tasks · hours · revenue
 */

import "./BusinessAnalyzer.css";

const OUTPUT_TYPE_CARDS = [
  {
    key:      "tasks",
    badge:    "Most common",
    title:    "Tasks or items",
    subtitle: "e.g. tickets, deliveries, cases",
    desc:     "Track how many tasks each person completed vs. how many were assigned.",
    cta:      "Choose →",
  },
  {
    key:      "hours",
    badge:    "Time-based",
    title:    "Hours logged",
    subtitle: "e.g. shifts, billable hours",
    desc:     "Compare hours worked to hours scheduled for each person.",
    cta:      "Choose →",
  },
  {
    key:      "revenue",
    badge:    "Output value",
    title:    "Revenue or units",
    subtitle: "e.g. sales made, products assembled",
    desc:     "Measure output by dollar value or unit volume against a target.",
    cta:      "Choose →",
  },
];

/**
 * @param {{
 *   formData: { workforceOutputType?: string | null },
 *   onChange: (updates: object) => void,
 * }} props
 */
export default function OutputTypeStep({ formData, onChange }) {
  const selected = formData.workforceOutputType ?? null;

  return (
    <div className="ba-step-content">
      <div className="ba-step-prompt">What does output look like for your team?</div>
      <div className="ba-step-helper">
        Your answer shapes how we label and interpret the results.
      </div>

      {/* Three-column grid for this step */}
      <div className="wls-mode-cards wls-mode-cards--three">
        {OUTPUT_TYPE_CARDS.map((card) => (
          <button
            key={card.key}
            type="button"
            className={`wls-mode-card${selected === card.key ? " wls-mode-card--selected" : ""}`}
            onClick={() => onChange({ workforceOutputType: card.key })}
            aria-pressed={selected === card.key}
          >
            <div className="wls-mode-card__badge">{card.badge}</div>
            <div className="wls-mode-card__title">{card.title}</div>
            <div className="wls-mode-card__subtitle">{card.subtitle}</div>
            <div className="wls-mode-card__desc">{card.desc}</div>
            <div className="wls-mode-card__cta">
              {selected === card.key ? "✓ Selected" : card.cta}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

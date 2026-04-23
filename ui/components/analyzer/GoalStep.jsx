/**
 * GoalStep.jsx
 *
 * Optional goal-setting step. Collects a numeric target and an optional deadline.
 * Applies to inventory, sales, workforce, and wellness (weightloss) intents.
 *
 * Stores in: formData.goal = { targetValue: string, targetDate: string }
 *
 * The step is always valid — leaving both fields blank skips goal analysis entirely.
 * When a goal is provided, the analysis layer computes whether the user is on track
 * and what rate is required to meet the target.
 */

import "./BusinessAnalyzer.css";

/** @returns {string} Today as YYYY-MM-DD */
function isoDateToday() {
  return new Date().toISOString().split("T")[0];
}

/** @returns {string} N days from today as YYYY-MM-DD */
function isoDateDaysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

/**
 * Intent-specific copy for the goal step.
 * @type {Record<string, { heading: string, intro: string, valueLabel: string, valuePlaceholder: string, valueHelper: string, dateLabel: string, dateHelper: string }>}
 */
const GOAL_COPY = {
  inventory: {
    heading:          "Set a stock target",
    intro:            "Optional — leave blank to skip. Tell us the minimum stock level you want to maintain and by when. We'll calculate whether your current rate will get you there.",
    valueLabel:       "Target (units)",
    valuePlaceholder: "50",
    valueHelper:      "The lowest stock level (in units) you're comfortable having on hand.",
    dateLabel:        "By when?",
    dateHelper:       "The date you want to evaluate against.",
  },
  sales: {
    heading:          "Set a sales goal",
    intro:            "Optional — leave blank to skip. Enter your target for next period and we'll tell you if your current growth rate will get you there.",
    valueLabel:       "Target (units or orders next period)",
    valuePlaceholder: "200",
    valueHelper:      "How many units or orders do you want to achieve?",
    dateLabel:        "Target date (optional)",
    dateHelper:       "Leave blank to project one period ahead using your current growth rate.",
  },
  workforce: {
    heading:          "Set a completion target",
    intro:            "Optional — leave blank to skip. Set a goal for the team and a deadline. We'll project whether current throughput will get you there.",
    valueLabel:       "Target (tasks, hours, or units)",
    valuePlaceholder: "120",
    valueHelper:      "Total tasks, hours, or units to complete by the deadline.",
    aggregationHint:  "The number here is a single team-wide total: combined output for everyone, even if you track individuals separately in the list step.",
    dateLabel:        "By when?",
    dateHelper:       "The date the team needs to hit the target.",
  },
  weightloss: {
    heading:          "Set a weight goal",
    intro:            "Optional — leave blank to skip. Enter your goal weight and a target date. We'll calculate whether your current pace will get you there.",
    valueLabel:       "Target (lbs)",
    valuePlaceholder: "180",
    valueHelper:      "Your target weight in pounds.",
    dateLabel:        "By when?",
    dateHelper:       "The date you want to reach this weight.",
  },
};

const DEFAULT_COPY = {
  heading:          "Set a goal",
  intro:            "Optional — leave blank to skip.",
  valueLabel:       "Target value",
  valuePlaceholder: "0",
  valueHelper:      "",
  dateLabel:        "By when?",
  dateHelper:       "",
};

/**
 * @param {{
 *   formData: {
 *     intent: string | null,
 *     goal?: { targetValue?: string, targetDate?: string } | null,
 *   },
 *   onChange: (updates: object) => void,
 * }} props
 */
export default function GoalStep({ formData, onChange }) {
  const intent  = formData.intent ?? "custom";
  const goal    = formData.goal   ?? {};
  const copy    = GOAL_COPY[intent] ?? DEFAULT_COPY;
  const aggregationHint = "aggregationHint" in copy ? copy.aggregationHint : null;

  const targetValue = goal.targetValue ?? "";
  const targetDate  = goal.targetDate  ?? "";

  function setGoal(patch) {
    onChange({ goal: { ...goal, ...patch } });
  }

  const today         = isoDateToday();
  const defaultTarget = isoDateDaysFromNow(30);

  const hasInput = targetValue !== "" || targetDate !== "";

  return (
    <div className="ba-step-content">
      <div className="ba-step-prompt">{copy.heading}</div>
      <div className="ba-step-helper">{copy.intro}</div>
      {aggregationHint && (
        <div
          className="ba-step-helper"
          style={{ marginTop: "4px", fontSize: "0.8rem", opacity: 0.9 }}
        >
          {aggregationHint}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "18px", marginTop: "8px" }}>
        {/* Target value */}
        <div>
          <label className="ba-label" htmlFor="goal-target-value">
            {copy.valueLabel}
          </label>
          <input
            id="goal-target-value"
            type="number"
            min="0"
            step="any"
            className="ba-input"
            style={{ width: "140px", display: "block" }}
            placeholder={copy.valuePlaceholder}
            value={targetValue}
            onChange={(e) => setGoal({ targetValue: e.target.value })}
          />
          {copy.valueHelper && (
            <div className="ba-step-helper" style={{ marginTop: "5px" }}>
              {copy.valueHelper}
            </div>
          )}
        </div>

        {/* Target date */}
        <div>
          <label className="ba-label" htmlFor="goal-target-date">
            {copy.dateLabel}
          </label>
          <input
            id="goal-target-date"
            type="date"
            className="ba-input"
            style={{ display: "block" }}
            value={targetDate}
            min={today}
            placeholder={defaultTarget}
            onChange={(e) => setGoal({ targetDate: e.target.value })}
          />
          {copy.dateHelper && (
            <div className="ba-step-helper" style={{ marginTop: "5px" }}>
              {copy.dateHelper}
            </div>
          )}
        </div>
      </div>

      {/* Quiet confirmation when the user has entered something */}
      {hasInput && targetValue !== "" && (
        <div
          style={{
            marginTop: "16px",
            padding: "10px 14px",
            borderRadius: "6px",
            background: "rgba(99, 102, 241, 0.08)",
            borderLeft: "3px solid rgba(99, 102, 241, 0.4)",
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
            lineHeight: "1.5",
          }}
        >
          Goal set — we'll include a goal analysis section in your report.
        </div>
      )}
    </div>
  );
}

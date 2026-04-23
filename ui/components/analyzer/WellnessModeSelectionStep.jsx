/**
 * WellnessModeSelectionStep.jsx — Thin wrapper around ModeSelectionStep.
 *
 * Owns the wellness-specific card content and routes the selection to
 * formData.intakeMode (wellness uses "intakeMode", not "intentMode").
 *
 * The generic ModeSelectionStep handles layout, selection state, and styling.
 */

import ModeSelectionStep from "./ModeSelectionStep.jsx";

/** @type {import("./ModeSelectionStep.jsx").default extends (props: infer P) => any ? P["cards"] : never} */
const WELLNESS_CARDS = [
  {
    key:          "baseline",
    badge:        "Instant results",
    badgeVariant: "default",
    title:        "Quick snapshot",
    subtitle:     "Takes ~2 minutes",
    desc:         "Describe your typical daily habits once and get immediate insights.",
    cta:          "Start now →",
  },
  {
    key:          "guided",
    badge:        "Deeper insights",
    badgeVariant: "accent",
    title:        "Track for a few days",
    subtitle:     "3–7 days for best results",
    desc:         "Log your habits day by day for insights grounded in your actual patterns.",
    cta:          "Start assessment →",
  },
];

/**
 * @param {{
 *   formData: { intakeMode?: string | null },
 *   onChange: (updates: object) => void,
 * }} props
 */
export default function WellnessModeSelectionStep({ formData, onChange }) {
  return (
    <ModeSelectionStep
      prompt="How would you like to get started?"
      helpers={[
        "This helps us tailor how we understand your routine.",
        "Both options give you the same insights — the difference is depth and accuracy over time.",
      ]}
      cards={WELLNESS_CARDS}
      value={formData.intakeMode ?? null}
      onChange={(selected) => onChange({ intakeMode: selected })}
    />
  );
}

/**
 * intentConfig.js
 *
 * Config-driven step system for the Business Analyzer wizard.
 *
 * Each intent config declares:
 *   - steps:        full/default step-type sequence (used before mode is selected)
 *   - activeSteps:  per-mode step sequence (subset of steps; mode selection may remove steps)
 *   - stepLabels:   display name for each step type used by this intent
 *   - usesModeSelection: whether a modeSelection step is included
 *   - modes:        card definitions for ModeSelectionStep (null for wellness — handled by its wrapper)
 *
 * Step type identifiers:
 *   "intent"        → IntentStep           (always step 0)
 *   "modeSelection" → ModeSelectionStep or WellnessModeSelectionStep
 *   "outputType"    → OutputTypeStep        (workforce only)
 *   "entities"      → EntitiesStep
 *   "state"         → StateStep
 *   "activity"      → ActivityStep
 *   "intake"        → WellnessIntakeStep    (weightloss only)
 *   "goal"          → GoalStep              (inventory, sales, workforce, weightloss)
 *   "review"        → ReviewStep
 */

/**
 * @typedef {{
 *   key:          string,
 *   badge:        string,
 *   badgeVariant: "default" | "accent",
 *   title:        string,
 *   subtitle:     string,
 *   desc:         string,
 *   cta:          string,
 * }} ModeCard
 *
 * @typedef {{
 *   intentKey:         string,
 *   usesModeSelection: boolean,
 *   modes:             ModeCard[] | null,
 *   steps:             string[],
 *   activeSteps:       { [modeKey: string]: string[] },
 *   stepLabels:        { [stepType: string]: string },
 * }} IntentConfig
 */

/** @type {Record<string, IntentConfig>} */
const INTENT_CONFIGS = {

  // ── Inventory ──────────────────────────────────────────────────────────────
  inventory: {
    intentKey:         "inventory",
    usesModeSelection: true,
    modes: [
      {
        key:          "quick",
        badge:        "Single snapshot",
        badgeVariant: "default",
        title:        "Quick check",
        subtitle:     "Today's count only",
        desc:         "Enter what you have now and see where each product stands.",
        cta:          "Start →",
      },
      {
        key:          "compare",
        badge:        "Trend analysis",
        badgeVariant: "accent",
        title:        "Compare periods",
        subtitle:     "What sold and what came in",
        desc:         "Add sales and restocking to see what's moving and what's sitting.",
        cta:          "Start →",
      },
    ],
    // Full step list — shown in progress indicator before a mode is selected
    steps: ["intent", "modeSelection", "entities", "state", "activity", "goal", "review"],
    // Active steps per mode — "compare" includes activity, "quick" does not
    activeSteps: {
      quick:   ["intent", "modeSelection", "entities", "state",             "goal", "review"],
      compare: ["intent", "modeSelection", "entities", "state", "activity", "goal", "review"],
    },
    stepLabels: {
      intent:        "Intent",
      modeSelection: "Start",
      entities:      "Products",
      state:         "Stock",
      activity:      "Movement",
      goal:          "Goal",
      review:        "Review",
    },
  },

  // ── Sales ──────────────────────────────────────────────────────────────────
  sales: {
    intentKey:         "sales",
    usesModeSelection: true,
    modes: [
      {
        key:          "period",
        badge:        "Single period",
        badgeVariant: "default",
        title:        "This period",
        subtitle:     "See how items performed now",
        desc:         "Enter what sold this period and find your top and bottom performers.",
        cta:          "Start →",
      },
      {
        key:          "compare",
        badge:        "Trend analysis",
        badgeVariant: "accent",
        title:        "Compare periods",
        subtitle:     "Now vs. before",
        desc:         "Compare this period to a prior period to spot what's growing and what's slipping.",
        cta:          "Start →",
      },
    ],
    // No StateStep for sales — stock level is the wrong input for sales performance
    steps: ["intent", "modeSelection", "entities", "activity", "goal", "review"],
    activeSteps: {
      period:  ["intent", "modeSelection", "entities", "activity", "goal", "review"],
      compare: ["intent", "modeSelection", "entities", "activity", "goal", "review"],
    },
    stepLabels: {
      intent:        "Intent",
      modeSelection: "Start",
      entities:      "Products",
      activity:      "Performance",
      goal:          "Goal",
      review:        "Review",
    },
  },

  // ── Workforce ──────────────────────────────────────────────────────────────
  workforce: {
    intentKey:         "workforce",
    usesModeSelection: false,
    modes:             null,
    // outputType step comes before entities — its answer drives column labels downstream
    // No StateStep — output is measured entirely through activity (completed vs. assigned)
    steps: ["intent", "outputType", "entities", "activity", "goal", "review"],
    activeSteps: {},
    stepLabels: {
      intent:     "Intent",
      outputType: "Output type",
      entities:   "Team",
      activity:   "Performance",
      goal:       "Goal",
      review:     "Review",
    },
  },

  // ── Weightloss (wellness) ──────────────────────────────────────────────────
  weightloss: {
    intentKey:         "weightloss",
    usesModeSelection: true,
    // Wellness mode cards are owned by WellnessModeSelectionStep — not defined here.
    // The wizard renders WellnessModeSelectionStep when intent === "weightloss" at the
    // modeSelection step type, ignoring this null value.
    modes:   null,
    steps:   ["intent", "modeSelection", "intake", "goal", "review"],
    activeSteps: {
      baseline: ["intent", "modeSelection", "intake", "goal", "review"],
      guided:   ["intent", "modeSelection", "intake", "goal", "review"],
    },
    stepLabels: {
      intent:        "Intent",
      modeSelection: "Start",
      intake:        "Daily Habits",
      goal:          "Goal",
      review:        "Review",
    },
  },

  // ── Custom ─────────────────────────────────────────────────────────────────
  custom: {
    intentKey:         "custom",
    usesModeSelection: false,
    modes:             null,
    steps:             ["intent", "entities", "state", "activity", "review"],
    activeSteps:       {},
    stepLabels: {
      intent:   "Intent",
      entities: "Items",
      state:    "Current State",
      activity: "Activity",
      review:   "Review",
    },
  },

};

/**
 * Returns the IntentConfig for a given intent key.
 * Falls back to the custom config for unknown keys.
 *
 * @param {string} intentKey
 * @returns {IntentConfig}
 */
export function getIntentConfig(intentKey) {
  return INTENT_CONFIGS[intentKey] ?? INTENT_CONFIGS.custom;
}

/**
 * Returns the active step array for a given config and current form state.
 * Before mode selection, returns the full default step list so the progress
 * indicator always shows something sensible.
 *
 * @param {IntentConfig} config
 * @param {{ intentMode?: string | null, intakeMode?: string | null }} formData
 * @returns {string[]}
 */
export function getActiveSteps(config, formData) {
  if (!config.usesModeSelection) return config.steps;
  // Wellness uses intakeMode; all other intents use intentMode
  const mode = config.intentKey === "weightloss"
    ? (formData.intakeMode  ?? null)
    : (formData.intentMode  ?? null);
  if (mode && config.activeSteps[mode]) return config.activeSteps[mode];
  return config.steps;
}

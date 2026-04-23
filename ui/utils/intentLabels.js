/**
 * intentLabels.js
 *
 * Maps intent keys to all user-facing label strings.
 * Every step component reads from this module — no hardcoded UI text in step components.
 *
 * @typedef {"inventory"|"sales"|"workforce"|"weightloss"|"custom"} IntentKey
 *
 * @typedef {{
 *   intentLabel:         string,
 *   entitiesPrompt:      string,
 *   entitiesPlaceholder: string,
 *   entityNoun:          string,
 *   entityNounPlural:    string,
 *   statePrompt:         string | null,   // null = intent has no StateStep
 *   stateValueLabel:     string | null,   // null = intent has no StateStep
 *   stateHelperText:     string | null,   // null = intent has no StateStep
 *   stateDateLabel:      string,
 *   salesPrompt:         string,          // reserved — not rendered by any current component
 *   outLabel:            string,
 *   outHelperText:       string,
 *   deliveryPrompt:      string,          // reserved — not rendered by any current component
 *   inLabel:             string,
 *   inHelperText:        string,
 *   periodLabel:         string,
 *   output:              { interpretation: string, actions: string, projection: string, goalHeader: string },
 * }} IntentLabels
 */

/** @type {Record<string, IntentLabels>} */
const INTENT_LABELS = {
  inventory: {
    intentLabel:         "Track my inventory",
    entitiesPrompt:      "What are you tracking?",
    entitiesPlaceholder: "Oxford Classic\nRunning Sneaker\nChelsea Boot",
    entityNoun:          "Product",
    entityNounPlural:    "Products",
    statePrompt:         "How much do you have right now?",
    stateValueLabel:     "On hand",
    stateHelperText:     "Your count as of today — or the most recent count you have.",
    stateDateLabel:      "Count taken on",
    salesPrompt:         "What have you sold recently?",
    outLabel:            "Sold",
    outHelperText:       "Units that left the shelf during this period.",
    deliveryPrompt:      "What have you received recently?",
    inLabel:             "Received",
    inHelperText:        "Units that came in from restocking during this period.",
    periodLabel:         "This covers:",
    output: {
      interpretation: "What this means",
      actions:        "What to act on",
      projection:     "Stock forecast",
      goalHeader:     "Will you run out in time?",
    },
  },
  sales: {
    intentLabel:         "Understand sales performance",
    entitiesPrompt:      "What are you comparing?",
    entitiesPlaceholder: "Product A\nProduct B\nProduct C",
    entityNoun:          "Item",
    entityNounPlural:    "Items",
    // StateStep is not part of the sales flow — null prevents accidental rendering.
    statePrompt:         null,
    stateValueLabel:     null,
    stateHelperText:     null,
    stateDateLabel:      "As of",
    salesPrompt:         "What have you sold recently?",
    outLabel:            "Sold this period",
    outHelperText:       "Sales during this period — helps measure velocity and identify top performers.",
    deliveryPrompt:      "What have you sold in the prior period?",
    inLabel:             "Last period",
    inHelperText:        "Sales from the previous period — used for direct comparison.",
    periodLabel:         "This period covers:",
    output: {
      interpretation: "What this means",
      actions:        "Where to focus",
      projection:     "Trend outlook",
      goalHeader:     "Can you hit your target?",
    },
  },
  workforce: {
    intentLabel:         "Monitor employee output",
    entitiesPrompt:      "Who are you tracking?",
    entitiesPlaceholder: "Alice\nBob\nCharlie",
    entityNoun:          "Employee",
    entityNounPlural:    "Employees",
    statePrompt:         "Where does each person stand right now?",
    stateValueLabel:     "Current output",
    stateHelperText:     "Their most recent output measurement — the baseline for comparison.",
    stateDateLabel:      "As of",
    salesPrompt:         "What did they complete recently?",
    outLabel:            "Completed",
    outHelperText:       "Work finished by this person during the period.",
    deliveryPrompt:      "What was assigned to them?",
    inLabel:             "Assigned",
    inHelperText:        "Work given to this person during the period.",
    periodLabel:         "Over this period:",
    output: {
      interpretation: "What this means",
      actions:        "Where to focus",
      projection:     "Capacity outlook",
      goalHeader:     "Will the team finish on time?",
    },
  },
  weightloss: {
    intentLabel:         "Track weight & wellness",
    entitiesPrompt:      "What are you measuring?",
    entitiesPlaceholder:
      "Body weight (lbs)\nSleep (hours per night)\nMeals (quality 1–10)\nSnacks (quality 1–10)",
    entityNoun:          "Metric",
    entityNounPlural:    "Metrics",
    statePrompt:         "Your latest measurements",
    stateValueLabel:     "Amount",
    stateHelperText:
      "Put body weight first for trend projections. Use decimals for lbs (e.g. 182.4). Add one row per metric.",
    stateDateLabel:      "Measured on",
    salesPrompt:         "Consistency over your reporting window",
    outLabel:            "Days on track",
    outHelperText:
      "Rough count of days you stayed close to plan (food, routine, sleep). Helps spot streaks.",
    deliveryPrompt:      "What worked against your plan?",
    inLabel:             "Off-plan days",
    inHelperText:
      "Travel, stress, skipped sleep, larger meals — anything that tended to stall progress.",
    periodLabel:         "Over this window:",
    output: {
      interpretation: "What this means",
      actions:        "What you can do",
      projection:     "Projection",
      goalHeader:     "Can you reach your goal?",
    },
  },
  custom: {
    intentLabel:         "Custom analysis",
    entitiesPrompt:      "What are you keeping an eye on?",
    entitiesPlaceholder: "Item A\nItem B\nItem C",
    entityNoun:          "Item",
    entityNounPlural:    "Items",
    statePrompt:         "What is the current quantity for each?",
    stateValueLabel:     "Current quantity",
    stateHelperText:     "Your current measurement — the starting point for tracking.",
    stateDateLabel:      "As of",
    salesPrompt:         "What activity has reduced quantity?",
    outLabel:            "Outgoing",
    outHelperText:       "What was used, sold, or removed during the period.",
    deliveryPrompt:      "What activity has increased quantity?",
    inLabel:             "Incoming",
    inHelperText:        "What was added or received during the period.",
    periodLabel:         "This covers:",
    output: {
      interpretation: "What this means",
      actions:        "Suggested actions",
      projection:     "Projection",
      goalHeader:     "Goal analysis",
    },
  },
};

/**
 * Overrides for ActivityStep column labels when a workforce output type is selected.
 * Applied only by getActivityLabels() — never merged into the global label object.
 * @type {Record<string, Partial<IntentLabels>>}
 */
const WORKFORCE_OUTPUT_LABELS = {
  tasks: {
    outLabel:      "Completed",
    outHelperText: "Work finished by this person during the period.",
    inLabel:       "Assigned",
    inHelperText:  "Work given to this person during the period.",
  },
  hours: {
    outLabel:      "Hours logged",
    outHelperText: "Actual time worked during the period.",
    inLabel:       "Hours scheduled",
    inHelperText:  "Time allocated to this person.",
  },
  revenue: {
    outLabel:      "Revenue generated",
    outHelperText: "Sales, billings, or output with a dollar value.",
    inLabel:       "Target / quota",
    inHelperText:  "Their target for this period.",
  },
};

/**
 * Returns the base intent labels. No output-type merging.
 * Use for all UI except ActivityStep column headers.
 *
 * @param {string} intent
 * @returns {IntentLabels}
 */
export function getLabels(intent) {
  return INTENT_LABELS[intent] ?? INTENT_LABELS.custom;
}

/**
 * Returns intent labels with output-type column overrides applied.
 * Only ActivityStep should call this — overrides affect outLabel/inLabel only.
 *
 * @param {string}      intent
 * @param {string|null} [outputType]
 * @returns {IntentLabels}
 */
export function getActivityLabels(intent, outputType = null) {
  const base = INTENT_LABELS[intent] ?? INTENT_LABELS.custom;
  if (intent === "workforce" && outputType && WORKFORCE_OUTPUT_LABELS[outputType]) {
    return { ...base, ...WORKFORCE_OUTPUT_LABELS[outputType] };
  }
  return base;
}

/** Intent options shown on Screen 0. */
export const INTENT_OPTIONS = [
  {
    key:         "inventory",
    label:       "Track my inventory",
    description: "See what's selling, what's sitting, and what needs attention",
  },
  {
    key:         "sales",
    label:       "Understand sales performance",
    description: "Find out what's performing, what's slipping, and where the opportunity is",
  },
  {
    key:         "workforce",
    label:       "Monitor employee output",
    description: "See who's keeping up, who needs support, and where work is piling up",
  },
  {
    key:         "weightloss",
    label:       "Track weight & wellness",
    description:
      "Log weight, meals, snacks, sleep, goals — see trends and forecasts for weeks to a year ahead",
  },
  {
    key:         "custom",
    label:       "Something else",
    description: "Track anything that matters to your situation",
  },
];

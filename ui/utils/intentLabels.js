/**
 * intentLabels.js
 *
 * Maps intent keys to all user-facing label strings.
 * Every step component reads from this module — no hardcoded UI text in step components.
 *
 * @typedef {"inventory"|"sales"|"workforce"|"weightloss"|"custom"} IntentKey
 *
 * @typedef {{
 *   intentLabel:        string,
 *   entitiesPrompt:     string,
 *   entitiesPlaceholder:string,
 *   entityNoun:         string,
 *   entityNounPlural:   string,
 *   statePrompt:        string,
 *   stateValueLabel:    string,
 *   stateHelperText:    string,
 *   salesPrompt:        string,
 *   salesLabel:         string,
 *   salesHelperText:    string,
 *   deliveryPrompt:     string,
 *   deliveryLabel:      string,
 *   deliveryHelperText: string,
 * }} IntentLabels
 */

/** @type {Record<string, IntentLabels>} */
const INTENT_LABELS = {
  inventory: {
    intentLabel:         "Track my inventory",
    entitiesPrompt:      "Add your products",
    entitiesPlaceholder: "Oxford Classic\nRunning Sneaker\nChelsea Boot",
    entityNoun:          "Product",
    entityNounPlural:    "Products",
    statePrompt:         "How many do you have right now?",
    stateValueLabel:     "Current stock",
    stateHelperText:     "Your count right now — the most recent stock measurement you have.",
    salesPrompt:         "What have you sold recently?",
    salesLabel:          "Units sold",
    salesHelperText:     "Helps us understand what's moving and at what rate.",
    deliveryPrompt:      "What have you received recently?",
    deliveryLabel:       "Units received",
    deliveryHelperText:  "Tells us what stock came in — needed to calculate net change accurately.",
  },
  sales: {
    intentLabel:         "Understand sales performance",
    entitiesPrompt:      "Add your products or items",
    entitiesPlaceholder: "Product A\nProduct B\nProduct C",
    entityNoun:          "Item",
    entityNounPlural:    "Items",
    statePrompt:         "What is your current stock level?",
    stateValueLabel:     "Current quantity",
    stateHelperText:     "Your current inventory level — the baseline for understanding performance.",
    salesPrompt:         "What have you sold recently?",
    salesLabel:          "Units sold",
    salesHelperText:     "Sales data lets us measure velocity and identify top performers.",
    deliveryPrompt:      "What have you received recently?",
    deliveryLabel:       "Units received",
    deliveryHelperText:  "Restocking tells us your true sell-through rate.",
  },
  workforce: {
    intentLabel:         "Monitor employee output",
    entitiesPrompt:      "Add your employees or team members",
    entitiesPlaceholder: "Alice\nBob\nCharlie",
    entityNoun:          "Employee",
    entityNounPlural:    "Employees",
    statePrompt:         "What is their current output count?",
    stateValueLabel:     "Current output",
    stateHelperText:     "The most recent measurement of their output — your baseline.",
    salesPrompt:         "What did they complete recently?",
    salesLabel:          "Tasks completed",
    salesHelperText:     "Completions help us measure productivity and compare output rates.",
    deliveryPrompt:      "What was assigned to them?",
    deliveryLabel:       "Assignments received",
    deliveryHelperText:  "Knowing assignments gives context for completion rates.",
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
    salesPrompt:         "Consistency over your reporting window",
    salesLabel:          "Days on track",
    salesHelperText:
      "Rough count of days you stayed close to plan (food, routine, sleep). Helps spot streaks.",
    deliveryPrompt:      "What worked against your plan?",
    deliveryLabel:       "Off-plan days",
    deliveryHelperText:
      "Travel, stress, skipped sleep, larger meals — anything that tended to stall progress.",
  },
  custom: {
    intentLabel:         "Custom analysis",
    entitiesPrompt:      "Add your items",
    entitiesPlaceholder: "Item A\nItem B\nItem C",
    entityNoun:          "Item",
    entityNounPlural:    "Items",
    statePrompt:         "What is the current quantity for each?",
    stateValueLabel:     "Current quantity",
    stateHelperText:     "Your current measurement — the starting point for tracking.",
    salesPrompt:         "What activity has reduced quantity?",
    salesLabel:          "Outgoing quantity",
    salesHelperText:     "What was used, sold, or removed during the period.",
    deliveryPrompt:      "What activity has increased quantity?",
    deliveryLabel:       "Incoming quantity",
    deliveryHelperText:  "What was added or received during the period.",
  },
};

/**
 * @param {string} intent
 * @returns {IntentLabels}
 */
export function getLabels(intent) {
  return INTENT_LABELS[intent] ?? INTENT_LABELS.custom;
}

/** Intent options shown on Screen 0. */
export const INTENT_OPTIONS = [
  {
    key:         "inventory",
    label:       "Track my inventory",
    description: "Monitor stock levels, sales, and restocking over time",
  },
  {
    key:         "sales",
    label:       "Understand sales performance",
    description: "Track what sells, how fast, and what needs attention",
  },
  {
    key:         "workforce",
    label:       "Monitor employee output",
    description: "Measure task completion, productivity, and workload",
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
    description: "Define your own tracking need",
  },
];

/**
 * Domain signals → optional module suggestions (never auto-applied; user selects).
 */

/**
 * @typedef {{
 *   id: string,
 *   keywords: string[],
 *   intro: string,
 *   suggestions: Array<{ moduleId: string, reason: string }>,
 * }} DomainModuleHint
 */

/** @type {DomainModuleHint[]} */
export const DOMAIN_MODULE_HINTS = [
  {
    id: "fitness",
    keywords: [
      "fitness",
      "gym",
      "trainer",
      "training",
      "workout",
      "exercise",
      "athletic",
      "athlete",
      "tracker",
      "personal train",
    ],
    intro: "For fitness systems, users often include:",
    suggestions: [
      { moduleId: "entity_tracking", reason: "Members, clients, or athletes you work with" },
      { moduleId: "asset_registry", reason: "Progress photos and intake documents" },
      { moduleId: "event_log", reason: "Sessions, check-ins, and improvement over time" },
    ],
  },
  {
    id: "medical",
    keywords: ["medical", "clinical", "patient", "healthcare", "hospital", "clinic", "care plan"],
    intro: "For medical or care workflows, users often include:",
    suggestions: [
      { moduleId: "entity_tracking", reason: "Patients or cases you track" },
      { moduleId: "asset_registry", reason: "Imaging, forms, and uploaded records" },
      { moduleId: "event_log", reason: "Visits, notes, and activity history" },
    ],
  },
  {
    id: "project",
    keywords: [
      "project",
      "projects",
      "roadmap",
      "milestone",
      "deliverable",
      "sprint",
      "backlog",
      "kanban",
      "scrum",
      "workstream",
      "initiative",
      "program management",
    ],
    intro: "For project or program workflows, users often include:",
    suggestions: [
      { moduleId: "entity_tracking", reason: "People, teams, or work owners you track" },
      { moduleId: "asset_registry", reason: "Specs, designs, and shared files" },
      { moduleId: "event_log", reason: "Activity, decisions, and history over time" },
    ],
  },
  {
    id: "commerce",
    keywords: ["retail", "ecommerce", "e-commerce", "store", "catalog", "inventory", "shop", "product"],
    intro: "For retail or catalog workflows, users often include:",
    suggestions: [
      { moduleId: "entity_tracking", reason: "Customers or accounts" },
      { moduleId: "asset_registry", reason: "Product images and listing assets" },
      { moduleId: "event_log", reason: "Orders, changes, and activity" },
    ],
  },
];

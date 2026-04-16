/**
 * Guided Build — maps questionnaire answers to industryName + buildIntent text ONLY.
 * Does not select modules, validate selection, or call the analyzer (see MODULE_DISCOVERY_WORKING.md).
 */

/** @typedef {'' | 'progress' | 'people_items' | 'files'} GuidedGoalId */
/** @typedef {'' | 'personal' | 'business' | 'client_based'} GuidedSystemTypeId */
/** @typedef {'' | 'fitness' | 'medical' | 'commerce' | 'project'} GuidedDomainId */

/**
 * @typedef {{
 *   shortLabel: string,
 *   trackPeople: boolean,
 *   trackActivity: boolean,
 *   trackFiles: boolean,
 *   goal: GuidedGoalId,
 *   systemType: GuidedSystemTypeId,
 *   domainContext: GuidedDomainId,
 * }} GuidedBuildAnswers
 */

/** Radio / checkbox labels for UI (no module logic). */
export const GUIDED_TRACK_CHOICES = [
  {
    key: "trackPeople",
    label: "People (clients, users, members, patients)",
    moduleHint: "entity_tracking",
  },
  {
    key: "trackActivity",
    label: "Activity (progress, history, sessions)",
    moduleHint: "event_log",
  },
  {
    key: "trackFiles",
    label: "Files (images, documents, uploads)",
    moduleHint: "asset_registry",
  },
];

export const GUIDED_GOAL_CHOICES = [
  { value: "progress", label: "Track progress and history over time" },
  { value: "people_items", label: "Manage people or catalog items with identities" },
  { value: "files", label: "Organize files, images, and documents" },
];

export const GUIDED_SYSTEM_CHOICES = [
  { value: "personal", label: "Personal" },
  { value: "business", label: "Business / internal operations" },
  { value: "client_based", label: "Client-based (external customers or patients)" },
];

export const GUIDED_DOMAIN_CHOICES = [
  { value: "", label: "No specific domain (general)" },
  { value: "fitness", label: "Fitness / coaching / athletic" },
  { value: "medical", label: "Medical / clinical / care" },
  { value: "commerce", label: "Retail / ecommerce / catalog" },
  { value: "project", label: "Projects / programs / deliveries" },
];

const GOAL_PHRASE = {
  progress: "Primary focus: progress, sessions, and history over time.",
  people_items: "Primary focus: people, customers, patients, or items with clear identities.",
  files: "Primary focus: files, images, documents, and uploads.",
};

const SYSTEM_PHRASE = {
  personal: "Use case: personal or individual.",
  business: "Use case: business or team operations.",
  client_based: "Use case: serving external clients or patients.",
};

const DOMAIN_PHRASE = {
  fitness:
    "Context: fitness, coaching, or gym. Coaches often track clients and session history—modules are confirmed in the next steps, not auto-selected.",
  medical:
    "Context: medical, clinical, or healthcare. Typical needs include patients and visit history—modules are confirmed in the next steps.",
  commerce:
    "Context: retail, shop, or product catalog. Typical needs include customers and order activity—modules are confirmed in the next steps.",
  project:
    "Context: projects or program delivery. Typical needs include owners or teams and activity over time—modules are confirmed in the next steps.",
};

/**
 * @param {GuidedBuildAnswers} answers
 * @returns {{ industryName: string, buildIntent: string }}
 */
export function guidedBuildComposeInput(answers) {
  const shortLabel = String(answers?.shortLabel ?? "").trim();
  const parts = [];

  if (answers?.trackPeople) {
    parts.push(
      "Track people or identities: clients, users, members, patients, customers, or contacts.",
    );
  }
  if (answers?.trackActivity) {
    parts.push("Track activity over time: progress, history, sessions, visits, and timeline.");
  }
  if (answers?.trackFiles) {
    parts.push("Store and organize files: images, documents, uploads, scans, and attachments.");
  }

  const g = String(answers?.goal ?? "");
  if (g && Object.prototype.hasOwnProperty.call(GOAL_PHRASE, g)) parts.push(GOAL_PHRASE[/** @type {keyof typeof GOAL_PHRASE} */ (g)]);

  const st = String(answers?.systemType ?? "");
  if (st && Object.prototype.hasOwnProperty.call(SYSTEM_PHRASE, st)) {
    parts.push(SYSTEM_PHRASE[/** @type {keyof typeof SYSTEM_PHRASE} */ (st)]);
  }

  const dom = String(answers?.domainContext ?? "");
  if (dom && Object.prototype.hasOwnProperty.call(DOMAIN_PHRASE, dom)) {
    parts.push(DOMAIN_PHRASE[/** @type {keyof typeof DOMAIN_PHRASE} */ (dom)]);
  }

  const buildIntent = parts.join(" ").replace(/\s+/g, " ").trim();
  return { industryName: shortLabel, buildIntent };
}

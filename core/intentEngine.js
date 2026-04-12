/**
 * Intent expansion: turn free-text into industry + suggested tasks (keyword rules only).
 * No ML, no network.
 */

import { registerSimulation } from "./simulationRegistry.js";

/** @type {Readonly<Record<string, ReadonlyArray<string>>>} */
const TASK_TEMPLATES = Object.freeze({
  gym: Object.freeze(["clean equipment", "check in members", "sanitize areas"]),
  food_service: Object.freeze(["prep food", "clean kitchen", "manage orders"]),
  ecommerce: Object.freeze(["upload products", "categorize items", "assign tags"]),
  medical: Object.freeze(["verify notes", "check consistency", "confirm documentation"]),
  general: Object.freeze(["complete assigned tasks", "verify outputs"]),
});

/** @type {ReadonlyArray<{ industry: string, keywords: ReadonlyArray<string> }>} */
const INDUSTRY_RULES = Object.freeze([
  { industry: "gym", keywords: Object.freeze(["gym", "fitness"]) },
  { industry: "food_service", keywords: Object.freeze(["restaurant", "kitchen", "bar"]) },
  { industry: "ecommerce", keywords: Object.freeze(["store", "shop", "ecommerce", "wix"]) },
  { industry: "medical", keywords: Object.freeze(["hospital", "patient", "nurse", "doctor"]) },
]);

/** Words that trigger industry detection — keep in keywords, omit as extra task lines. */
const INDUSTRY_TRIGGER_WORDS = (() => {
  /** @type {Set<string>} */
  const s = new Set();
  for (const r of INDUSTRY_RULES) for (const k of r.keywords) s.add(k);
  return s;
})();

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "our",
  "from",
  "this",
  "that",
  "have",
  "has",
  "are",
  "was",
  "were",
  "been",
  "being",
  "will",
  "would",
  "could",
  "should",
  "need",
  "want",
  "help",
  "into",
  "about",
  "your",
  "their",
  "what",
  "when",
  "where",
  "which",
  "who",
  "how",
  "all",
  "any",
  "can",
  "get",
  "got",
  "let",
  "use",
  "using",
  "used",
  "also",
  "just",
  "like",
  "make",
  "made",
  "work",
  "works",
  "today",
  "some",
  "them",
  "they",
  "its",
  "needs",
]);

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeInput(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .trim();
}

/**
 * @param {string} normalized
 * @returns {string}
 */
function detectIndustry(normalized) {
  if (!normalized) return "general";
  for (const { industry, keywords } of INDUSTRY_RULES) {
    for (const kw of keywords) {
      if (normalized.includes(kw)) return industry;
    }
  }
  return "general";
}

/**
 * @param {string} normalized
 * @returns {string[]}
 */
function extractKeywords(normalized) {
  if (!normalized) return [];
  const tokens = normalized
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return [...new Set(tokens)];
}

/**
 * @param {string[]} templates
 * @param {string[]} keywords
 * @returns {string[]}
 */
function combineTasks(templates, keywords) {
  const lowerTemplates = templates.map((t) => t.toLowerCase());
  /** @type {string[]} */
  const extra = [];
  for (const k of keywords) {
    if (INDUSTRY_TRIGGER_WORDS.has(k)) continue;
    const redundant = lowerTemplates.some((t) => t.includes(k) || k.includes(t));
    if (!redundant) extra.push(k);
  }
  return [...templates, ...extra];
}

/**
 * Expand vague user intent into structured suggestions.
 * @param {unknown} inputText
 * @returns {{
 *   industry: string,
 *   suggestedTasks: string[],
 *   extractedKeywords: string[],
 * }}
 */
export function expandIntent(inputText) {
  const normalized = normalizeInput(inputText);
  const industry = detectIndustry(normalized);
  const templates = [...(TASK_TEMPLATES[industry] ?? TASK_TEMPLATES.general)];
  const extractedKeywords = extractKeywords(normalized);
  const suggestedTasks = combineTasks(templates, extractedKeywords);

  return {
    industry,
    suggestedTasks,
    extractedKeywords,
  };
}

registerSimulation({
  name: "intent_templates",
  location: "core/intentEngine.js",
  description: "Rule-based task expansion (no ML)",
  replaceWith: "AI-enhanced intent understanding (optional future)",
});

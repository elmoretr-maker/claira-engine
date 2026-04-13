/**
 * OCR text vs predicted label — additive validation (does not classify).
 * Label hints come from config/structure.json (industry pack), not hardcoded domains.
 */

import { readStructureCategories } from "../interfaces/referenceLoader.js";
import { resolveDestination } from "../routing/router.js";
import { loadEngineConfig } from "../utils/loadConfig.js";

/**
 * @param {string} s
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match a structure keyword against OCR text (phrase substring or single-token word boundary).
 * @param {string} textLower — full text lowercased
 * @param {string} kwRaw
 */
function keywordMatchesText(textLower, kwRaw) {
  const kw = String(kwRaw ?? "").trim().toLowerCase();
  if (kw.length < 2) return false;
  if (/\s/.test(kw) || kw.includes("-")) {
    return textLower.includes(kw);
  }
  return new RegExp(`\\b${escapeRegex(kw)}\\b`).test(textLower);
}

/**
 * Score categories by structure keywords vs OCR text; return best category key (as in structure.json).
 * @param {string} lower — lowercased full text
 * @param {Record<string, string[]>} categories
 * @param {Set<string> | null} allowedLower — if non-null and non-empty, only these category keys (lowercase)
 * @returns {string | null}
 */
function bestCategoryFromStructure(lower, categories, allowedLower) {
  /** @type {{ label: string, score: number, tie: number } | null} */
  let best = null;

  for (const [category, keywords] of Object.entries(categories)) {
    if (!Array.isArray(keywords)) continue;
    const catKey = String(category).trim();
    if (!catKey) continue;
    const catLower = catKey.toLowerCase();
    if (
      allowedLower != null &&
      allowedLower.size > 0 &&
      !allowedLower.has(catLower)
    ) {
      continue;
    }

    let score = 0;
    let tieBreaker = 0;
    for (const rawKw of keywords) {
      if (keywordMatchesText(lower, rawKw)) {
        const kw = String(rawKw).trim().toLowerCase();
        const w = kw.length;
        score += w * w;
        tieBreaker += w;
      }
    }

    if (score <= 0) continue;

    if (
      best == null ||
      score > best.score ||
      (score === best.score && tieBreaker > best.tie)
    ) {
      best = { label: catKey, score, tie: tieBreaker };
    }
  }

  return best?.label ?? null;
}

/**
 * OCR / keyword hint → label using config/structure.json only.
 * Used when embedding confidence is below threshold (see index.js); does not replace strong embeddings.
 *
 * @param {string | null | undefined} text — raw OCR text
 * @param {{
 *   allowedLabels?: Set<string> | null,
 *   categories?: Record<string, string[]> | null,
 * }} [options] — optional structure override; allowedLabels filters by lowercase category key
 * @returns {string | null} category key or null
 */
export function suggestLabelFromText(text, options = {}) {
  if (text == null) return null;
  const raw = String(text).trim();
  if (!raw) return null;

  const categories =
    options.categories != null && typeof options.categories === "object"
      ? options.categories
      : readStructureCategories();

  if (!categories || typeof categories !== "object" || Object.keys(categories).length === 0) {
    return null;
  }

  const allowed =
    options.allowedLabels instanceof Set && options.allowedLabels.size > 0
      ? options.allowedLabels
      : null;

  const lower = raw.toLowerCase();
  return bestCategoryFromStructure(lower, categories, allowed);
}

/**
 * OCR → destination path via structure-driven label + {@link resolveDestination}.
 * @param {string | null | undefined} text
 * @param {{
 *   allowedLabels?: Set<string> | null,
 *   categories?: Record<string, string[]> | null,
 *   config?: Record<string, unknown>,
 * }} [options]
 * @returns {string | null}
 */
export function suggestDestinationFromText(text, options = {}) {
  const label = suggestLabelFromText(text, options);
  if (!label) return null;
  const config = options.config ?? loadEngineConfig();
  return resolveDestination(label, config);
}

/**
 * @param {string | null | undefined} text — raw OCR text
 * @param {string | null | undefined} predicted_label — classifier output label
 * @returns {{ matches: boolean, confidence: number, reason: string } | null}
 */
export function analyzeTextAgainstLabel(text, predicted_label) {
  if (text == null) return null;
  const raw = String(text).trim();
  if (!raw) return null;

  const label = String(predicted_label ?? "").trim().toLowerCase();
  if (!label) return null;

  const normText = raw.toLowerCase();
  const matches = normText.includes(label);

  return {
    matches,
    confidence: matches ? 1 : 0,
    reason: matches
      ? `predicted label "${label}" found in OCR text`
      : `predicted label "${label}" not found in OCR text`,
  };
}

/** @type {ReadonlyArray<{ a: RegExp, b: RegExp, message: string }>} */
const CONFLICTING_TERM_PAIRS = [
  { a: /\bleft\b/i, b: /\bright\b/i, message: "Conflicting directions: both 'left' and 'right' appear" },
  { a: /\bnorth\b/i, b: /\bsouth\b/i, message: "Conflicting directions: both 'north' and 'south' appear" },
  { a: /\beast\b/i, b: /\bwest\b/i, message: "Conflicting directions: both 'east' and 'west' appear" },
  { a: /\bincrease\b/i, b: /\bdecrease\b/i, message: "Conflicting terms: both 'increase' and 'decrease' appear" },
  { a: /\baccept\b/i, b: /\breject\b/i, message: "Conflicting terms: both 'accept' and 'reject' appear" },
];

/** @type {ReadonlyArray<{ phrase: string, insight: string }>} */
const SUSPICIOUS_PHRASES = [
  { phrase: "unknown", insight: 'Suspicious or vague wording: "unknown"' },
  { phrase: "unclear", insight: 'Suspicious or vague wording: "unclear"' },
  { phrase: "approximate", insight: 'Suspicious or vague wording: "approximate"' },
  { phrase: "illegible", insight: 'Suspicious or vague wording: "illegible"' },
  { phrase: "unreadable", insight: 'Suspicious or vague wording: "unreadable"' },
  { phrase: "to be determined", insight: 'Incomplete information: "to be determined"' },
  { phrase: "tbd", insight: 'Incomplete information: "TBD"' },
];

/**
 * Heuristic OCR / content insights (missing keywords, contradictions, vague phrasing).
 * @param {string | null | undefined} text
 * @returns {{ hasInsight: boolean, insights: string[] }}
 */
export function detectInsights(text) {
  if (text == null) return { hasInsight: false, insights: [] };
  const raw = String(text).trim();
  if (!raw) return { hasInsight: false, insights: [] };

  const lower = raw.toLowerCase();
  /** @type {string[]} */
  const insights = [];

  for (const { phrase, insight } of SUSPICIOUS_PHRASES) {
    if (lower.includes(phrase)) insights.push(insight);
  }

  for (const { a, b, message } of CONFLICTING_TERM_PAIRS) {
    if (a.test(raw) && b.test(raw)) insights.push(message);
  }

  if (/\binvoice\b/i.test(raw) && !/\btotal\b/i.test(raw) && !/\bamount\b/i.test(raw)) {
    insights.push("Invoice-like text but no 'total' or 'amount' — may be incomplete");
  }
  if (/\breceipt\b/i.test(raw) && !/\b(date|dated)\b/i.test(raw)) {
    insights.push("Receipt-like text but no date reference — may be incomplete");
  }

  if (raw.length < 12) {
    insights.push("Very little text extracted — content may be incomplete");
  }

  return { hasInsight: insights.length > 0, insights };
}

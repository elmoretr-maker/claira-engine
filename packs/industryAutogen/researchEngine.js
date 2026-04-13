/**
 * Structured research using only searchApprovedSources (approved URLs).
 */

import { readResearchCache, writeResearchCache } from "./researchCache.js";
import { searchApprovedSources } from "./approvedSearch.js";

/**
 * @param {string} raw
 */
export function normalizePackSlug(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

/**
 * @param {string} raw
 */
export function normalizeCategoryKey(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]+/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Turn a Wikipedia title into a plausible category key.
 * @param {string} title
 * @param {string} industrySlug
 */
function titleToCategoryKey(title, industrySlug) {
  const t = String(title ?? "").trim();
  if (t.length < 2 || t.length > 64) return "";
  const lower = t.toLowerCase();
  if (/^list of/i.test(lower) || /^category:/i.test(lower)) return "";
  let k = normalizeCategoryKey(t.replace(/[–—-]/g, " "));
  if (k.length < 2) return "";
  if (k.length > 48) k = k.slice(0, 48).replace(/_+$/, "");
  if (!k) return "";
  if (k === industrySlug || k === normalizeCategoryKey(industrySlug.replace(/-/g, "_"))) return "";
  return k;
}

/**
 * @param {string} industryDisplayName
 * @param {{ useCache?: boolean }} [options]
 * @returns {Promise<{
 *   displayName: string,
 *   slug: string,
 *   categories: string[],
 *   documentTypes: string[],
 *   workflows: string[],
 *   queriesUsed: string[],
 * }>}
 */
export async function buildIndustryKnowledge(industryDisplayName, options = {}) {
  const useCache = options.useCache !== false;
  const displayName = String(industryDisplayName ?? "").trim();
  if (!displayName) throw new Error("Industry name required");

  const slug = normalizePackSlug(displayName);
  if (!slug) throw new Error("Industry name must yield a valid pack slug (letters, numbers, hyphen).");

  if (useCache) {
    const cached = readResearchCache(slug, displayName);
    if (cached && typeof cached === "object") {
      const c = /** @type {Record<string, unknown>} */ (cached);
      if (Array.isArray(c.categories) && Array.isArray(c.queriesUsed)) {
        return {
          displayName: String(c.displayName ?? displayName),
          slug: String(c.slug ?? slug),
          categories: /** @type {string[]} */ (c.categories),
          documentTypes: Array.isArray(c.documentTypes) ? /** @type {string[]} */ (c.documentTypes) : [],
          workflows: Array.isArray(c.workflows) ? /** @type {string[]} */ (c.workflows) : [],
          queriesUsed: /** @type {string[]} */ (c.queriesUsed),
        };
      }
    }
  }

  const queryTemplates = [
    `${displayName} document types`,
    `${displayName} workflows`,
    `${displayName} file formats`,
    `${displayName} forms and records`,
    displayName,
    `${displayName} industry`,
    `${displayName} records management`,
  ];
  const queriesUsed = [...new Set(queryTemplates.map((q) => q.trim()).filter(Boolean))];

  /** @type {Set<string>} */
  const catSet = new Set();
  /** @type {Set<string>} */
  const docHints = new Set();
  /** @type {Set<string>} */
  const flowHints = new Set();

  for (const q of queriesUsed) {
    const hits = await searchApprovedSources(q);
    for (const h of hits) {
      for (let i = 0; i < h.titles.length; i++) {
        const title = h.titles[i];
        const desc = h.descriptions[i] ?? "";
        const ck = titleToCategoryKey(title, slug);
        if (ck) catSet.add(ck);
        const blob = `${title} ${desc}`.toLowerCase();
        if (
          /document|form|pdf|record|paper|scan|file|format|csv|xml|json|spreadsheet|invoice|receipt/i.test(blob)
        ) {
          docHints.add(title.slice(0, 100));
        }
        if (/process|workflow|operations|management|compliance|review|routing|procedure|policy/i.test(blob)) {
          flowHints.add(title.slice(0, 100));
        }
      }
    }
  }

  if (catSet.size < 5) {
    const seed = normalizeCategoryKey(slug.replace(/-/g, "_")) || "general";
    for (const tail of ["documents", "records", "visual_content", "customer_materials", "operations", "compliance"]) {
      catSet.add(`${seed}_${tail}`.replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 48));
    }
  }

  const categories = [...catSet].filter(Boolean).slice(0, 16);
  const documentTypes = [...docHints].slice(0, 20);
  const workflows = [...flowHints].slice(0, 20);

  const result = {
    displayName,
    slug,
    categories,
    documentTypes,
    workflows,
    queriesUsed,
  };

  if (useCache) {
    writeResearchCache(slug, displayName, result);
  }

  return result;
}

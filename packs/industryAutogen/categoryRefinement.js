/**
 * Dedupe, merge similar keys, enforce 5–10 categories; deprioritize generic seed_* placeholders.
 */

import { normalizeCategoryKey, normalizePackSlug } from "./researchEngine.js";

const GENERIC_TAILS = new Set([
  "documents",
  "records",
  "visual_content",
  "customer_materials",
  "operations",
  "compliance",
]);

/**
 * @param {string} a
 * @param {string} b
 */
function jaccardUnderscoreTokens(a, b) {
  const ta = new Set(String(a).split("_").filter((t) => t.length > 2));
  const tb = new Set(String(b).split("_").filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter += 1;
  const u = ta.size + tb.size - inter;
  return u ? inter / u : 0;
}

/**
 * @param {string[]} keys
 * @returns {string[]}
 */
export function mergeSimilarCategoryKeys(keys) {
  const arr = [...new Set(keys.map((k) => normalizeCategoryKey(k)).filter(Boolean))];
  arr.sort((a, b) => b.length - a.length);
  /** @type {string[]} */
  const out = [];
  for (const k of arr) {
    let absorbed = false;
    for (let i = 0; i < out.length; i++) {
      const o = out[i];
      if (k === o) {
        absorbed = true;
        break;
      }
      const j = jaccardUnderscoreTokens(k, o);
      const sub = (long, short) => long.length > short.length + 2 && long.includes(short);
      if (j >= 0.55 || sub(k, o) || sub(o, k)) {
        if (k.length >= o.length) out[i] = k;
        absorbed = true;
        break;
      }
    }
    if (!absorbed) out.push(k);
  }
  return [...new Set(out)];
}

/**
 * @param {string} key
 * @param {string} seed
 */
function isGenericPlaceholder(key, seed) {
  const k = String(key);
  const s = String(seed);
  if (!s || !k.startsWith(`${s}_`)) return false;
  const tail = k.slice(s.length + 1);
  return GENERIC_TAILS.has(tail);
}

/**
 * @param {string[]} categories — raw category keys from research
 * @param {string} industryDisplayName
 * @returns {string[]}
 */
export function refineIndustryCategories(categories, industryDisplayName) {
  const slug = normalizePackSlug(industryDisplayName);
  const seed = normalizeCategoryKey(slug.replace(/-/g, "_")) || "general";

  let keys = mergeSimilarCategoryKeys(categories);

  const nonGeneric = keys.filter((k) => !isGenericPlaceholder(k, seed));
  const genericOnly = keys.filter((k) => isGenericPlaceholder(k, seed));

  /** @type {string[]} */
  let chosen = [...nonGeneric];

  if (chosen.length < 5) {
    for (const g of genericOnly) {
      if (chosen.length >= 10) break;
      if (!chosen.includes(g)) chosen.push(g);
    }
  }

  if (chosen.length < 5) {
    for (const tail of GENERIC_TAILS) {
      if (chosen.length >= 5) break;
      const k = normalizeCategoryKey(`${seed}_${tail}`);
      if (k && !chosen.includes(k)) chosen.push(k);
    }
  }

  if (chosen.length > 10) {
    const ng = chosen.filter((k) => !isGenericPlaceholder(k, seed));
    const g = chosen.filter((k) => isGenericPlaceholder(k, seed));
    chosen = [...ng.slice(0, 10)];
    for (const x of g) {
      if (chosen.length >= 10) break;
      if (!chosen.includes(x)) chosen.push(x);
    }
    chosen = chosen.slice(0, 10);
  }

  return mergeSimilarCategoryKeys(chosen);
}

/**
 * Read-only access to packs/<industry>/reference_assets/ (images, documents, patterns.json, processes.json).
 * No runtime writes — assets are authored under version control.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readActivePackIndustry } from "./packReference.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/**
 * @param {unknown} raw
 */
function sanitizeIndustrySlug(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || !/^[a-z0-9_-]+$/.test(s)) return "";
  return s;
}

/**
 * @param {string} industry
 * @returns {string} absolute path to reference_assets root
 */
export function getReferenceAssetsRoot(industry) {
  const slug = sanitizeIndustrySlug(industry);
  if (!slug) return "";
  return join(ROOT, "packs", slug, "reference_assets");
}

/**
 * @param {string} industry
 * @returns {string | null} absolute path to patterns.json or null
 */
export function getReferencePatternsPath(industry) {
  const root = getReferenceAssetsRoot(industry);
  if (!root) return null;
  const p = join(root, "patterns.json");
  return existsSync(p) ? p : null;
}

/**
 * Read patterns.json for a pack (metadata only — not embedded as CLIP by default).
 * @param {string} industry
 * @returns {Record<string, {
 *   expected_elements?: string[],
 *   optional_elements?: string[],
 *   visual_traits?: string[],
 *   keywords?: string[],
 * }> | null}
 */
export function readReferencePatterns(industry) {
  const path = getReferencePatternsPath(industry);
  if (!path) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    return /** @type {Record<string, object>} */ (j);
  } catch {
    return null;
  }
}

/**
 * @param {string} industry
 * @returns {string | null}
 */
export function getReferenceProcessesPath(industry) {
  const root = getReferenceAssetsRoot(industry);
  if (!root) return null;
  const p = join(root, "processes.json");
  return existsSync(p) ? p : null;
}

/**
 * Workflow / handling metadata per category (UI & decision support only — not used for classification).
 * @param {string} industry
 * @returns {Record<string, {
 *   purpose?: string,
 *   actions?: string[],
 *   priority?: string,
 *   review_required?: boolean,
 * }>}
 */
export function getProcesses(industry) {
  const path = getReferenceProcessesPath(industry);
  if (!path) return {};
  try {
    const raw = readFileSync(path, "utf8");
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object" || Array.isArray(j)) return {};
    /** @type {Record<string, object>} */
    const out = {};
    for (const [k, v] of Object.entries(j)) {
      const key = String(k).trim();
      if (!key || v == null || typeof v !== "object" || Array.isArray(v)) continue;
      out[key] = v;
    }
    return /** @type {Record<string, object>} */ (out);
  } catch {
    return {};
  }
}

/**
 * @param {string} industry
 * @param {string} category
 * @returns {Record<string, unknown> | null}
 */
export function getProcessForCategory(industry, category) {
  const cat = String(category ?? "").trim();
  if (!cat) return null;
  const all = getProcesses(industry);
  const p = all[cat];
  return p && typeof p === "object" ? /** @type {Record<string, unknown>} */ (p) : null;
}

/**
 * @param {string} absDir
 * @returns {string[]} basenames of files (not recursive)
 */
function listFilesSafe(absDir) {
  if (!existsSync(absDir)) return [];
  try {
    return readdirSync(absDir).filter((name) => {
      try {
        const st = statSync(join(absDir, name));
        return st.isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/**
 * Image paths under reference_assets/images/<category>/ (basenames only).
 * @param {string} industry
 * @param {string} category
 * @returns {string[]}
 */
export function listReferenceAssetImages(industry, category) {
  const slug = sanitizeIndustrySlug(industry);
  const cat = String(category ?? "").trim();
  if (!slug || !cat || cat.includes("..") || /[/\\]/.test(cat)) return [];
  const dir = join(ROOT, "packs", slug, "reference_assets", "images", cat);
  return listFilesSafe(dir);
}

/**
 * Document basenames under reference_assets/documents/<category>/
 * @param {string} industry
 * @param {string} category
 * @returns {string[]}
 */
export function listReferenceAssetDocuments(industry, category) {
  const slug = sanitizeIndustrySlug(industry);
  const cat = String(category ?? "").trim();
  if (!slug || !cat || cat.includes("..") || /[/\\]/.test(cat)) return [];
  const dir = join(ROOT, "packs", slug, "reference_assets", "documents", cat);
  return listFilesSafe(dir);
}

/**
 * @param {string} industry
 * @param {string} category
 * @returns {{
 *   industry: string,
 *   category: string,
 *   images: string[],
 *   documents: string[],
 *   patterns: Record<string, unknown> | null,
 *   patternForCategory: Record<string, unknown> | null,
 * }}
 */
export function getReferenceAssets(industry, category) {
  const slug = sanitizeIndustrySlug(industry);
  const cat = String(category ?? "").trim();
  const allPatterns = slug ? readReferencePatterns(slug) : null;
  const patternForCategory =
    allPatterns && cat && typeof allPatterns[cat] === "object" && allPatterns[cat] != null
      ? /** @type {Record<string, unknown>} */ (allPatterns[cat])
      : null;
  const allProcesses = slug ? getProcesses(slug) : {};
  const processForCategory = cat && allProcesses[cat] ? /** @type {Record<string, unknown>} */ (allProcesses[cat]) : null;

  if (!slug || !cat) {
    return {
      industry: slug,
      category: cat,
      images: [],
      documents: [],
      patterns: allPatterns,
      patternForCategory: patternForCategory,
      processes: allProcesses,
      processForCategory: processForCategory,
    };
  }

  return {
    industry: slug,
    category: cat,
    images: listReferenceAssetImages(slug, cat),
    documents: listReferenceAssetDocuments(slug, cat),
    patterns: allPatterns,
    patternForCategory,
    processes: allProcesses,
    processForCategory,
  };
}

/**
 * Uses active pack from config/active_pack.json when industry omitted.
 * @param {string} category
 * @param {string} [industryOverride]
 */
export function getActiveReferenceAssets(category, industryOverride) {
  const slug = sanitizeIndustrySlug(industryOverride) || readActivePackIndustry() || "";
  return getReferenceAssets(slug, category);
}

/**
 * Pack reference.json — UX + onboarding schema (read-only from packs; copied to config).
 * structure.json remains the classification keyword schema.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

export const PACK_REFERENCE_CONFIG_PATH = join(ROOT, "config", "pack_reference.json");
export const ACTIVE_PACK_CONFIG_PATH = join(ROOT, "config", "active_pack.json");

/**
 * @typedef {{
 *   label?: string,
 *   description?: string,
 *   examples?: string[],
 *   subcategories?: Record<string, { label?: string, description?: string, examples?: string[] }>,
 * }} PackCategoryEntry
 */

/**
 * @typedef {{
 *   label?: string,
 *   description?: string,
 *   categories?: string[],
 * }} PackGroupEntry
 */

/**
 * @typedef {{
 *   version?: number,
 *   pack?: { label?: string, inputVerb?: string, intents?: Array<{ value: string, label: string }> },
 *   categories?: Record<string, PackCategoryEntry | unknown>,
 *   groups?: Record<string, PackGroupEntry | unknown>,
 * }} PackReferenceFile
 */

/**
 * Display label from a structure category key when reference.json has no label.
 * @param {string} key
 * @returns {string}
 */
export function humanizeCategoryKey(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param {unknown} raw
 * @returns {PackReferenceFile["pack"] | undefined}
 */
function normalizePackMeta(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const p = /** @type {Record<string, unknown>} */ (raw).pack;
  if (!p || typeof p !== "object" || Array.isArray(p)) return undefined;
  const o = /** @type {Record<string, unknown>} */ (p);
  /** @type {NonNullable<PackReferenceFile["pack"]>} */
  const out = {};
  if (typeof o.label === "string" && o.label.trim()) out.label = o.label.trim();
  if (typeof o.inputVerb === "string" && o.inputVerb.trim()) out.inputVerb = o.inputVerb.trim();
  if (Array.isArray(o.intents)) {
    /** @type {Array<{ value: string, label: string }>} */
    const intents = [];
    for (const it of o.intents) {
      if (!it || typeof it !== "object" || Array.isArray(it)) continue;
      const rec = /** @type {Record<string, unknown>} */ (it);
      const v = typeof rec.value === "string" ? rec.value.trim() : "";
      const l = typeof rec.label === "string" ? rec.label.trim() : "";
      if (v && l) intents.push({ value: v, label: l });
    }
    if (intents.length) out.intents = intents;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * @param {unknown} rawGroups
 * @param {Set<string>} validCategoryKeys
 * @returns {{ groups: Record<string, { label: string, description: string, categories: string[] }>, groupOrder: string[] }}
 */
function normalizePackGroups(rawGroups, validCategoryKeys) {
  if (!rawGroups || typeof rawGroups !== "object" || Array.isArray(rawGroups)) {
    return { groups: {}, groupOrder: [] };
  }
  /** @type {Record<string, { label: string, description: string, categories: string[] }>} */
  const out = {};
  /** @type {string[]} */
  const order = [];
  for (const [key, val] of Object.entries(rawGroups)) {
    const gid = String(key).trim();
    if (!gid || !/^[a-z0-9_-]+$/i.test(gid)) continue;
    if (val == null || typeof val !== "object" || Array.isArray(val)) continue;
    const o = /** @type {Record<string, unknown>} */ (val);
    const label = typeof o.label === "string" ? o.label.trim() : "";
    const description = typeof o.description === "string" ? o.description.trim() : "";
    const rawCats = Array.isArray(o.categories) ? o.categories : [];
    const cats = [
      ...new Set(
        rawCats
          .map((c) => String(c).trim())
          .filter((c) => c && validCategoryKeys.has(c)),
      ),
    ];
    if (cats.length === 0) continue;
    out[gid] = { label: label || gid, description, categories: cats };
    order.push(gid);
  }
  return { groups: out, groupOrder: order };
}

/**
 * @param {unknown} raw
 * @returns {PackCategoryEntry | null}
 */
function normalizeCategoryEntry(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const hasSubs = o.subcategories && typeof o.subcategories === "object" && !Array.isArray(o.subcategories);
  if (
    typeof o.label !== "string" &&
    typeof o.description !== "string" &&
    !Array.isArray(o.examples) &&
    !hasSubs
  ) {
    return null;
  }
  /** @type {PackCategoryEntry} */
  const out = {};
  if (typeof o.label === "string") out.label = o.label.trim();
  if (typeof o.description === "string") out.description = o.description.trim();
  if (Array.isArray(o.examples)) {
    out.examples = o.examples
      .filter((x) => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (o.subcategories && typeof o.subcategories === "object" && !Array.isArray(o.subcategories)) {
    /** @type {Record<string, { label?: string, description?: string, examples?: string[] }>} */
    const subs = {};
    for (const [sk, sv] of Object.entries(o.subcategories)) {
      if (!sk || typeof sv !== "object" || sv == null || Array.isArray(sv)) continue;
      const sub = /** @type {Record<string, unknown>} */ (sv);
      /** @type {{ label?: string, description?: string, examples?: string[] }} */
      const se = {};
      if (typeof sub.label === "string") se.label = sub.label.trim();
      if (typeof sub.description === "string") se.description = sub.description.trim();
      if (Array.isArray(sub.examples)) {
        se.examples = sub.examples
          .filter((x) => typeof x === "string")
          .map((x) => x.trim())
          .filter(Boolean);
      }
      subs[sk] = se;
    }
    out.subcategories = subs;
  }
  return out;
}

/**
 * Read active pack reference from config (never writes pack source files).
 * @returns {PackReferenceFile | null}
 */
export function readPackReference() {
  if (!existsSync(PACK_REFERENCE_CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(PACK_REFERENCE_CONFIG_PATH, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const packMeta = normalizePackMeta(raw);
    const categories = raw.categories;
    if (!categories || typeof categories !== "object" || Array.isArray(categories)) return null;
    /** @type {Record<string, PackCategoryEntry>} */
    const normalized = {};
    for (const [key, val] of Object.entries(categories)) {
      const k = String(key).trim();
      if (!k) continue;
      const ne = normalizeCategoryEntry(val);
      if (ne) normalized[k] = ne;
    }
    if (Object.keys(normalized).length === 0) {
      return {
        version: typeof raw.version === "number" ? raw.version : 1,
        categories: {},
        groups: {},
        groupOrder: [],
        ...(packMeta ? { pack: packMeta } : {}),
      };
    }
    const validKeys = new Set(Object.keys(normalized));
    const rawGroups = /** @type {Record<string, unknown> | undefined} */ (raw).groups;
    const { groups, groupOrder } = normalizePackGroups(rawGroups, validKeys);
    return {
      version: typeof raw.version === "number" ? raw.version : 1,
      categories: normalized,
      groups,
      groupOrder,
      ...(packMeta ? { pack: packMeta } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Category keys in stable order (for tunnels / prefs).
 * @returns {string[]}
 */
export function getPackReferenceCategoryKeys() {
  const p = readPackReference();
  if (!p?.categories) return [];
  return Object.keys(p.categories).sort((a, b) => a.localeCompare(b));
}

/**
 * Collect example phrases for a category (top-level + subcategories) for CLIP text refs.
 * @param {PackCategoryEntry} entry
 * @param {string} categoryKey
 * @returns {Array<{ label: string, phrase: string }>}
 */
export function collectPackReferenceExamplesForLabel(entry, categoryKey) {
  /** @type {Array<{ label: string, phrase: string }>} */
  const index = [];
  const seen = new Set();
  const push = (phrase) => {
    const p = String(phrase).trim().toLowerCase();
    if (!p || seen.has(p)) return;
    seen.add(p);
    index.push({ label: categoryKey, phrase });
  };

  if (entry.examples) {
    for (const ex of entry.examples) push(ex);
  }
  if (entry.subcategories) {
    for (const sub of Object.values(entry.subcategories)) {
      if (!sub?.examples) continue;
      for (const ex of sub.examples) push(ex);
    }
  }
  return index;
}

/**
 * Create output/<category>/ and output/<category>/<subcategory>/ for selected capability keys.
 * @param {string[]} selectedKeys
 * @param {{ cwd?: string }} [options]
 */
export function ensureCapabilityOutputFolders(selectedKeys, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const pack = readPackReference();
  const outRoot = join(cwd, "output");
  mkdirSync(outRoot, { recursive: true });

  const keys = Array.isArray(selectedKeys)
    ? [...new Set(selectedKeys.map((k) => String(k).trim()).filter(Boolean))]
    : [];

  for (const key of keys) {
    if (!/^[a-z0-9_-]+$/i.test(key)) continue;
    const catDir = join(outRoot, key);
    mkdirSync(catDir, { recursive: true });
    const entry = pack?.categories?.[key];
    if (entry?.subcategories && typeof entry.subcategories === "object") {
      for (const subKey of Object.keys(entry.subcategories)) {
        if (!/^[a-z0-9_-]+$/i.test(subKey)) continue;
        mkdirSync(join(catDir, subKey), { recursive: true });
      }
    }
  }
}

/**
 * @param {string} industry
 */
export function writeActivePackMeta(industry) {
  const slug = String(industry ?? "")
    .trim()
    .toLowerCase();
  if (!slug || !/^[a-z0-9_-]+$/.test(slug)) return;
  mkdirSync(dirname(ACTIVE_PACK_CONFIG_PATH), { recursive: true });
  writeFileSync(ACTIVE_PACK_CONFIG_PATH, JSON.stringify({ industry: slug }, null, 2), "utf8");
}

/**
 * @returns {string | null}
 */
export function readActivePackIndustry() {
  try {
    if (!existsSync(ACTIVE_PACK_CONFIG_PATH)) return null;
    const j = JSON.parse(readFileSync(ACTIVE_PACK_CONFIG_PATH, "utf8"));
    const s = typeof j?.industry === "string" ? j.industry.trim().toLowerCase() : "";
    return s || null;
  } catch {
    return null;
  }
}

/**
 * Modular workflow entry is allowed only for packs marked generated (see reference.json pack.workflowSource).
 * @param {string} slug — pack folder name under packs/
 * @returns {"generated" | "prebuilt" | undefined}
 */
export function readPackWorkflowSource(slug) {
  const s = String(slug ?? "")
    .trim()
    .toLowerCase();
  if (!s || !/^[a-z0-9_-]+$/.test(s)) return undefined;
  const refPath = join(ROOT, "packs", s, "reference.json");
  if (!existsSync(refPath)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(refPath, "utf8"));
    const p = raw?.pack;
    if (!p || typeof p !== "object" || Array.isArray(p)) return undefined;
    const ws = /** @type {Record<string, unknown>} */ (p).workflowSource;
    if (ws === "generated" || ws === "prebuilt") return ws;
    return undefined;
  } catch {
    return undefined;
  }
}

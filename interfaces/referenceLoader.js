/**
 * Unified runtime reference loader: optional JSON, structure-driven CLIP text,
 * user images, optional base image dirs. Same CLIP space for all.
 */

import { existsSync, readFileSync } from "fs";
import { readdir } from "fs/promises";
import { basename, dirname, extname, join } from "path";
import { fileURLToPath } from "url";
import { isSupportedImageFilename } from "../adapters/supportedImages.js";
import { getImageEmbedding, getTextEmbeddingsBatch } from "../vision/clipEmbedder.js";
import { collectPackReferenceExamplesForLabel, readActivePackIndustry, readPackReference } from "./packReference.js";
import { getReferenceAssetsRoot } from "./referenceAssets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/** @typedef {{ v: Float32Array, source: "text" | "base" | "user" | "base_asset", meta?: string }} TaggedRef */

const STRUCTURE_PATH = join(ROOT, "config", "structure.json");
const REF_EMBEDDINGS_JSON = join(ROOT, "references", "reference_embeddings.json");
const USER_REF_ROOT = join(ROOT, "references", "user");
const BASE_REF_ROOT = join(ROOT, "references", "base");

/** @type {Promise<Map<string, TaggedRef[]>> | null} */
let cachePromise = null;

export function clearReferenceEmbeddingsCache() {
  cachePromise = null;
}

/**
 * @param {unknown} obj
 * @returns {Map<string, TaggedRef[]>}
 */
export function parseReferenceEmbeddingsFromJson(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("references: expected object of label → vectors");
  }
  const m = new Map();
  for (const [label, val] of Object.entries(obj)) {
    if (!Array.isArray(val) || val.length === 0) continue;

    /** @type {TaggedRef[]} */
    const refs = [];

    if (val[0] && typeof val[0] === "object" && !Array.isArray(val[0]) && "v" in val[0]) {
      for (const item of val) {
        if (!item || typeof item !== "object") continue;
        const rec = /** @type {{ v?: unknown, source?: unknown, meta?: unknown }} */ (item);
        const rawV = rec.v;
        let vec;
        if (Array.isArray(rawV) && rawV.length > 0 && typeof rawV[0] === "number") {
          vec = new Float32Array(/** @type {number[]} */ (rawV));
        } else continue;
        const src =
          rec.source === "text" || rec.source === "base" || rec.source === "user" || rec.source === "base_asset"
            ? rec.source
            : "base";
        const meta = typeof rec.meta === "string" ? rec.meta : undefined;
        refs.push({ v: vec, source: src, meta });
      }
    } else if (typeof val[0] === "number") {
      refs.push({ v: new Float32Array(/** @type {number[]} */ (val)), source: "base" });
    } else {
      for (const row of val) {
        if (!Array.isArray(row)) throw new Error(`references.${label}: expected number[][] or tagged {v,source}`);
        refs.push({ v: new Float32Array(row), source: "base" });
      }
    }

    if (refs.length > 0) m.set(label, refs);
  }
  if (m.size === 0) throw new Error("references: no label pools found");
  return m;
}

/**
 * @returns {Record<string, string[]>}
 */
export function readStructureCategories() {
  if (!existsSync(STRUCTURE_PATH)) return {};
  try {
    const raw = readFileSync(STRUCTURE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const categories = parsed?.categories;
    if (!categories || typeof categories !== "object" || Array.isArray(categories)) return {};
    return /** @type {Record<string, string[]>} */ ({ ...categories });
  } catch {
    return {};
  }
}

/**
 * @returns {Set<string>} lowercase category keys from config/structure.json
 */
export function readStructureCategoryKeysLower() {
  const cats = readStructureCategories();
  return new Set(Object.keys(cats).map((k) => String(k).trim().toLowerCase()).filter(Boolean));
}

/**
 * @param {Map<string, TaggedRef[]>} into
 * @param {Map<string, TaggedRef[]>} from
 */
function mergeTaggedMaps(into, from) {
  for (const [label, refs] of from) {
    if (!refs.length) continue;
    const cur = into.get(label) ?? [];
    cur.push(...refs);
    into.set(label, cur);
  }
}

/**
 * @param {string} absDir
 * @param {string} label
 * @param {Map<string, TaggedRef[]>} into
 * @param {"base" | "user" | "base_asset"} source
 * @param {string} metaPrefix — e.g. "base", "user", "base_asset:image"
 */
async function embedImagesInDir(absDir, label, into, source, metaPrefix) {
  if (!existsSync(absDir)) return;
  const entries = await readdir(absDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !isSupportedImageFilename(e.name)) continue;
    const full = join(absDir, e.name);
    const r = await getImageEmbedding(full);
    if ("error" in r) continue;
    const vec = new Float32Array(r.embedding);
    const meta = `${metaPrefix}:${basename(full)}`;
    const cur = into.get(label) ?? [];
    cur.push({ v: vec, source, meta });
    into.set(label, cur);
  }
}

/**
 * @param {Set<string>} categoryKeys
 */
async function scanBaseReferenceDirs(categoryKeys) {
  /** @type {Map<string, TaggedRef[]>} */
  const out = new Map();
  if (!existsSync(BASE_REF_ROOT)) return out;

  const top = await readdir(BASE_REF_ROOT, { withFileTypes: true });
  if (categoryKeys.size === 0) {
    for (const e of top) {
      if (!e.isDirectory()) continue;
      await embedImagesInDir(join(BASE_REF_ROOT, e.name), e.name, out, "base", "base");
    }
    return out;
  }

  for (const e of top) {
    if (!e.isDirectory()) continue;
    const name = e.name;
    const directPath = join(BASE_REF_ROOT, name);
    if (categoryKeys.has(name)) {
      await embedImagesInDir(directPath, name, out, "base", "base");
      continue;
    }
    const subents = await readdir(directPath, { withFileTypes: true });
    for (const se of subents) {
      if (!se.isDirectory()) continue;
      if (!categoryKeys.has(se.name)) continue;
      await embedImagesInDir(join(directPath, se.name), se.name, out, "base", "base");
    }
  }
  return out;
}

/**
 * @param {Set<string> | null} allowedLabels — if non-null and non-empty, only these folder names
 */
async function scanUserReferenceDirs(allowedLabels) {
  /** @type {Map<string, TaggedRef[]>} */
  const out = new Map();
  if (!existsSync(USER_REF_ROOT)) return out;
  const ents = await readdir(USER_REF_ROOT, { withFileTypes: true });
  for (const e of ents) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const label = e.name;
    if (
      allowedLabels != null &&
      allowedLabels.size > 0 &&
      !allowedLabels.has(label)
    ) {
      continue;
    }
    await embedImagesInDir(join(USER_REF_ROOT, label), label, out, "user", "user");
  }
  return out;
}

/**
 * @param {Record<string, string[]>} categories
 */
async function textRefsFromStructure(categories) {
  /** @type {Map<string, TaggedRef[]>} */
  const out = new Map();
  /** @type {string[]} */
  const phrases = [];
  /** @type {Array<{ label: string, phrase: string }>} */
  const index = [];

  for (const [label, keywords] of Object.entries(categories)) {
    if (!Array.isArray(keywords)) continue;
    for (const raw of keywords) {
      if (typeof raw !== "string") continue;
      const kw = raw.trim();
      if (!kw) continue;
      const phrase = `a product photo of ${kw}`;
      phrases.push(phrase);
      index.push({ label, phrase: kw });
    }
  }

  if (phrases.length === 0) return out;

  const batch = await getTextEmbeddingsBatch(phrases);
  if ("error" in batch) {
    throw new Error(`referenceLoader: text embeddings failed: ${batch.message}`);
  }

  for (let i = 0; i < phrases.length; i++) {
    const { label, phrase } = index[i];
    const emb = batch.embeddings[i];
    if (!emb?.length) continue;
    const vec = new Float32Array(emb);
    const cur = out.get(label) ?? [];
    cur.push({ v: vec, source: "text", meta: phrase });
    out.set(label, cur);
  }

  return out;
}

/**
 * CLIP text embeddings from config/pack_reference.json examples (UX pack; not structure keywords).
 * @returns {Promise<Map<string, TaggedRef[]>>}
 */
/**
 * @param {unknown} obj
 * @param {number} [maxLen]
 */
function flattenJsonForPhrase(obj, maxLen = 400) {
  if (obj == null) return "";
  if (typeof obj === "string") return obj.slice(0, maxLen);
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    return obj
      .map((x) => flattenJsonForPhrase(x, 80))
      .join(", ")
      .slice(0, maxLen);
  }
  if (typeof obj === "object") {
    const parts = [];
    for (const [k, v] of Object.entries(obj)) {
      parts.push(`${k}: ${flattenJsonForPhrase(v, 120)}`);
    }
    return parts.join("; ").slice(0, maxLen);
  }
  return "";
}

/**
 * CLIP text embeddings from synthetic / mock documents under packs/<slug>/reference_assets/documents/<label>/
 * @param {string} slug
 * @param {Set<string>} categoryKeys
 * @returns {Promise<Map<string, TaggedRef[]>>}
 */
async function textRefsFromReferenceAssetDocuments(slug, categoryKeys) {
  /** @type {Map<string, TaggedRef[]>} */
  const out = new Map();
  const root = getReferenceAssetsRoot(slug);
  if (!root || !existsSync(root)) return out;

  /** @type {string[]} */
  const phrases = [];
  /** @type {Array<{ label: string, meta: string }>} */
  const index = [];

  for (const label of categoryKeys) {
    const docDir = join(root, "documents", label);
    if (!existsSync(docDir)) continue;
    const ents = await readdir(docDir, { withFileTypes: true });
    for (const e of ents) {
      if (!e.isFile()) continue;
      const name = e.name;
      const lower = name.toLowerCase();
      const full = join(docDir, name);
      let phrase = "";
      const meta = `base_asset:doc:${basename(full)}`;
      try {
        if (lower.endsWith(".json")) {
          const raw = readFileSync(full, "utf8");
          const j = JSON.parse(raw);
          phrase = flattenJsonForPhrase(j);
          if (phrase) phrase = `reference document describing ${label}: ${phrase}`;
        } else if (lower.endsWith(".txt") || lower.endsWith(".md")) {
          phrase = readFileSync(full, "utf8").trim().slice(0, 500);
          if (phrase) phrase = `reference document text for ${label}: ${phrase}`;
        } else {
          continue;
        }
      } catch {
        continue;
      }
      const p = phrase.trim();
      if (!p) continue;
      phrases.push(p);
      index.push({ label, meta });
    }
  }

  if (phrases.length === 0) return out;

  const batch = await getTextEmbeddingsBatch(phrases);
  if ("error" in batch) {
    return out;
  }

  for (let i = 0; i < phrases.length; i++) {
    const row = index[i];
    const emb = batch.embeddings[i];
    if (!emb?.length) continue;
    const vec = new Float32Array(emb);
    const cur = out.get(row.label) ?? [];
    cur.push({ v: vec, source: "base_asset", meta: row.meta });
    out.set(row.label, cur);
  }

  return out;
}

/**
 * @param {string} slug
 * @param {Set<string>} categoryKeys
 * @returns {Promise<Map<string, TaggedRef[]>>}
 */
async function scanPackReferenceAssetImages(slug, categoryKeys) {
  /** @type {Map<string, TaggedRef[]>} */
  const out = new Map();
  const root = getReferenceAssetsRoot(slug);
  if (!root || !existsSync(root)) return out;
  const imgRoot = join(root, "images");
  if (!existsSync(imgRoot)) return out;
  for (const label of categoryKeys) {
    const dir = join(imgRoot, label);
    await embedImagesInDir(dir, label, out, "base_asset", "base_asset:image");
  }
  return out;
}

async function textRefsFromPackReference() {
  /** @type {Map<string, TaggedRef[]>} */
  const out = new Map();
  const pack = readPackReference();
  if (!pack?.categories) return out;

  /** @type {string[]} */
  const phrases = [];
  /** @type {Array<{ label: string, phrase: string }>} */
  const index = [];

  for (const [categoryKey, entry] of Object.entries(pack.categories)) {
    const rows = collectPackReferenceExamplesForLabel(entry, categoryKey);
    for (const { label, phrase } of rows) {
      phrases.push(`a reference image showing ${phrase}`);
      index.push({ label, phrase });
    }
  }

  if (phrases.length === 0) return out;

  const batch = await getTextEmbeddingsBatch(phrases);
  if ("error" in batch) {
    throw new Error(`referenceLoader: pack reference text embeddings failed: ${batch.message}`);
  }

  for (let i = 0; i < phrases.length; i++) {
    const { label, phrase } = index[i];
    const emb = batch.embeddings[i];
    if (!emb?.length) continue;
    const vec = new Float32Array(emb);
    const cur = out.get(label) ?? [];
    cur.push({ v: vec, source: "text", meta: `pack_ref:${phrase}` });
    out.set(label, cur);
  }

  return out;
}

async function loadAllReferencesInternal() {
  /** @type {Map<string, TaggedRef[]>} */
  const merged = new Map();

  const categories = readStructureCategories();
  const categoryKeys = new Set(Object.keys(categories));

  if (existsSync(REF_EMBEDDINGS_JSON)) {
    const raw = readFileSync(REF_EMBEDDINGS_JSON, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
      try {
        const fromFile = parseReferenceEmbeddingsFromJson(parsed);
        for (const [label, refs] of fromFile) {
          const kept = refs.filter((r) => r.source !== "user");
          if (kept.length > 0) {
            mergeTaggedMaps(merged, new Map([[label, kept]]));
          }
        }
      } catch {
        /* ignore invalid pack file; runtime text still fills */
      }
    }
  }

  const fromText = await textRefsFromStructure(categories);
  mergeTaggedMaps(merged, fromText);

  const fromPackRef = await textRefsFromPackReference();
  mergeTaggedMaps(merged, fromPackRef);

  const packSlug = readActivePackIndustry();
  if (packSlug) {
    const fromAssetImg = await scanPackReferenceAssetImages(packSlug, categoryKeys);
    mergeTaggedMaps(merged, fromAssetImg);
    const fromAssetDoc = await textRefsFromReferenceAssetDocuments(packSlug, categoryKeys);
    mergeTaggedMaps(merged, fromAssetDoc);
  }

  const fromBase = await scanBaseReferenceDirs(categoryKeys);
  mergeTaggedMaps(merged, fromBase);

  const userAllowed = categoryKeys.size > 0 ? categoryKeys : null;
  const fromUser = await scanUserReferenceDirs(userAllowed);
  mergeTaggedMaps(merged, fromUser);

  if (merged.size === 0) {
    throw new Error(
      "referenceLoader: no reference vectors — add config/structure.json categories and/or references/reference_embeddings.json",
    );
  }

  return merged;
}

/**
 * @returns {Promise<Map<string, TaggedRef[]>>}
 */
export async function loadAllReferenceEmbeddings() {
  if (!cachePromise) {
    cachePromise = loadAllReferencesInternal();
  }
  return cachePromise;
}

/**
 * Progress tracking + industry feature config (local workspace data only).
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { createTrackingEntity, getTrackingEntity, listTrackingEntities } from "../tracking/entityStore.js";
import { computeProgressMetrics } from "../tracking/progressMetrics.js";
import { interpretationForIndustry } from "../tracking/industryInterpretation.js";
import { addTrackingSnapshot, listSnapshotsForEntity } from "../tracking/snapshotStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/**
 * @param {string} name
 */
function readConfigJson(name) {
  const p = join(ROOT, "config", name);
  if (!existsSync(p)) return {};
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return j && typeof j === "object" && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} slug
 */
export function getIndustryFeaturesForSlug(slug) {
  const raw = readConfigJson("industryFeatures.json");
  const s = String(slug ?? "").trim().toLowerCase();
  if (s && Array.isArray(raw[s])) return raw[s];
  /** @type {[string, RegExp][]} */
  const hints = [
    ["fitness", /fit|gym|yoga|physique|wellness|training|coach/],
    ["medical", /med|clinic|health|patient|hospital|dental|vet/],
    ["construction", /construct|build|contract|site|trades/],
  ];
  for (const [key, re] of hints) {
    if (re.test(s) && Array.isArray(raw[key])) return raw[key];
  }
  return Array.isArray(raw.default) ? raw.default : [];
}

/**
 * Resolve framing / scale consistency thresholds (default merged with optional per-industry overrides).
 * @param {string} industry
 */
export function resolveTrackingConsistencyConfig(industry) {
  const raw = readConfigJson("trackingConsistency.json");
  const def =
    raw.default && typeof raw.default === "object" && !Array.isArray(raw.default)
      ? /** @type {Record<string, unknown>} */ (raw.default)
      : {};
  const ind = String(industry ?? "").trim().toLowerCase();
  const over =
    ind && raw[ind] && typeof raw[ind] === "object" && !Array.isArray(raw[ind])
      ? /** @type {Record<string, unknown>} */ (raw[ind])
      : {};
  const framingAspectThreshold =
    typeof over.framingAspectThreshold === "number" && Number.isFinite(over.framingAspectThreshold)
      ? over.framingAspectThreshold
      : typeof def.framingAspectThreshold === "number" && Number.isFinite(def.framingAspectThreshold)
        ? def.framingAspectThreshold
        : 0.35;
  const scaleCvThreshold =
    typeof over.scaleCvThreshold === "number" && Number.isFinite(over.scaleCvThreshold)
      ? over.scaleCvThreshold
      : typeof def.scaleCvThreshold === "number" && Number.isFinite(def.scaleCvThreshold)
        ? def.scaleCvThreshold
        : 0.28;
  return { framingAspectThreshold, scaleCvThreshold };
}

/**
 * @param {string} slug
 */
export function getTrackingMetricsConfig(slug) {
  const raw = readConfigJson("trackingMetrics.json");
  const s = String(slug ?? "").trim().toLowerCase();
  const block = s && raw[s] && typeof raw[s] === "object" ? raw[s] : raw.default;
  if (block && typeof block === "object" && Array.isArray(block.metrics)) {
    return { metrics: block.metrics };
  }
  return { metrics: [] };
}

/**
 * @param {string} industry
 * @param {string} categoryKey
 */
export function categorySupportsProgressTracking(industry, categoryKey) {
  const raw = readConfigJson("trackingCategories.json");
  const ind = String(industry ?? "").trim().toLowerCase();
  const cat = String(categoryKey ?? "").trim().toLowerCase();
  /** @type {string[]} */
  let matchers = [];
  if (raw.matchersByIndustry && typeof raw.matchersByIndustry === "object" && Array.isArray(raw.matchersByIndustry[ind])) {
    matchers = raw.matchersByIndustry[ind];
  } else if (Array.isArray(raw.default)) {
    matchers = raw.default;
  }
  if (!matchers.length) return false;
  return matchers.some((m) => cat.includes(String(m).toLowerCase()));
}

/**
 * @param {{ industry?: string }} [input]
 */
export function getIndustryFeaturesApi(input = {}) {
  const industry = typeof input.industry === "string" ? input.industry.trim().toLowerCase() : "";
  return { ok: true, industry, features: getIndustryFeaturesForSlug(industry || "default") };
}

/**
 * @param {{ industry?: string }} [input]
 */
export function getTrackingConfigApi(input = {}) {
  const industry = typeof input.industry === "string" ? input.industry.trim().toLowerCase() : "";
  return {
    ok: true,
    industry,
    metrics: getTrackingMetricsConfig(industry).metrics,
    consistencyThresholds: resolveTrackingConsistencyConfig(industry),
    categoryMatchers:
      readConfigJson("trackingCategories.json").matchersByIndustry?.[industry] ??
      readConfigJson("trackingCategories.json").default ??
      [],
  };
}

/**
 * @param {{ industry?: string }} [input]
 */
export function listTrackingEntitiesApi(input = {}) {
  const industry = typeof input.industry === "string" ? input.industry.trim().toLowerCase() : "";
  return listTrackingEntities(industry);
}

/**
 * @param {{ name?: string, category?: string, industry?: string }} [input]
 */
export function createTrackingEntityApi(input = {}) {
  return createTrackingEntity({
    name: typeof input.name === "string" ? input.name : "",
    category: typeof input.category === "string" ? input.category : "",
    industry: typeof input.industry === "string" ? input.industry : "",
  });
}

/**
 * @param {{ entityId?: string, imageBase64?: string, manualMetrics?: Record<string, number>, categoryKey?: string, industrySlug?: string }} [input]
 */
export async function addTrackingSnapshotApi(input = {}) {
  return addTrackingSnapshot(String(input.entityId ?? ""), {
    imageBase64: typeof input.imageBase64 === "string" ? input.imageBase64 : undefined,
    manualMetrics:
      input.manualMetrics && typeof input.manualMetrics === "object" && !Array.isArray(input.manualMetrics)
        ? /** @type {Record<string, number>} */ (input.manualMetrics)
        : undefined,
    categoryKey: typeof input.categoryKey === "string" ? input.categoryKey : "",
    industrySlug: typeof input.industrySlug === "string" ? input.industrySlug : "",
  });
}

/**
 * @param {{ entityId?: string }} [input]
 */
export function listTrackingSnapshotsApi(input = {}) {
  return listSnapshotsForEntity(String(input.entityId ?? ""));
}

/**
 * @param {{ entityId?: string }} [input]
 */
export function getTrackingProgressApi(input = {}) {
  const entityId = String(input.entityId ?? "").trim();
  const ent = getTrackingEntity(entityId);
  if (!ent.ok) return { ok: false, error: ent.error, metrics: null };
  const snaps = listSnapshotsForEntity(entityId);
  if (!snaps.ok) return { ok: false, error: "Could not list snapshots.", metrics: null };
  const list = Array.isArray(snaps.snapshots) ? snaps.snapshots : [];
  const industry = String(/** @type {{ industry?: string }} */ (ent.entity)?.industry ?? "").toLowerCase();
  const consistency = resolveTrackingConsistencyConfig(industry);
  const metrics = computeProgressMetrics(/** @type {Record<string, unknown>[]} */ (list), consistency);
  return {
    ok: true,
    entity: ent.entity,
    snapshots: list,
    progress: metrics,
    interpretation: interpretationForIndustry(industry),
  };
}

/**
 * @param {{ industry?: string, categoryKey?: string }} [input]
 */
export function categoryTrackingSupportApi(input = {}) {
  const industry = typeof input.industry === "string" ? input.industry.trim().toLowerCase() : "";
  const categoryKey = typeof input.categoryKey === "string" ? input.categoryKey.trim() : "";
  return {
    ok: true,
    supports: categorySupportsProgressTracking(industry, categoryKey),
  };
}

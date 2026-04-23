/**
 * wellnessMetrics.js
 *
 * Structured metrics for Business Analyzer weightloss intent — presets, units,
 * and helpers to map metrics ↔ pipeline entities (stable entityId per row).
 *
 * @typedef {{
 *   entityId: string,
 *   preset: string,
 *   name: string,
 *   unit: string,
 *   value: string,
 * }} WellnessMetricRow
 */

/** @typedef {{ key: string, name: string, defaultUnit: string }} WellnessPreset */

/** @type {WellnessPreset[]} */
export const WELLNESS_METRIC_PRESETS = [
  { key: "body-weight", name: "Body weight", defaultUnit: "lbs" },
  { key: "sleep", name: "Sleep", defaultUnit: "hours" },
  { key: "meals", name: "Meals", defaultUnit: "score" },
  { key: "snacks", name: "Snacks", defaultUnit: "score" },
];

/** Built-in units shown first in the selector; any other string is stored as custom. */
export const WELLNESS_STANDARD_UNITS = ["lbs", "kg", "hours", "score"];

/**
 * @returns {string}
 */
export function newMetricEntityId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {string} presetKey
 * @returns {WellnessPreset | undefined}
 */
export function getPresetByKey(presetKey) {
  return WELLNESS_METRIC_PRESETS.find((p) => p.key === presetKey);
}

/**
 * @param {string} unit
 * @returns {boolean}
 */
export function isStandardUnit(unit) {
  return WELLNESS_STANDARD_UNITS.includes(String(unit ?? "").trim());
}

/**
 * @returns {WellnessMetricRow}
 */
export function createDefaultMetricRow() {
  const p = WELLNESS_METRIC_PRESETS[0];
  const id  = newMetricEntityId();
  return {
    entityId: id,
    preset:   p.key,
    name:     p.name,
    unit:     p.defaultUnit,
    value:    "",
  };
}

/**
 * @param {{
 *   entityId?: string,
 *   name: string,
 *   value?: number | null,
 *   unit?: string,
 *   preset?: string,
 * }} raw
 * @returns {WellnessMetricRow}
 */
export function normalizeLoadedMetric(raw) {
  const entityId = typeof raw.entityId === "string" && raw.entityId ? raw.entityId : newMetricEntityId();
  const name     = String(raw.name ?? "").trim() || "Metric";
  const unit     = String(raw.unit ?? "lbs").trim() || "lbs";
  const preset =
    WELLNESS_METRIC_PRESETS.some((p) => p.key === raw.preset) ? String(raw.preset) : "custom";
  const v = raw.value;
  const value =
    v != null && v !== "" && Number.isFinite(Number(v)) ? String(Number(v)) : "";
  return { entityId, preset, name, unit, value };
}

/**
 * @param {string} label
 * @returns {{ name: string, unit: string | null }}
 */
export function parseLegacyEntityLabel(label) {
  const s = String(label ?? "").trim();
  const m = s.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    return { name: m[1].trim(), unit: m[2].trim() || null };
  }
  return { name: s, unit: null };
}

/**
 * Build pipeline entities from structured metric rows.
 *
 * @param {Array<{ entityId: string, name: string, unit: string }>} metrics
 * @returns {Array<{ entityId: string, label: string }>}
 */
export function entitiesFromWellnessMetrics(metrics) {
  /** @type {Array<{ entityId: string, label: string }>} */
  const out = [];
  for (const m of metrics ?? []) {
    const name = String(m.name ?? "").trim();
    if (!name || !m.entityId) continue;
    const unit = String(m.unit ?? "").trim();
    const label = unit ? `${name} (${unit})` : name;
    out.push({ entityId: m.entityId, label });
  }
  return out;
}

/**
 * Initialize form metric rows from a saved dataset (metrics array or legacy entities).
 *
 * @param {import("./datasetStore.js").Dataset} init
 * @returns {import("./wellnessMetrics.js").WellnessMetricRow[]}
 */
export function initWellnessMetricsFromDataset(init) {
  if (Array.isArray(init.metrics) && init.metrics.length > 0) {
    return init.metrics.map((r) => normalizeLoadedMetric(r));
  }
  if (init.intent === "weightloss" && Array.isArray(init.entities) && init.entities.length > 0) {
    return init.entities.map((e) => {
      const { name, unit } = parseLegacyEntityLabel(e.label);
      return {
        entityId: e.entityId,
        preset:   "custom",
        name:     name || e.label,
        unit:     unit ?? "lbs",
        value:    "",
      };
    });
  }
  if (init.intent === "weightloss") {
    return [createDefaultMetricRow()];
  }
  return [];
}

/**
 * Merge Items-step metric values into state values (entityId-keyed) for snapshots.
 *
 * @param {WellnessMetricRow[]} metrics
 * @param {{ [entityId: string]: string | number }} stateValues
 * @returns {{ [entityId: string]: string | number }}
 */
export function resolveWellnessStateValues(metrics, stateValues) {
  const sv = { ...stateValues };
  for (const m of metrics ?? []) {
    if (!m.entityId) continue;
    if (sv[m.entityId] === undefined || sv[m.entityId] === "") {
      const v = m.value;
      if (v !== "" && v != null && Number.isFinite(Number(v))) {
        sv[m.entityId] = Number(v);
      }
    }
  }
  return sv;
}

/**
 * @param {WellnessMetricRow[]} rows
 * @param {{ [entityId: string]: string | number }} stateValues
 * @returns {Array<{ entityId: string, name: string, unit: string, value: number | null }>}
 */
export function serializeWellnessMetricsForStore(rows, stateValues) {
  return (rows ?? [])
    .filter((m) => m.name?.trim() && m.entityId)
    .map((m) => {
      const raw = stateValues[m.entityId] ?? m.value;
      const num = raw === "" || raw == null ? null : Number(raw);
      return {
        entityId: m.entityId,
        name:     String(m.name).trim(),
        unit:     String(m.unit ?? "lbs").trim() || "lbs",
        value:    Number.isFinite(num) ? num : null,
      };
    });
}

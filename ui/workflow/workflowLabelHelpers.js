/**
 * Template-driven labels — requires a validated workflow_template moduleOptions shape (no fallbacks).
 */

/**
 * @param {Record<string, unknown>} moduleOptions
 * @returns {{ singular: string, plural: string }}
 */
export function getEntityTypeLabels(moduleOptions) {
  const et = moduleOptions?.entity_tracking;
  if (!et || typeof et !== "object" || Array.isArray(et)) {
    throw new Error("getEntityTypeLabels: moduleOptions.entity_tracking is missing or invalid");
  }
  const labels = /** @type {Record<string, unknown>} */ (et).labels;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    throw new Error("getEntityTypeLabels: moduleOptions.entity_tracking.labels is missing or invalid");
  }
  const lo = /** @type {Record<string, unknown>} */ (labels);
  if (typeof lo.singular !== "string" || !lo.singular.trim()) {
    throw new Error("getEntityTypeLabels: labels.singular must be a non-empty string");
  }
  if (typeof lo.plural !== "string" || !lo.plural.trim()) {
    throw new Error("getEntityTypeLabels: labels.plural must be a non-empty string");
  }
  return { singular: lo.singular.trim(), plural: lo.plural.trim() };
}

/**
 * @param {Record<string, unknown>} moduleOptions
 */
export function getWorkflowSectionTitles(moduleOptions) {
  const ui = moduleOptions?.uiSections;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) {
    throw new Error("getWorkflowSectionTitles: moduleOptions.uiSections is missing or invalid");
  }
  const u = /** @type {Record<string, unknown>} */ (ui);
  /** @type {{ entities: string, activity: string, addData: string }} */
  const out = { entities: "", activity: "", addData: "" };
  for (const key of ["entities", "activity", "addData"]) {
    if (typeof u[key] !== "string" || !u[key].trim()) {
      throw new Error(`getWorkflowSectionTitles: moduleOptions.uiSections.${key} must be a non-empty string`);
    }
    out[/** @type {"entities" | "activity" | "addData"} */ (key)] = u[key].trim();
  }
  return out;
}

/**
 * @param {string[]} moduleIds
 * @param {Record<string, unknown>} moduleOptions
 * @returns {string}
 */
export function formatModuleListForHub(moduleIds, moduleOptions) {
  if (!Array.isArray(moduleIds) || moduleIds.length === 0) {
    throw new Error("formatModuleListForHub: modules must be a non-empty array");
  }
  const ml = moduleOptions?.moduleLabels;
  if (!ml || typeof ml !== "object" || Array.isArray(ml)) {
    throw new Error("formatModuleListForHub: moduleOptions.moduleLabels is missing or invalid");
  }
  const mlo = /** @type {Record<string, unknown>} */ (ml);
  return moduleIds
    .map((id) => {
      const k = String(id).trim();
      const v = mlo[k];
      if (typeof v !== "string" || !v.trim()) {
        throw new Error(`formatModuleListForHub: moduleOptions.moduleLabels["${k}"] must be a non-empty string`);
      }
      return v.trim();
    })
    .join(" · ");
}

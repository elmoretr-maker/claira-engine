/**
 * Strict workflow_template.json contract — pure validation (no fs).
 * Module IDs are defined in workflow/modules/moduleRegistry.js (single source of truth).
 */

import { REGISTERED_WORKFLOW_MODULE_IDS } from "../modules/moduleRegistry.js";

export { REGISTERED_WORKFLOW_MODULE_IDS };

const REGISTERED = new Set(REGISTERED_WORKFLOW_MODULE_IDS);

/**
 * @param {unknown} template
 * @param {string} [sourceHint] — e.g. "packs/game-dev/workflow_template.json"
 */
export function assertWorkflowTemplateContract(template, sourceHint = "workflow_template.json") {
  const src = sourceHint || "workflow_template.json";

  if (template == null || typeof template !== "object" || Array.isArray(template)) {
    throw new Error(`${src}: root must be a non-null object`);
  }

  const t = /** @type {Record<string, unknown>} */ (template);

  if (typeof t.templateId !== "string" || !t.templateId.trim()) {
    throw new Error(`${src}: missing required non-empty string field: templateId`);
  }

  if (typeof t.label !== "string" || !t.label.trim()) {
    throw new Error(`${src}: missing required non-empty string field: label`);
  }

  if (!Array.isArray(t.modules) || t.modules.length === 0) {
    throw new Error(`${src}: missing required non-empty array field: modules`);
  }

  const modules = t.modules.map((x, i) => {
    if (typeof x !== "string" || !x.trim()) {
      throw new Error(`${src}: modules[${i}] must be a non-empty string`);
    }
    return x.trim();
  });

  for (const mid of modules) {
    if (!REGISTERED.has(mid)) {
      throw new Error(
        `${src}: unknown module "${mid}". Registered modules: ${REGISTERED_WORKFLOW_MODULE_IDS.join(", ")}`,
      );
    }
  }

  const needsEntities = modules.some((m) => m === "asset_registry" || m === "event_log");
  if (needsEntities && !modules.includes("entity_tracking")) {
    throw new Error(
      `${src}: modules must include "entity_tracking" when "asset_registry" or "event_log" is present`,
    );
  }

  if (
    t.moduleOptions == null ||
    typeof t.moduleOptions !== "object" ||
    Array.isArray(t.moduleOptions)
  ) {
    throw new Error(`${src}: missing required object field: moduleOptions`);
  }

  const mo = /** @type {Record<string, unknown>} */ (t.moduleOptions);

  if (modules.includes("entity_tracking")) {
    const et = mo.entity_tracking;
    if (et == null || typeof et !== "object" || Array.isArray(et)) {
      throw new Error(`${src}: moduleOptions.entity_tracking must be a non-null object (required when entity_tracking is listed in modules)`);
    }
    const eto = /** @type {Record<string, unknown>} */ (et);
    const labels = eto.labels;
    if (labels == null || typeof labels !== "object" || Array.isArray(labels)) {
      throw new Error(`${src}: moduleOptions.entity_tracking.labels must be a non-null object`);
    }
    const lo = /** @type {Record<string, unknown>} */ (labels);
    if (typeof lo.singular !== "string" || !lo.singular.trim()) {
      throw new Error(`${src}: moduleOptions.entity_tracking.labels.singular must be a non-empty string`);
    }
    if (typeof lo.plural !== "string" || !lo.plural.trim()) {
      throw new Error(`${src}: moduleOptions.entity_tracking.labels.plural must be a non-empty string`);
    }
  }

  const ui = mo.uiSections;
  if (ui == null || typeof ui !== "object" || Array.isArray(ui)) {
    throw new Error(`${src}: moduleOptions.uiSections must be a non-null object`);
  }
  const uio = /** @type {Record<string, unknown>} */ (ui);
  for (const key of ["entities", "activity", "addData"]) {
    if (typeof uio[key] !== "string" || !uio[key].trim()) {
      throw new Error(`${src}: moduleOptions.uiSections.${key} must be a non-empty string`);
    }
  }

  const ml = mo.moduleLabels;
  if (ml == null || typeof ml !== "object" || Array.isArray(ml)) {
    throw new Error(`${src}: moduleOptions.moduleLabels must be a non-null object`);
  }
  const mlo = /** @type {Record<string, unknown>} */ (ml);
  for (const mid of modules) {
    const v = mlo[mid];
    if (typeof v !== "string" || !v.trim()) {
      throw new Error(`${src}: moduleOptions.moduleLabels must include a non-empty string for module "${mid}"`);
    }
  }
}

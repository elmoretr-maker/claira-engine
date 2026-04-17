/**
 * Central workflow module rules — UI + API + composition (single source of truth).
 * Labels and copy used for templates are derived only AFTER module selection (see composeWorkflowFromUserSelection).
 */

import { REGISTERED_WORKFLOW_MODULE_IDS } from "../modules/moduleRegistry.js";
import { MODULE_PUBLIC_COPY } from "../moduleMapping/modulePublicCopy.js";

/** Stable order for checklists and persisted template membership. */
export const MODULE_SELECTION_ORDER = [...REGISTERED_WORKFLOW_MODULE_IDS];

const registered = new Set(REGISTERED_WORKFLOW_MODULE_IDS);

export const WORKFLOW_RULE_MESSAGES = {
  EMPTY_SELECTION: "Select at least one module before continuing.",
  UNKNOWN_MODULE: (id) => `Unknown module: ${id}`,
  /** Explicit dependency — never auto-fixed; user must add Entity Tracking or remove dependents. */
  ENTITY_REQUIRED_FOR_ASSET_OR_EVENT:
    "Event Log and Asset Registry require Entity Tracking. Add Entity Tracking, or remove those modules.",
};

export const CLARIFICATION_INTRO = "Help us understand your system:";

/** Structured options: each maps 1:1 to a module id (no vague prompts). */
export const CLARIFICATION_OPTIONS = MODULE_SELECTION_ORDER.map((moduleId) => {
  const meta = MODULE_PUBLIC_COPY[moduleId];
  const shortLabel =
    moduleId === "entity_tracking"
      ? "Track people (clients, users, members, patients)"
      : moduleId === "event_log"
        ? "Track activity over time (progress, history, sessions)"
        : moduleId === "asset_registry"
          ? "Upload or store files (images, documents, scans)"
          : moduleId;
  return {
    moduleId,
    shortLabel,
    description: meta?.description ?? "",
    title: meta?.title ?? moduleId,
  };
});

/**
 * @param {unknown} selected
 * @returns {string | null} error message, or null if valid
 */
export function validateWorkflowModuleSelection(selected) {
  if (!Array.isArray(selected) || selected.length === 0) {
    return WORKFLOW_RULE_MESSAGES.EMPTY_SELECTION;
  }
  const ids = [...new Set(selected.map((x) => String(x ?? "").trim()).filter(Boolean))];
  for (const id of ids) {
    if (!registered.has(id)) {
      return WORKFLOW_RULE_MESSAGES.UNKNOWN_MODULE(id);
    }
  }
  const set = new Set(ids);
  if ((set.has("asset_registry") || set.has("event_log")) && !set.has("entity_tracking")) {
    return WORKFLOW_RULE_MESSAGES.ENTITY_REQUIRED_FOR_ASSET_OR_EVENT;
  }
  return null;
}

/**
 * @param {string[]} selected
 * @returns {string[]}
 */
export function orderSelectedModulesForTemplate(selected) {
  const set = new Set(selected.map((x) => String(x ?? "").trim()).filter(Boolean));
  return MODULE_SELECTION_ORDER.filter((id) => set.has(id));
}

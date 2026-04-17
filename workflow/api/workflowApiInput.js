/**
 * Phase 3 — API input boundary: external payloads → workflow state via module dispatches only.
 * No bypass of the module system; pipeline configuration is validated before execution.
 */

import {
  MODULE_SELECTION_ORDER,
  orderSelectedModulesForTemplate,
  validateWorkflowModuleSelection,
} from "../contracts/workflowRules.js";
import { validatePipelineConfiguration } from "../pipeline/validatePipelineConfiguration.js";
import { dispatchModuleRuntime } from "../state/workflowBuildState.js";
import { executeWorkflow } from "../execution/workflowExecutor.js";

/**
 * @typedef {{
 *   userSelections: string[],
 *   data?: {
 *     entities?: Array<{ id: string, label?: string }>,
 *     assets?: Array<{ id: string, ref: string, name?: string }>,
 *     events?: Array<{ id: string, label: string, at?: number, entityId?: string }>,
 *     fileRefs?: Array<{ id: string, path: string, name?: string }>,
 *   },
 * }} ExternalWorkflowInput
 */

/**
 * @typedef {{
 *   ok: false,
 *   code: string,
 *   message: string,
 *   pipelineValidation?: { ok: boolean, errors: unknown[] },
 * }} WorkflowInputRejected
 */

/**
 * @typedef {{
 *   ok: true,
 *   state: Record<string, unknown>,
 * }} WorkflowInputAccepted
 */

/**
 * Ordered module ids for the given selection (same order as execution).
 * @param {string[]} userSelections
 * @returns {string[]}
 */
function orderedPipelineModuleIds(userSelections) {
  const selected = new Set(userSelections.map((x) => String(x ?? "").trim()).filter(Boolean));
  return MODULE_SELECTION_ORDER.filter((id) => selected.has(id));
}

/**
 * Validates pipeline at API entry (before any dispatch). Matches executeWorkflow preconditions.
 * @param {string[]} orderedModuleIds
 */
export function validatePipelineAtApiEntry(orderedModuleIds) {
  return validatePipelineConfiguration({ orderedModuleIds });
}

/**
 * Applies external data only through registered module reducers.
 * @param {Record<string, unknown>} baseState — must include `moduleRuntimeState` (e.g. from createInitialWorkflowBuildState)
 * @param {ExternalWorkflowInput | unknown} externalInput
 * @returns {WorkflowInputRejected | WorkflowInputAccepted}
 */
export function buildWorkflowStateFromExternalInput(baseState, externalInput) {
  if (externalInput == null || typeof externalInput !== "object" || Array.isArray(externalInput)) {
    return { ok: false, code: "API_INPUT_SHAPE", message: "External input must be a non-null object." };
  }
  const raw = /** @type {Record<string, unknown>} */ (externalInput);
  const userSelections = Array.isArray(raw.userSelections)
    ? raw.userSelections.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];

  const selErr = validateWorkflowModuleSelection(userSelections);
  if (selErr) {
    return { ok: false, code: "API_MODULE_SELECTION", message: selErr };
  }

  const order = orderedPipelineModuleIds(userSelections);
  const pipelineValidation = validatePipelineConfiguration({ orderedModuleIds: order });
  if (!pipelineValidation.ok) {
    return {
      ok: false,
      code: "API_PIPELINE_INVALID",
      message: "Pipeline configuration is invalid for the requested module selection.",
      pipelineValidation,
    };
  }

  const selected = new Set(order);
  const data = raw.data != null && typeof raw.data === "object" && !Array.isArray(raw.data) ? raw.data : {};
  const d = /** @type {Record<string, unknown>} */ (data);

  const entities = Array.isArray(d.entities) ? d.entities : [];
  const assets = Array.isArray(d.assets) ? d.assets : [];
  const events = Array.isArray(d.events) ? d.events : [];
  const fileRefs = Array.isArray(d.fileRefs) ? d.fileRefs : [];

  if (entities.length && !selected.has("entity_tracking")) {
    return {
      ok: false,
      code: "API_INJECTION_MODULE_NOT_IN_PIPELINE",
      message: 'Entity data was provided but "entity_tracking" is not in the pipeline selection.',
    };
  }
  if ((assets.length || fileRefs.length) && !selected.has("asset_registry")) {
    return {
      ok: false,
      code: "API_INJECTION_MODULE_NOT_IN_PIPELINE",
      message: 'Asset data was provided but "asset_registry" is not in the pipeline selection.',
    };
  }
  if (events.length && !selected.has("event_log")) {
    return {
      ok: false,
      code: "API_INJECTION_MODULE_NOT_IN_PIPELINE",
      message: 'Event data was provided but "event_log" is not in the pipeline selection.',
    };
  }

  /** @type {Set<string>} */
  const injectedEntityIds = new Set();

  let state = /** @type {Record<string, unknown>} */ ({ ...baseState, userSelections: orderSelectedModulesForTemplate(userSelections) });

  for (const row of entities) {
    if (row == null || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, code: "API_ENTITY_SHAPE", message: "Each entity entry must be an object with id." };
    }
    const id = String(/** @type {{ id?: unknown }} */ (row).id ?? "").trim();
    if (!id) {
      return { ok: false, code: "API_ENTITY_ID_REQUIRED", message: "Each entity must include a non-empty id." };
    }
    const label = /** @type {{ label?: unknown }} */ (row).label;
    state = dispatchModuleRuntime(state, "entity_tracking", "add", {
      id,
      ...(typeof label === "string" ? { label } : {}),
    });
    injectedEntityIds.add(id);
  }

  for (const row of assets) {
    if (row == null || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, code: "API_ASSET_SHAPE", message: "Each asset entry must be an object with id and ref." };
    }
    const id = String(/** @type {{ id?: unknown }} */ (row).id ?? "").trim();
    const ref = String(/** @type {{ ref?: unknown }} */ (row).ref ?? "").trim();
    if (!id || !ref) {
      return { ok: false, code: "API_ASSET_FIELDS", message: "Each asset must include non-empty id and ref." };
    }
    const name = /** @type {{ name?: unknown }} */ (row).name;
    state = dispatchModuleRuntime(state, "asset_registry", "add", {
      id,
      ref,
      ...(typeof name === "string" ? { name } : {}),
    });
  }

  for (const row of fileRefs) {
    if (row == null || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, code: "API_FILEREF_SHAPE", message: "Each fileRefs entry must be an object with id and path." };
    }
    const id = String(/** @type {{ id?: unknown }} */ (row).id ?? "").trim();
    const path = String(/** @type {{ path?: unknown }} */ (row).path ?? "").trim();
    if (!id || !path) {
      return { ok: false, code: "API_FILEREF_FIELDS", message: "Each fileRefs entry must include non-empty id and path (mapped to asset ref)." };
    }
    const name = /** @type {{ name?: unknown }} */ (row).name;
    state = dispatchModuleRuntime(state, "asset_registry", "add", {
      id,
      ref: path,
      ...(typeof name === "string" ? { name } : {}),
    });
  }

  for (const row of events) {
    if (row == null || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, code: "API_EVENT_SHAPE", message: "Each event entry must be an object with id and label." };
    }
    const id = String(/** @type {{ id?: unknown }} */ (row).id ?? "").trim();
    const label = String(/** @type {{ label?: unknown }} */ (row).label ?? "").trim();
    if (!id || !label) {
      return { ok: false, code: "API_EVENT_FIELDS", message: "Each event must include non-empty id and label." };
    }
    const at = /** @type {{ at?: unknown }} */ (row).at;
    const entityIdRaw = /** @type {{ entityId?: unknown }} */ (row).entityId;
    const entityId = entityIdRaw != null ? String(entityIdRaw).trim() : "";
    if (entityId && !injectedEntityIds.has(entityId)) {
      return {
        ok: false,
        code: "API_EVENT_ENTITY_UNKNOWN",
        message: `Event references entityId "${entityId}" which was not established by injected entities in this request.`,
      };
    }
    state = dispatchModuleRuntime(state, "event_log", "add", {
      id,
      label,
      ...(typeof at === "number" && Number.isFinite(at) ? { at } : {}),
      ...(entityId ? { entityId } : {}),
    });
  }

  return { ok: true, state };
}

/**
 * End-to-end: validate → build state from external input → executeWorkflow (which validates again internally).
 * @param {Record<string, unknown>} baseState
 * @param {ExternalWorkflowInput | unknown} externalInput
 * @returns {{
 *   ok: boolean,
 *   build?: WorkflowInputAccepted,
 *   reject?: WorkflowInputRejected,
 *   execution: Awaited<ReturnType<typeof executeWorkflow>>,
 * }}
 */
export async function runWorkflowFromExternalInput(baseState, externalInput) {
  const built = buildWorkflowStateFromExternalInput(baseState, externalInput);
  if (!built.ok) {
    /** @type {{ ok: false, errors: Array<{ code: string, message: string, detail?: Record<string, unknown> }> }} */
    const pipelineValidation =
      "pipelineValidation" in built && built.pipelineValidation != null
        ? /** @type {{ ok: false, errors: Array<{ code: string, message: string, detail?: Record<string, unknown> }> }} */ (
            built.pipelineValidation
          )
        : {
            ok: false,
            errors: [
              {
                code: built.code,
                message: built.message,
                detail: {},
              },
            ],
          };
    return {
      ok: false,
      reject: built,
      execution: {
        results: {},
        executionTrace: [],
        pipelineValidation,
        pipelineContext: undefined,
      },
    };
  }

  const execution = await executeWorkflow(built.state);
  const pipelineOk = execution.pipelineValidation?.ok === true;
  return {
    ok: pipelineOk,
    build: built,
    execution,
  };
}

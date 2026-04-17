/**
 * Workflow execution engine — deterministic module orchestration.
 * State remains the single source of truth; writes only via dispatch.
 *
 * Modules define capability. Execution defines behavior.
 */

import { MODULE_SELECTION_ORDER } from "../contracts/workflowRules.js";
import { MODULE_REGISTRY, createInitialModuleRuntimeState } from "../modules/moduleRegistry.js";
import { dispatchModuleRuntime } from "../state/workflowBuildState.js";
import { validatePipelineConfiguration } from "../pipeline/validatePipelineConfiguration.js";
import {
  appendDeclaredProduces,
  createEmptyPipelineArtifactStore,
  recordEntityIdsFromRuntime,
} from "../pipeline/pipelineArtifactStore.js";

/** Bump when execution context shape or semantics change; modules must match via expectedContextVersion. */
export const EXECUTION_CONTEXT_VERSION = 2;

/**
 * @typedef {{
 *   artifactStore: import("../pipeline/pipelineArtifactStore.js").PipelineArtifactStore,
 * }} PipelineExecutionContext
 */

/**
 * @typedef {{
 *   version: number,
 *   state: Record<string, unknown>,
 *   moduleState: unknown,
 *   getModule: (id: string) => unknown,
 *   getState: () => Record<string, unknown>,
 *   dispatch: (moduleId: string, reducerKey: string, payload: unknown) => Record<string, unknown>,
 *   getPipelineContext: () => PipelineExecutionContext,
 *   getPipelineArtifactStore: () => import("../pipeline/pipelineArtifactStore.js").PipelineArtifactStore,
 * }} WorkflowExecuteContext
 */

/**
 * @typedef {{
 *   status: "ok" | "error",
 *   data: Record<string, unknown>,
 *   errors: string[],
 * }} ModuleExecuteResultEntry
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function normalizeExecuteData(value) {
  if (value == null) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ ({ ...value });
  }
  return { value };
}

/**
 * Runs selected modules in MODULE_SELECTION_ORDER. Does not mutate the input state object;
 * builds an internal working copy so dispatch can evolve module runtime slices.
 *
 * @param {Record<string, unknown>} state — workflow state with userSelections + moduleRuntimeState
 * @returns {Promise<{
 *   results: Record<string, ModuleExecuteResultEntry>,
 *   executionTrace: Array<{ moduleId: string, status: "ok" | "error" | "skipped", timestamp: number }>,
 *   pipelineValidation: { ok: boolean, errors: Array<{ code: string, message: string, detail?: Record<string, unknown> }> },
 *   pipelineContext: PipelineExecutionContext | undefined,
 * }>}
 */
export async function executeWorkflow(state) {
  const selected = new Set(
    Array.isArray(state?.userSelections) ? state.userSelections.map((x) => String(x ?? "").trim()).filter(Boolean) : [],
  );

  const order = MODULE_SELECTION_ORDER.filter((id) => selected.has(id));

  const pipelineValidation = validatePipelineConfiguration({ orderedModuleIds: order });
  if (!pipelineValidation.ok) {
    return {
      results: {},
      executionTrace: [],
      pipelineValidation: { ok: false, errors: pipelineValidation.errors },
      pipelineContext: undefined,
    };
  }

  /** @type {PipelineExecutionContext} */
  const pipelineContext = {
    artifactStore: createEmptyPipelineArtifactStore(),
  };

  /** @type {Record<string, ModuleExecuteResultEntry>} */
  const results = {};

  /** @type {Array<{ moduleId: string, status: "ok" | "error" | "skipped", timestamp: number }>} */
  const executionTrace = [];

  let working = /** @type {Record<string, unknown>} */ ({
    ...state,
    moduleRuntimeState:
      state?.moduleRuntimeState != null && typeof state.moduleRuntimeState === "object"
        ? state.moduleRuntimeState
        : createInitialModuleRuntimeState(),
    pipelineContext,
  });

  for (const moduleId of order) {
    const ts = Date.now();
    const mod = MODULE_REGISTRY[moduleId];
    if (!mod) {
      results[moduleId] = { status: "error", data: {}, errors: [`Unknown module: ${moduleId}`] };
      executionTrace.push({ moduleId, status: "error", timestamp: ts });
    } else if (typeof mod.execute !== "function") {
      results[moduleId] = {
        status: "ok",
        data: { skipped: true, reason: "no_execute_handler" },
        errors: [],
      };
      executionTrace.push({ moduleId, status: "skipped", timestamp: ts });
    } else if (mod.expectedContextVersion !== EXECUTION_CONTEXT_VERSION) {
      results[moduleId] = {
        status: "error",
        data: {},
        errors: [
          `Execution context version mismatch: engine ${EXECUTION_CONTEXT_VERSION}, module ${moduleId} expects ${String(mod.expectedContextVersion)}`,
        ],
      };
      executionTrace.push({ moduleId, status: "error", timestamp: ts });
    } else {
      /** @type {WorkflowExecuteContext} */
      const context = {
        version: EXECUTION_CONTEXT_VERSION,
        get state() {
          return working;
        },
        get moduleState() {
          return working.moduleRuntimeState?.[moduleId];
        },
        getModule: (id) => MODULE_REGISTRY[id],
        getState: () => working,
        getPipelineContext: () => pipelineContext,
        getPipelineArtifactStore: () => pipelineContext.artifactStore,
        dispatch: (mid, reducerKey, payload) => {
          working = /** @type {Record<string, unknown>} */ (
            dispatchModuleRuntime(/** @type {*} */ (working), mid, reducerKey, payload)
          );
          return working;
        },
      };

      try {
        let out = mod.execute(context);
        if (out != null && typeof /** @type {{ then?: unknown }} */ (out).then === "function") {
          out = await /** @type {Promise<unknown>} */ (out);
        }
        results[moduleId] = {
          status: "ok",
          data: normalizeExecuteData(out),
          errors: [],
        };
        executionTrace.push({ moduleId, status: "ok", timestamp: ts });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results[moduleId] = {
          status: "error",
          data: {},
          errors: [msg],
        };
        executionTrace.push({ moduleId, status: "error", timestamp: ts });
      }
    }

    if (mod) {
      appendDeclaredProduces(pipelineContext.artifactStore, moduleId, mod.produces);
      recordEntityIdsFromRuntime(
        pipelineContext.artifactStore,
        working.moduleRuntimeState != null && typeof working.moduleRuntimeState === "object"
          ? working.moduleRuntimeState
          : {},
      );
    }
  }

  return {
    results,
    executionTrace,
    pipelineValidation: { ok: true, errors: [] },
    pipelineContext,
  };
}

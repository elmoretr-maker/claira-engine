/**
 * Output Switch — post-pipeline routing layer.
 *
 * Applies AFTER executeWorkflow completes. Does NOT modify the execution result.
 * Routes the execution output to either:
 *   - "external" → serialisable JSON payload for API consumers / Wix / integrations
 *   - "internal" → pass-through reference for the embedded UI presentation path
 *
 * This is a pure routing concern; no business logic, no module modification.
 */

import { executeWorkflow } from "../execution/workflowExecutor.js";
import { INTERNAL_UI_WIDGET_ORDER_BY_MODULE } from "./internalUiRouteMeta.js";

/**
 * @typedef {"external" | "internal"} OutputMode
 */

/**
 * @typedef {{
 *   version: number,
 *   ok: boolean,
 *   declaredArtifactTrace: import("../pipeline/pipelineArtifactStore.js").PipelineArtifactRecord[],
 *   knownEntityIds: string[],
 *   moduleResults: Record<string, unknown>,
 * }} ExternalOutputPayload
 */

/**
 * @typedef {{
 *   execution: Awaited<ReturnType<typeof executeWorkflow>>,
 *   presentation: {
 *     orderedModuleIds: string[],
 *     widgetsByModule: Record<string, string[]>,
 *   },
 * }} InternalOutputPayload
 */

/**
 * @typedef {{
 *   destination: OutputMode,
 *   outputMode: OutputMode,
 *   payload: ExternalOutputPayload | InternalOutputPayload,
 * }} OutputSwitchResult
 */

/**
 * Apply the output switch to a completed workflow execution.
 *
 * @param {Awaited<ReturnType<typeof executeWorkflow>>} execution
 * @param {{ outputMode?: string }} [options]
 * @returns {OutputSwitchResult}
 */
export function applyOutputSwitch(execution, options = {}) {
  const mode = /** @type {OutputMode} */ (
    options?.outputMode === "internal" ? "internal" : "external"
  );

  if (mode === "internal") {
    const orderedModuleIds = (execution.executionTrace ?? []).map((t) => t.moduleId);
    /** @type {Record<string, string[]>} */
    const widgetsByModule = {};
    for (const moduleId of orderedModuleIds) {
      widgetsByModule[moduleId] = [...(INTERNAL_UI_WIDGET_ORDER_BY_MODULE[moduleId] ?? [])];
    }
    return {
      destination: "internal",
      outputMode: "internal",
      payload: {
        execution,
        presentation: {
          orderedModuleIds,
          widgetsByModule,
        },
      },
    };
  }

  // External — serialisable snapshot
  const artifactStore = execution.pipelineContext?.artifactStore;
  /** @type {ExternalOutputPayload} */
  const payload = {
    version: 1,
    ok: execution.pipelineValidation?.ok === true,
    declaredArtifactTrace: artifactStore?.records ? [...artifactStore.records] : [],
    knownEntityIds: artifactStore?.knownEntityIds ? [...artifactStore.knownEntityIds] : [],
    moduleResults: execution.results ?? {},
  };

  return {
    destination: "external",
    outputMode: "external",
    payload,
  };
}

/**
 * Convenience wrapper: runs the workflow and immediately applies the output switch.
 *
 * @param {Record<string, unknown>} state
 * @param {{ outputMode?: string }} [options]
 * @returns {Promise<{ execution: Awaited<ReturnType<typeof executeWorkflow>>, output: OutputSwitchResult }>}
 */
export async function runWorkflowWithOutputSwitch(state, options = {}) {
  const execution = await executeWorkflow(state);
  const output = applyOutputSwitch(execution, options);
  return { execution, output };
}

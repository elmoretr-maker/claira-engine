/**
 * Workflow runner — executes an ordered list of module steps as a single run.
 *
 * This is Phase 5 of the module orchestration system (plan.md §§2, 4, 5).
 * It is distinct from workflowExecutor.js, which runs the legacy execute(context)
 * pipeline. Both files coexist; this one must NEVER modify the other.
 *
 * ── Responsibilities ─────────────────────────────────────────────────────────
 *   - Drive executeModuleStep for each module in the provided order.
 *   - Share one artifact store and one context (sessionId + workflowRunId)
 *     across every step in the run.
 *   - Stop immediately on the first module failure (fail-fast).
 *   - Return a per-step result record regardless of success or failure.
 *
 * ── What this file does NOT do ───────────────────────────────────────────────
 *   - Does NOT sort or reorder modules. The caller provides the final order.
 *     Ordering logic (artifact dependency graph + topological sort) is Phase 6.
 *   - Does NOT validate ordering. Any ordering-related failures surface as
 *     "missing required artifact" errors from assertArtifactsAvailable inside
 *     executeModuleStep.
 *   - Does NOT persist results to disk. Persistence is Phase 7/8.
 *   - Does NOT touch workflowExecutor.js or any legacy module.
 *
 * ── Execution model ──────────────────────────────────────────────────────────
 *
 *   executeWorkflow(moduleList, context)
 *        │
 *        ├─ expandToSteps(moduleList) → stepList  (each module → { module, stepId, stepIndex })
 *        │
 *        ├─ create one RuntimeArtifactStore for the run
 *        │
 *        ├─ for each step in stepList (in provided order):
 *        │       executeModuleStep(module, store, { ...context, stepId, stepIndex })
 *        │           → success: collect WorkflowStepResult, continue
 *        │           → failure: record error, STOP (fail-fast)
 *        │
 *        └─ return WorkflowRunResult
 *               status:        "ok" | "failed"
 *               failedAt:      stepId of first failure, or null
 *               steps:         WorkflowStepResult[]  (one per attempted step)
 *               artifactStore  (the live store — caller may inspect or persist)
 *
 * ── Context ──────────────────────────────────────────────────────────────────
 *   Same shape as ModuleStepContext (plan.md §2):
 *     sessionId       string         (required)
 *     workflowRunId   string         (required)
 *     accountId?      string | null
 *     rid?            string         — trace ID for the whole run
 *
 *   If workflowRunId is absent, the runner auto-generates one so the caller
 *   does not need to know the run ID before calling.
 *
 * ── Design notes (non-blocking, for future phases) ───────────────────────────
 *
 * NOTE A — "always resolves" requires caller discipline:
 *   executeWorkflow never throws. Callers must check result.status and decide
 *   whether to propagate the failure. If the Phase 8/9 API layer consistently
 *   needs throw semantics, add a thin wrapper:
 *
 *     async function executeWorkflowOrThrow(moduleList, ctx) {
 *       const result = await executeWorkflow(moduleList, ctx);
 *       if (result.status === "failed") {
 *         const err = new Error(`Workflow failed at module: ${result.failedAt}`);
 *         err.workflowResult = result;
 *         throw err;
 *       }
 *       return result;
 *     }
 *
 *   Keep this in workflowRunner.js or a thin api adapter — do NOT change
 *   executeWorkflow's signature. Phase 8.
 *
 * NOTE B — workflowRunId generation location:
 *   Currently generated inside the runner when absent. This is correct for
 *   isolated calls. When the Phase 8 API layer needs to expose the run ID
 *   to the UI before execution starts (e.g. for streaming status updates),
 *   the caller should generate the ID and pass it in explicitly. The runner's
 *   auto-generation fallback can remain as a convenience for tests and
 *   internal callers. No change needed until Phase 8 API design.
 */

import { createRuntimeArtifactStore } from "../pipeline/runtimeArtifactStore.js";
import { executeModuleStep } from "./moduleOrchestrator.js";
import { expandToSteps } from "./workflowOrdering.js";

// =============================================================================
// Typedefs
// =============================================================================

/**
 * @typedef {{
 *   sessionId:      string,
 *   workflowRunId?: string,
 *   accountId?:     string | null,
 *   rid?:           string,
 * }} WorkflowRunContext
 */

/**
 * @typedef {{
 *   stepId:            string,
 *   stepIndex:         number,
 *   moduleId:          string,
 *   status:            "ok" | "failed" | "skipped",
 *   producedArtifacts: import("../pipeline/runtimeArtifactStore.js").RuntimeArtifact[],
 *   engineResults:     Array<{ kind: string, result: unknown }>,
 *   error:             string | null,
 *   durationMs:        number,
 * }} WorkflowStepResult
 */

/**
 * @typedef {{
 *   status:        "ok" | "failed",
 *   sessionId:     string,
 *   workflowRunId: string,
 *   failedAt:      string | null,
 *   steps:         WorkflowStepResult[],
 *   artifactStore: import("../pipeline/runtimeArtifactStore.js").RuntimeArtifactStore,
 * }} WorkflowRunResult
 */

// =============================================================================
// Private helpers
// =============================================================================

/**
 * Generate a unique workflow run ID.
 *
 * @returns {string}
 */
function generateRunId() {
  const c = /** @type {{ randomUUID?: () => string }} */ (globalThis.crypto);
  if (c && typeof c.randomUUID === "function") {
    return `run_${c.randomUUID().slice(0, 8)}`;
  }
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Validate and normalize the workflow run context.
 * workflowRunId is auto-generated if absent.
 *
 * @param {unknown} context
 * @returns {{ sessionId: string, workflowRunId: string, accountId: string | null, rid: string | undefined }}
 * @throws {Error}
 */
function normalizeRunContext(context) {
  if (context == null || typeof context !== "object" || Array.isArray(context)) {
    throw new Error("[workflowRunner] context must be a non-null object");
  }
  const c = /** @type {Record<string, unknown>} */ (context);

  if (typeof c.sessionId !== "string" || !c.sessionId.trim()) {
    throw new Error(
      "[workflowRunner] context.sessionId must be a non-empty string",
    );
  }

  const workflowRunId =
    typeof c.workflowRunId === "string" && c.workflowRunId.trim()
      ? c.workflowRunId
      : generateRunId();

  return {
    sessionId:     c.sessionId,
    workflowRunId,
    accountId:     typeof c.accountId === "string" ? c.accountId : null,
    rid:           typeof c.rid === "string" && c.rid.trim() ? c.rid : undefined,
  };
}

/**
 * Extract a module ID string from an unknown module object for error messages.
 *
 * @param {unknown} mod
 * @param {number} index
 * @returns {string}
 */
function resolveModuleId(mod, index) {
  if (mod != null && typeof mod === "object" && !Array.isArray(mod)) {
    const id = /** @type {Record<string, unknown>} */ (mod).id;
    if (typeof id === "string" && id.trim()) return id;
  }
  return `<module[${index}]>`;
}

// =============================================================================
// Public: executeWorkflow
// =============================================================================

/**
 * Execute an ordered list of module steps as a single workflow run.
 *
 * All steps share one artifact store and one context (sessionId +
 * workflowRunId). Each step's outputs are available to subsequent steps
 * through the shared store.
 *
 * Execution is fail-fast: the first module that throws stops the run.
 * Modules that did not run are recorded with status "skipped".
 * The module that failed is recorded with status "failed" and its error.
 *
 * @param {unknown[]} moduleList
 *   Ordered list of module objects. Must be in final execution order —
 *   this function does not sort or reorder. Each module must pass
 *   assertEngineContract (enforced inside executeModuleStep).
 *
 * @param {WorkflowRunContext} context
 *   sessionId is required. workflowRunId is auto-generated if absent.
 *
 * @returns {Promise<WorkflowRunResult>}
 *   Always resolves (never rejects). Failures are captured in the result.
 *   The caller decides whether to throw based on result.status.
 */
export async function executeWorkflow(moduleList, context) {
  // ── Validate inputs ───────────────────────────────────────────────────────
  if (!Array.isArray(moduleList)) {
    throw new Error("[workflowRunner] moduleList must be an array");
  }
  if (moduleList.length === 0) {
    throw new Error("[workflowRunner] moduleList must not be empty");
  }

  const { sessionId, workflowRunId, accountId, rid } = normalizeRunContext(context);

  const tag = `[workflowRunner] sessionId=${sessionId} runId=${workflowRunId}`;

  // ── Expand moduleList into step list ──────────────────────────────────────
  // Each module becomes one step with a unique stepId and stepIndex, making
  // duplicate modules distinguishable throughout the run.
  // expandToSteps validates all engine contracts — any failure here means the
  // entire run is invalid. Caught below so executeWorkflow always resolves.
  let stepList;
  try {
    stepList = expandToSteps(moduleList);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`${tag} run aborted during step expansion: ${error}`);
    return { status: "failed", sessionId, workflowRunId, failedAt: null, steps: [], artifactStore: createRuntimeArtifactStore() };
  }

  console.log(`${tag} start steps=${stepList.length}`);

  // ── Create a single artifact store shared by all steps ───────────────────
  // One store per run: every module step reads from and writes to the same
  // store instance, making prior outputs available to subsequent steps.
  const artifactStore = createRuntimeArtifactStore();

  /** @type {WorkflowStepResult[]} */
  const steps = [];

  /** @type {string | null} */
  let failedAt = null;

  // ── Base context shared across all steps in this run ─────────────────────
  // sessionId and workflowRunId are fixed for the lifetime of the run.
  // stepId and stepIndex are added per-step in the loop below.
  const baseContext = { sessionId, workflowRunId, accountId: accountId ?? null, rid };

  // ── Execute steps in provided order ───────────────────────────────────────
  for (const { module: mod, stepId, stepIndex } of stepList) {
    const moduleId = resolveModuleId(mod, stepIndex);

    // Once a step has failed, mark all subsequent steps as skipped.
    if (failedAt !== null) {
      steps.push({
        stepId,
        stepIndex,
        moduleId,
        status:            "skipped",
        producedArtifacts: [],
        engineResults:     [],
        error:             null,
        durationMs:        0,
      });
      console.log(`${tag} step=${stepId} status=skipped (run already failed)`);
      continue;
    }

    const stepStart = Date.now();
    console.log(`${tag} step=${stepId} index=${stepIndex + 1}/${stepList.length} start`);

    /** @type {import("./moduleOrchestrator.js").ModuleStepContext} */
    const stepContext = { ...baseContext, stepId, stepIndex };

    try {
      const result = await executeModuleStep(mod, artifactStore, stepContext);

      const durationMs = Date.now() - stepStart;
      steps.push({
        stepId,
        stepIndex,
        moduleId,
        status:            "ok",
        producedArtifacts: result.producedArtifacts,
        engineResults:     result.engineResults,
        error:             null,
        durationMs,
      });

      console.log(
        `${tag} step=${stepId} status=ok ms=${durationMs}` +
        ` artifacts=[${result.producedArtifacts.map((a) => a.artifactType).join(", ")}]`,
      );
    } catch (e) {
      const durationMs = Date.now() - stepStart;
      const error = e instanceof Error ? e.message : String(e);

      steps.push({
        stepId,
        stepIndex,
        moduleId,
        status:            "failed",
        producedArtifacts: [],
        engineResults:     [],
        error,
        durationMs,
      });

      failedAt = stepId;
      console.error(`${tag} step=${stepId} status=failed ms=${durationMs} — ${error}`);
      // Fail-fast: remaining steps are recorded as "skipped" in subsequent
      // loop iterations (failedAt is now set).
    }
  }

  const overallStatus = failedAt === null ? "ok" : "failed";

  console.log(
    `${tag} done status=${overallStatus}` +
    (failedAt ? ` failedAt=${failedAt}` : "") +
    ` steps=${steps.length} modules=${moduleList.length}`,
  );

  return {
    status: overallStatus,
    sessionId,
    workflowRunId,
    failedAt,
    steps,
    artifactStore,
  };
}

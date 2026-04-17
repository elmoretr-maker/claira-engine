/**
 * Phase 3 — API output boundary: execution results → external JSON (declared artifacts + module outputs).
 * Pass-through mapping only; no semantic changes to module data.
 */

/**
 * @typedef {{
 *   version: 1,
 *   ok: boolean,
 *   pipelineValidation: { ok: boolean, errors: Array<{ code: string, message: string, detail?: Record<string, unknown> }> },
 *   declaredArtifactTrace: Array<{ kind: string, mode: string, declaredByModuleId: string }>,
 *   knownEntityIds: string[],
 *   continuityIssues: Array<{ code: string, detail?: Record<string, unknown> }>,
 *   moduleResults: Record<string, { status: string, data: Record<string, unknown>, errors: string[] }>,
 *   executionTrace: Array<{ moduleId: string, status: string, timestamp: number }>,
 * }} ExternalWorkflowOutput
 */

/**
 * @param {unknown} executionResult — return value of executeWorkflow
 * @returns {ExternalWorkflowOutput}
 */
export function formatWorkflowExecutionForExternal(executionResult) {
  const er =
    executionResult != null && typeof executionResult === "object"
      ? /** @type {Record<string, unknown>} */ (executionResult)
      : {};

  const pv = er.pipelineValidation;
  const pvOk = pv != null && typeof pv === "object" && /** @type {{ ok?: unknown }} */ (pv).ok === true;

  const results = er.results != null && typeof er.results === "object" && !Array.isArray(er.results) ? er.results : {};
  const trace = Array.isArray(er.executionTrace) ? er.executionTrace : [];

  /** @type {Array<{ code: string, message: string, detail?: Record<string, unknown> }>} */
  const pvErrors =
    pv != null && typeof pv === "object" && Array.isArray(/** @type {{ errors?: unknown }} */ (pv).errors)
      ? /** @type {{ errors: Array<{ code: string, message: string, detail?: Record<string, unknown> }> }} */ (pv).errors
      : [];

  const pipelineValidation = {
    ok: pvOk,
    errors: pvErrors,
  };

  const pc = er.pipelineContext;
  const store =
    pc != null && typeof pc === "object" && /** @type {{ artifactStore?: unknown }} */ (pc).artifactStore != null
      ? /** @type {{ artifactStore: import("../pipeline/pipelineArtifactStore.js").PipelineArtifactStore }} */ (pc)
          .artifactStore
      : null;

  const records = store?.records ?? [];
  const declaredArtifactTrace = records.map((r) => ({
    kind: r.kind,
    mode: r.mode,
    declaredByModuleId: r.declaredByModuleId,
  }));

  const knownEntityIds =
    store?.knownEntityIds instanceof Set ? [...store.knownEntityIds].sort() : [];

  const continuityIssues = Array.isArray(store?.continuityIssues) ? [...store.continuityIssues] : [];

  /** @type {Record<string, { status: string, data: Record<string, unknown>, errors: string[] }>} */
  const moduleResults = {};
  for (const [moduleId, entry] of Object.entries(results)) {
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = /** @type {{ status?: unknown, data?: unknown, errors?: unknown }} */ (entry);
    const status = typeof e.status === "string" ? e.status : "unknown";
    const data =
      e.data != null && typeof e.data === "object" && !Array.isArray(e.data)
        ? /** @type {Record<string, unknown>} */ ({ ...e.data })
        : {};
    const errors = Array.isArray(e.errors) ? e.errors.map((x) => String(x)) : [];
    moduleResults[moduleId] = { status, data, errors };
  }

  const executionTrace = trace.map((t) => {
    if (t == null || typeof t !== "object" || Array.isArray(t)) {
      return { moduleId: "", status: "", timestamp: 0 };
    }
    const row = /** @type {{ moduleId?: unknown, status?: unknown, timestamp?: unknown }} */ (t);
    return {
      moduleId: String(row.moduleId ?? ""),
      status: String(row.status ?? ""),
      timestamp: typeof row.timestamp === "number" && Number.isFinite(row.timestamp) ? row.timestamp : 0,
    };
  });

  return {
    version: 1,
    ok: pvOk,
    pipelineValidation,
    declaredArtifactTrace,
    knownEntityIds,
    continuityIssues,
    moduleResults,
    executionTrace,
  };
}

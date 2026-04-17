/**
 * Pipeline artifact bookkeeping — STRUCTURE ONLY (Phase 2).
 * No merge/derive/replace behavior; records declared produces and observed entity ids for continuity checks.
 */

/**
 * @typedef {{
 *   kind: string,
 *   mode: string,
 *   declaredByModuleId: string,
 * }} PipelineArtifactRecord
 */

/**
 * @typedef {{
 *   code: string,
 *   detail?: Record<string, unknown>,
 * }} PipelineContinuityIssue
 */

/**
 * @typedef {{
 *   records: PipelineArtifactRecord[],
 *   knownEntityIds: Set<string>,
 *   continuityIssues: PipelineContinuityIssue[],
 * }} PipelineArtifactStore
 */

/**
 * @returns {PipelineArtifactStore}
 */
export function createEmptyPipelineArtifactStore() {
  return {
    records: [],
    knownEntityIds: new Set(),
    continuityIssues: [],
  };
}

/**
 * Append static contract entries after a module step (declaration-only trace).
 * @param {PipelineArtifactStore} store
 * @param {string} moduleId
 * @param {unknown[]} produces
 */
export function appendDeclaredProduces(store, moduleId, produces) {
  if (!Array.isArray(produces)) return;
  for (const p of produces) {
    if (p == null || typeof p !== "object" || Array.isArray(p)) continue;
    const row = /** @type {{ kind?: unknown, mode?: unknown }} */ (p);
    if (typeof row.kind !== "string" || typeof row.mode !== "string") continue;
    store.records.push({
      kind: row.kind,
      mode: row.mode,
      declaredByModuleId: moduleId,
    });
  }
}

/**
 * Sync entity ids from the entity_tracking slice inside full moduleRuntimeState (read-only scan).
 * Rows missing a non-empty id are recorded as continuity issues (structure observation only).
 * @param {PipelineArtifactStore} store
 * @param {unknown} moduleRuntimeState — full `state.moduleRuntimeState` map, not a single slice
 */
export function recordEntityIdsFromRuntime(store, moduleRuntimeState) {
  if (moduleRuntimeState == null || typeof moduleRuntimeState !== "object") return;
  const root = /** @type {Record<string, unknown>} */ (moduleRuntimeState);
  const et = root.entity_tracking;
  if (et == null || typeof et !== "object" || Array.isArray(et)) return;
  const entities = /** @type {{ entities?: unknown }} */ (et).entities;
  if (!Array.isArray(entities)) return;
  for (let i = 0; i < entities.length; i++) {
    const row = entities[i];
    if (row && typeof row === "object" && !Array.isArray(row)) {
      const id = /** @type {{ id?: unknown }} */ (row).id;
      if (typeof id === "string" && id.trim()) store.knownEntityIds.add(id.trim());
      else {
        store.continuityIssues.push({
          code: "ENTITY_ROW_MISSING_ID",
          detail: { entityIndex: i },
        });
      }
    }
  }
}

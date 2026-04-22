/**
 * Runtime artifact store — in-memory, per-session, per-workflow-run.
 *
 * This is the data channel between module steps in the module orchestration
 * system (plan.md §4). It is distinct from pipelineArtifactStore.js, which
 * is a declaration-only ledger used by the old execute(context) system.
 *
 * ── Design rules ────────────────────────────────────────────────────────────
 *   - In-memory only. No disk I/O. Persistence is Phase 7.
 *   - Keyed by sessionId + workflowRunId. One store instance is shared across
 *     all module steps in a single workflow run.
 *   - Schema is enforced on write. No loose data enters the store.
 *   - Missing required artifacts throw immediately with a clear, actionable
 *     error. They are never silently skipped.
 *   - Modules do not pass objects directly to each other. This store is the
 *     only permitted data channel (plan.md §4.1).
 *
 * ── Artifact schema (plan.md §4.3) ──────────────────────────────────────────
 *   artifactType     string   Semantic type token (e.g. "AnalysisBatch").
 *   artifactVersion  number   Positive integer — bumped when the shape changes.
 *   artifactId       string   UUID identifying this specific artifact record.
 *   sessionId        string   The user session this artifact belongs to.
 *   workflowRunId    string   The workflow run this artifact belongs to.
 *   moduleId         string   The module that produced this artifact.
 *   sourceKind       string   The runClaira kind that was called to produce it.
 *   rid              string   The engine request ID from the runClaira context.
 *   createdAt        string   ISO 8601 timestamp of when the artifact was written.
 *   data             any      The artifact payload. Must be present (may be null
 *                             for terminal/marker artifacts).
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   const store = createRuntimeArtifactStore();
 *
 *   // Module writes:
 *   store.writeArtifact(buildArtifact({
 *     artifactType: "AnalysisBatch",
 *     artifactVersion: 1,
 *     sessionId,
 *     workflowRunId,
 *     moduleId: "photo_analysis",
 *     sourceKind: "analyzePhotos",
 *     rid,
 *     data: { results: [...] },
 *   }));
 *
 *   // Orchestrator asserts dependencies before running next module:
 *   store.assertArtifactsAvailable(sessionId, workflowRunId, ["AnalysisBatch"]);
 *
 *   // Next module reads:
 *   const [batch] = store.readArtifactsByType(sessionId, workflowRunId, "AnalysisBatch");
 *
 * ── Step-Based Versioned Artifacts ───────────────────────────────────────────
 *
 * The store supports multiple artifacts of the same type within a single run.
 * This is not an error — it is the core "Step-Based Versioned Artifacts"
 * pattern (plan.md §19).
 *
 * Example:
 *   A workflow runs "photo_analysis" at steps A__0 and A__2.
 *   Both produce "AnalysisBatch" artifacts. The store holds both:
 *     readArtifactsByType(sid, rid, "AnalysisBatch")
 *     → [{ producedByStepId: "photo_analysis__0", ... },
 *        { producedByStepId: "photo_analysis__2", ... }]
 *
 * STORE CONTRACT:
 *   - Artifacts are ALWAYS appended, never overwritten or deleted.
 *   - readArtifactsByType returns all versions in write order (oldest first).
 *   - The LAST element is always the most recently produced artifact.
 *   - The most recent artifact is the one modules should use for downstream
 *     execution (enforced by convention in moduleOrchestrator.js).
 *   - Earlier artifacts are retained for the UI comparison system and the
 *     Comparative Analysis Engine (plan.md §21).
 */

// =============================================================================
// Artifact schema typedef
// =============================================================================

/**
 * @typedef {{
 *   artifactType:     string,
 *   artifactVersion:  number,
 *   artifactId:       string,
 *   sessionId:        string,
 *   workflowRunId:    string,
 *   moduleId:         string,
 *   sourceKind:       string,
 *   rid:              string,
 *   createdAt:        string,
 *   data:             unknown,
 *   producedByStepId?: string,
 *   stepIndex?:        number,
 * }} RuntimeArtifact
 */

/**
 * @typedef {{
 *   writeArtifact:          (artifact: RuntimeArtifact) => void,
 *   readArtifactsByType:    (sessionId: string, workflowRunId: string, artifactType: string) => RuntimeArtifact[],
 *   assertArtifactsAvailable: (sessionId: string, workflowRunId: string, requiredTypes: string[]) => void,
 *   hasArtifactType:        (sessionId: string, workflowRunId: string, artifactType: string) => boolean,
 *   getAll:                 (sessionId: string, workflowRunId: string) => RuntimeArtifact[],
 *   clear:                  (sessionId: string, workflowRunId: string) => void,
 * }} RuntimeArtifactStore
 */

// =============================================================================
// Private helpers
// =============================================================================

/**
 * Generate a unique artifact ID.
 * Uses crypto.randomUUID when available (Node ≥ 14.17), falls back to a
 * timestamp + random string combination that is unique enough for in-memory use.
 *
 * @returns {string}
 */
function generateArtifactId() {
  const c = /** @type {{ randomUUID?: () => string }} */ (globalThis.crypto);
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `art_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Derive the internal map key for a session + run combination.
 * The separator (::) is not a valid character in either ID, so collisions
 * between (a + b) and (a::b) are impossible.
 *
 * @param {string} sessionId
 * @param {string} workflowRunId
 * @returns {string}
 */
function makeStoreKey(sessionId, workflowRunId) {
  return `${sessionId}::${workflowRunId}`;
}

/**
 * Validate that a string field is a non-empty string.
 *
 * @param {unknown} value
 * @param {string} fieldName
 * @param {string} context
 * @throws {Error}
 */
function assertNonEmptyString(value, fieldName, context) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `[runtimeArtifactStore] ${context}: "${fieldName}" must be a non-empty string, got ${JSON.stringify(value)}`,
    );
  }
}

/**
 * Validate that an artifact record satisfies the full schema (plan.md §4.3).
 * Throws a descriptive error for the first violation found.
 *
 * @param {unknown} artifact
 * @throws {Error}
 */
function assertValidArtifact(artifact) {
  if (artifact == null || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error(
      "[runtimeArtifactStore] writeArtifact: artifact must be a non-null, non-array object",
    );
  }

  const a = /** @type {Record<string, unknown>} */ (artifact);
  const ctx = `writeArtifact(artifactType="${a.artifactType ?? "?"}")`;

  // Required string fields
  for (const field of ["artifactType", "artifactId", "sessionId", "workflowRunId", "moduleId", "sourceKind", "rid", "createdAt"]) {
    assertNonEmptyString(a[field], field, ctx);
  }

  // artifactVersion — positive integer
  if (
    typeof a.artifactVersion !== "number" ||
    !Number.isInteger(a.artifactVersion) ||
    a.artifactVersion < 1
  ) {
    throw new Error(
      `[runtimeArtifactStore] ${ctx}: "artifactVersion" must be a positive integer, got ${JSON.stringify(a.artifactVersion)}`,
    );
  }

  // createdAt — must parse as a valid date
  if (Number.isNaN(Date.parse(/** @type {string} */ (a.createdAt)))) {
    throw new Error(
      `[runtimeArtifactStore] ${ctx}: "createdAt" must be a valid ISO 8601 timestamp, got ${JSON.stringify(a.createdAt)}`,
    );
  }

  // data — must be present as an own property (null is allowed for marker artifacts)
  if (!Object.prototype.hasOwnProperty.call(a, "data")) {
    throw new Error(
      `[runtimeArtifactStore] ${ctx}: "data" field is required (use null for marker artifacts)`,
    );
  }
}

// =============================================================================
// Public: artifact builder helper
// =============================================================================

/**
 * Build a valid RuntimeArtifact record from caller-supplied fields.
 *
 * artifactId and createdAt are auto-generated if not supplied.
 * All other fields are required and validated.
 *
 * This is the canonical way for module authors to construct artifacts before
 * writing them to the store.
 *
 * @param {{
 *   artifactType:     string,
 *   artifactVersion:  number,
 *   sessionId:        string,
 *   workflowRunId:    string,
 *   moduleId:         string,
 *   sourceKind:       string,
 *   rid:              string,
 *   data:             unknown,
 *   artifactId?:      string,
 *   createdAt?:       string,
 *   producedByStepId?: string,
 *   stepIndex?:        number,
 * }} fields
 * @returns {RuntimeArtifact}
 * @throws {Error} if required fields are missing or invalid
 */
export function buildArtifact(fields) {
  if (fields == null || typeof fields !== "object") {
    throw new Error("[runtimeArtifactStore] buildArtifact: fields must be a non-null object");
  }

  const artifact = {
    artifactType:    fields.artifactType,
    artifactVersion: fields.artifactVersion,
    artifactId:      typeof fields.artifactId === "string" && fields.artifactId.trim()
      ? fields.artifactId
      : generateArtifactId(),
    sessionId:       fields.sessionId,
    workflowRunId:   fields.workflowRunId,
    moduleId:        fields.moduleId,
    sourceKind:      fields.sourceKind,
    rid:             fields.rid,
    createdAt:       typeof fields.createdAt === "string" && fields.createdAt.trim()
      ? fields.createdAt
      : new Date().toISOString(),
    data:            Object.prototype.hasOwnProperty.call(fields, "data") ? fields.data : undefined,
    // Optional step-lineage fields. Present when executeModuleStep is called via
    // workflowRunner (which stamps stepId + stepIndex). Absent for direct calls.
    ...(typeof fields.producedByStepId === "string" && fields.producedByStepId.trim()
      ? { producedByStepId: fields.producedByStepId }
      : {}),
    ...(typeof fields.stepIndex === "number"
      ? { stepIndex: fields.stepIndex }
      : {}),
  };

  // Run full validation — catches missing required fields before the object
  // reaches the store.
  assertValidArtifact(artifact);

  return /** @type {RuntimeArtifact} */ (artifact);
}

// =============================================================================
// Public: store factory
// =============================================================================

/**
 * Create a new in-memory runtime artifact store.
 *
 * One store instance is created per workflow run by the module orchestrator
 * and passed to every module step. Modules never create their own stores.
 *
 * @returns {RuntimeArtifactStore}
 */
export function createRuntimeArtifactStore() {
  /**
   * Top-level map: storeKey → typeMap.
   * typeMap: artifactType → RuntimeArtifact[].
   *
   * Using nested Maps keeps lookup O(1) for both the session+run key and the
   * artifact type, with no string concatenation at read time beyond the key.
   *
   * @type {Map<string, Map<string, RuntimeArtifact[]>>}
   */
  const _store = new Map();

  /**
   * Get or create the type map for a session + run combination.
   *
   * @param {string} sessionId
   * @param {string} workflowRunId
   * @returns {Map<string, RuntimeArtifact[]>}
   */
  function getOrCreateTypeMap(sessionId, workflowRunId) {
    const key = makeStoreKey(sessionId, workflowRunId);
    if (!_store.has(key)) _store.set(key, new Map());
    return /** @type {Map<string, RuntimeArtifact[]>} */ (_store.get(key));
  }

  /**
   * Get the type map for a session + run, or null if it does not exist.
   *
   * @param {string} sessionId
   * @param {string} workflowRunId
   * @returns {Map<string, RuntimeArtifact[]> | null}
   */
  function getTypeMapOrNull(sessionId, workflowRunId) {
    return _store.get(makeStoreKey(sessionId, workflowRunId)) ?? null;
  }

  // ── Validate session/run IDs at the store boundary ───────────────────────

  /**
   * @param {unknown} sessionId
   * @param {unknown} workflowRunId
   * @param {string} callerName
   */
  function assertValidRunIds(sessionId, workflowRunId, callerName) {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new Error(`[runtimeArtifactStore] ${callerName}: sessionId must be a non-empty string`);
    }
    if (typeof workflowRunId !== "string" || !workflowRunId.trim()) {
      throw new Error(`[runtimeArtifactStore] ${callerName}: workflowRunId must be a non-empty string`);
    }
  }

  // ── Public store methods ──────────────────────────────────────────────────

  /**
   * Write a validated artifact to the store.
   *
   * The artifact's own sessionId and workflowRunId determine where it is stored.
   * Full schema validation runs before the record is accepted — no partial or
   * malformed artifacts are stored.
   *
   * Multiple artifacts of the same type may be written for the same run; they
   * are appended in write order. The latest write is last in the array.
   *
   * @param {RuntimeArtifact} artifact
   * @throws {Error} if the artifact fails schema validation
   */
  function writeArtifact(artifact) {
    assertValidArtifact(artifact);

    const a = /** @type {RuntimeArtifact} */ (artifact);
    const typeMap = getOrCreateTypeMap(a.sessionId, a.workflowRunId);
    const existing = typeMap.get(a.artifactType) ?? [];
    existing.push(a);
    typeMap.set(a.artifactType, existing);

    console.log(
      `[runtimeArtifactStore] write sessionId=${a.sessionId} runId=${a.workflowRunId}` +
      ` type=${a.artifactType} v${a.artifactVersion} id=${a.artifactId} module=${a.moduleId}`,
    );
  }

  /**
   * Return all artifact records of a given type for a session + run.
   *
   * Returns an empty array if no artifacts of that type have been written.
   * The returned array is a shallow copy — callers must not mutate it.
   *
   * To require that at least one artifact exists, use assertArtifactsAvailable
   * before calling this function, or use the return value and check length.
   *
   * @param {string} sessionId
   * @param {string} workflowRunId
   * @param {string} artifactType
   * @returns {RuntimeArtifact[]}
   * @throws {Error} if sessionId or workflowRunId are invalid
   */
  function readArtifactsByType(sessionId, workflowRunId, artifactType) {
    assertValidRunIds(sessionId, workflowRunId, "readArtifactsByType");

    if (typeof artifactType !== "string" || !artifactType.trim()) {
      throw new Error(
        "[runtimeArtifactStore] readArtifactsByType: artifactType must be a non-empty string",
      );
    }

    const typeMap = getTypeMapOrNull(sessionId, workflowRunId);
    if (!typeMap) return [];
    return [...(typeMap.get(artifactType) ?? [])];
  }

  /**
   * Assert that all required artifact types are present for a session + run.
   *
   * Called by the module orchestrator before running each module step to
   * enforce the module's declared `consumes` list.
   *
   * Throws immediately with a clear, actionable error naming every missing type
   * so the caller knows exactly what failed and why.
   *
   * A type is considered "present" if at least one artifact of that type has
   * been written to the store for this session + run.
   *
   * @param {string} sessionId
   * @param {string} workflowRunId
   * @param {string[]} requiredTypes  List of artifactType strings that must exist.
   * @throws {Error} if any required type is missing, listing all missing types.
   */
  function assertArtifactsAvailable(sessionId, workflowRunId, requiredTypes) {
    assertValidRunIds(sessionId, workflowRunId, "assertArtifactsAvailable");

    if (!Array.isArray(requiredTypes)) {
      throw new Error(
        "[runtimeArtifactStore] assertArtifactsAvailable: requiredTypes must be an array",
      );
    }

    const typeMap = getTypeMapOrNull(sessionId, workflowRunId);

    /** @type {string[]} */
    const missing = [];

    for (const type of requiredTypes) {
      if (typeof type !== "string" || !type.trim()) {
        throw new Error(
          `[runtimeArtifactStore] assertArtifactsAvailable: every required type must be a non-empty string, got ${JSON.stringify(type)}`,
        );
      }
      const records = typeMap?.get(type);
      if (!records || records.length === 0) {
        missing.push(type);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `[runtimeArtifactStore] assertArtifactsAvailable: ` +
        `missing required artifact type(s): ${missing.map((t) => `"${t}"`).join(", ")} ` +
        `for sessionId="${sessionId}" workflowRunId="${workflowRunId}". ` +
        `The module that produces these types must run before this step.`,
      );
    }
  }

  /**
   * Return true if at least one artifact of the given type exists for this
   * session + run. Does not throw; use assertArtifactsAvailable when presence
   * is required.
   *
   * @param {string} sessionId
   * @param {string} workflowRunId
   * @param {string} artifactType
   * @returns {boolean}
   */
  function hasArtifactType(sessionId, workflowRunId, artifactType) {
    assertValidRunIds(sessionId, workflowRunId, "hasArtifactType");
    const typeMap = getTypeMapOrNull(sessionId, workflowRunId);
    if (!typeMap) return false;
    const records = typeMap.get(artifactType);
    return records != null && records.length > 0;
  }

  /**
   * Return all artifact records for a session + run in write order.
   * Returns an empty array if no artifacts have been written.
   * The returned array is a shallow copy.
   *
   * @param {string} sessionId
   * @param {string} workflowRunId
   * @returns {RuntimeArtifact[]}
   */
  function getAll(sessionId, workflowRunId) {
    assertValidRunIds(sessionId, workflowRunId, "getAll");
    const typeMap = getTypeMapOrNull(sessionId, workflowRunId);
    if (!typeMap) return [];
    /** @type {RuntimeArtifact[]} */
    const all = [];
    for (const records of typeMap.values()) {
      all.push(...records);
    }
    return all;
  }

  /**
   * Remove all artifacts for a session + run from the store.
   * Primarily used by tests and for explicit run teardown.
   *
   * @param {string} sessionId
   * @param {string} workflowRunId
   */
  function clear(sessionId, workflowRunId) {
    assertValidRunIds(sessionId, workflowRunId, "clear");
    _store.delete(makeStoreKey(sessionId, workflowRunId));
  }

  return {
    writeArtifact,
    readArtifactsByType,
    assertArtifactsAvailable,
    hasArtifactType,
    getAll,
    clear,
  };
}

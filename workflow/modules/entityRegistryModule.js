/**
 * entity_registry — Engine-aware module (Phase 4+, plan.md §15 Module 2)
 *
 * Responsibility: Register ingested entities as durable tracked records.
 * This module is DISTINCT from entity_input (ingestion).
 * entity_input brings raw data in; entity_registry creates the tracked record.
 *
 * Engine capabilities:
 *   ✅ createTrackingEntity  — exists in CLAIRA_RUN_HANDLERS
 *   ✅ listTrackingEntities  — exists in CLAIRA_RUN_HANDLERS
 *
 * Artifact flow:
 *   consumes: entity   (artifactType: "RawEntityInput"  — produced by entity_input)
 *   produces: entity   (artifactType: "EntitySet"       — registered entity records)
 *
 * Universal: products, clients, members, patients, assets — any named, trackable
 * item in any domain.
 */

/**
 * @typedef {{ id: string, label: string, domain?: string, attributes?: Record<string, unknown> }} RawEntityRow
 * @typedef {{ entities: RawEntityRow[] }} RawEntityInputData
 * @typedef {{ entityId: string, label: string, registeredAt: string, attributes?: Record<string, unknown> }} RegisteredEntity
 * @typedef {{ entities: RegisteredEntity[] }} EntitySetData
 */

export const entityRegistryModule = {
  id: "entity_registry",
  label: "Entity Registry",
  description:
    "Register ingested entities as tracked records in the system. Distinct from entity_input: entity_input brings data in; entity_registry creates durable tracked records.",
  capabilities: ["register_entity", "list_entities"],
  modulePipelineType: "tracking",
  expectedContextVersion: 2,

  /** Registered artifact kinds consumed (RawEntityInput within "entity" kind) */
  consumes: ["entity"],

  /** Produces an EntitySet — all registered entity records for this session */
  produces: [{ kind: "entity", mode: "create" }],

  /** Engine kinds called by this module via runClaira() */
  engineKinds: ["createTrackingEntity", "listTrackingEntities"],

  // ---------------------------------------------------------------------------
  // Orchestration methods — called by moduleOrchestrator
  // ---------------------------------------------------------------------------

  /**
   * Build the payload for runClaira("createTrackingEntity", ...).
   * Called once per entity in the RawEntityInput. The orchestrator calls this
   * before each runClaira() invocation for the "createTrackingEntity" kind.
   *
   * For "listTrackingEntities" the payload is empty — pass {} or omit fields.
   *
   * @param {Record<string, import("../pipeline/runtimeArtifactStore.js").RuntimeArtifact[]>} consumedArtifacts
   * @param {Record<string, unknown>} [moduleOptions]
   * @returns {{ entities: RawEntityRow[], domain?: string }}
   */
  buildPayload(consumedArtifacts, moduleOptions = {}) {
    const rawArtifact = consumedArtifacts["entity"]?.at(-1);
    if (!rawArtifact) {
      throw new Error("entity_registry: no entity artifact found in store — entity_input must run first");
    }
    const data = /** @type {RawEntityInputData} */ (rawArtifact.data);
    return {
      entities: data.entities ?? [],
      domain: /** @type {string | undefined} */ (moduleOptions.domain),
    };
  },

  /**
   * Normalize the combined engine results from createTrackingEntity +
   * listTrackingEntities into a single EntitySet artifact payload.
   *
   * @param {{ createTrackingEntity: unknown, listTrackingEntities: unknown }} engineResults
   * @returns {{ artifactType: "EntitySet", data: EntitySetData }}
   */
  normalizeToArtifacts(engineResults) {
    const listResult = /** @type {{ entities?: RegisteredEntity[] }} */ (
      engineResults.listTrackingEntities ?? {}
    );
    return {
      artifactType: "EntitySet",
      data: {
        entities: listResult.entities ?? [],
      },
    };
  },

  // ---------------------------------------------------------------------------
  // Base contract fields (required by assertModuleFollowsContract)
  // These are no-op for orchestration-only modules.
  // ---------------------------------------------------------------------------

  state: {
    initialize: () => ({}),
    selectors: {},
    reducers: {},
  },

  health: {
    /** @param {Record<string, never>} _s */
    check(_s) {
      return { status: /** @type {"healthy"} */ ("healthy"), issues: [] };
    },
  },

  ui: {
    components: [],
  },
};

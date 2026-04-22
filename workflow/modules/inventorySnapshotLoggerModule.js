/**
 * inventory_snapshot_logger — Engine-aware module (Phase 4+, plan.md §15 Module 3)
 *
 * Responsibility: Record the current state of each entity as a point-in-time
 * snapshot. This represents STATE, not an event.
 *
 * Engine capabilities:
 *   ✅ addTrackingSnapshot  — exists in CLAIRA_RUN_HANDLERS
 *   ✅ listTrackingSnapshots — exists in CLAIRA_RUN_HANDLERS
 *
 * Artifact flow:
 *   consumes: entity     (artifactType: "EntitySet"   — produced by entity_registry)
 *   produces: aggregate  (artifactType: "SnapshotSet" — point-in-time state records)
 *
 * Universal: inventory counts, measurements, financial positions, client metrics,
 * medical readings — any domain with measurable point-in-time state per entity.
 *
 * ⚠ This is STATE, not an event. Distinguish from delivery_logger / sales_logger
 * which use the same underlying kind but carry eventType in the payload.
 */

/**
 * @typedef {{ entityId: string, label: string }} RegisteredEntity
 * @typedef {{ entities: RegisteredEntity[] }} EntitySetData
 *
 * @typedef {{
 *   entityId: string,
 *   quantity: number,
 *   unit?: string,
 *   attributes?: Record<string, unknown>,
 *   recordedAt: string,
 * }} SnapshotRecord
 * @typedef {{ snapshots: SnapshotRecord[] }} SnapshotSetData
 */

export const inventorySnapshotLoggerModule = {
  id: "inventory_snapshot_logger",
  label: "Inventory Snapshot Logger",
  description:
    "Record the current state of each entity as a point-in-time snapshot (quantities, attributes, levels). This is state, not an event. Produces a baseline for delta computation.",
  capabilities: ["record_snapshot", "list_snapshots"],
  modulePipelineType: "tracking",
  expectedContextVersion: 2,

  /** Consumes EntitySet produced by entity_registry */
  consumes: ["entity"],

  /** Produces SnapshotSet — aggregate of point-in-time state records */
  produces: [{ kind: "aggregate", mode: "create" }],

  /** Engine kinds called by this module via runClaira() */
  engineKinds: ["addTrackingSnapshot", "listTrackingSnapshots"],

  // ---------------------------------------------------------------------------
  // Orchestration methods
  // ---------------------------------------------------------------------------

  /**
   * Build the payload for runClaira("addTrackingSnapshot", ...).
   * Each entity in the EntitySet gets one snapshot record.
   * moduleOptions.snapshots provides the user-entered quantity data.
   *
   * @param {Record<string, import("../pipeline/runtimeArtifactStore.js").RuntimeArtifact[]>} consumedArtifacts
   * @param {Record<string, unknown>} [moduleOptions]
   * @returns {{ entityId: string, snapshotType: "state", entries: unknown[], recordedAt: string }}
   */
  buildPayload(consumedArtifacts, moduleOptions = {}) {
    const entityArtifact = consumedArtifacts["entity"]?.at(-1);
    if (!entityArtifact) {
      throw new Error(
        "inventory_snapshot_logger: no entity artifact in store — entity_registry must run first",
      );
    }
    const entitySet = /** @type {EntitySetData} */ (entityArtifact.data);
    const entries = /** @type {unknown[]} */ (moduleOptions.entries ?? []);

    return {
      entityId: "batch",
      snapshotType: "state",
      entries: entitySet.entities.map((e) => ({
        entityId: e.entityId,
        .../** @type {Record<string, unknown>} */ (
          entries.find(
            (en) => /** @type {{ entityId?: string }} */ (en).entityId === e.entityId,
          ) ?? {}
        ),
      })),
      recordedAt: new Date().toISOString(),
    };
  },

  /**
   * Normalize the addTrackingSnapshot + listTrackingSnapshots results into
   * a SnapshotSet artifact payload.
   *
   * @param {{ addTrackingSnapshot: unknown, listTrackingSnapshots: unknown }} engineResults
   * @returns {{ artifactType: "SnapshotSet", data: SnapshotSetData }}
   */
  normalizeToArtifacts(engineResults) {
    const listResult = /** @type {{ snapshots?: SnapshotRecord[] }} */ (
      engineResults.listTrackingSnapshots ?? {}
    );
    return {
      artifactType: "SnapshotSet",
      data: {
        snapshots: listResult.snapshots ?? [],
      },
    };
  },

  // ---------------------------------------------------------------------------
  // Base contract fields
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

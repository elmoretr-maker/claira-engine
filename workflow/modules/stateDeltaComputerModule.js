/**
 * state_delta_computer — Engine-aware module (Phase 4+, plan.md §15 Module 6)
 *
 * Responsibility: Compute raw numerical differences between baseline state and
 * current state, incorporating event history. Produces per-entity delta values.
 * Distinct from trend_interpreter: this module produces NUMBERS; the interpreter
 * produces MEANING.
 *
 * Engine capabilities:
 *   ❌ computeStateDelta  — DOES NOT EXIST in CLAIRA_RUN_HANDLERS
 *      Must be built and registered before this module can execute.
 *
 * Expected engine output shape (per entity):
 *   { entityId, startValue, endValue, netDelta, deliveryTotal, salesTotal }
 *
 * Artifact flow:
 *   consumes: aggregate  (artifactType: "SnapshotSet"       — produced by inventory_snapshot_logger)
 *             event      (artifactType: "DeliveryEventLog"  — produced by delivery_logger)
 *             event      (artifactType: "SalesEventLog"     — produced by sales_logger)
 *   produces: analysis   (artifactType: "StateDelta"        — per-entity delta values)
 *
 * Universal: inventory, fitness metrics, financial balances, any measurable state
 * across any domain with entities and timestamped events.
 *
 * ⚠ BUILD PREREQUISITE: computeStateDelta handler + pipeline must exist before use.
 */

/**
 * @typedef {{ snapshots: import("./inventorySnapshotLoggerModule.js").SnapshotRecord[] }} SnapshotSetData
 * @typedef {{ events: import("./deliveryLoggerModule.js").DeliveryEvent[] }} DeliveryEventLogData
 * @typedef {{ events: import("./salesLoggerModule.js").SaleEvent[] }} SalesEventLogData
 *
 * @typedef {{
 *   entityId:       string,
 *   startValue:     number,
 *   endValue:       number,
 *   netDelta:       number,
 *   deliveryTotal:  number,
 *   salesTotal:     number,
 * }} EntityDelta
 *
 * @typedef {{ deltas: EntityDelta[] }} StateDeltaData
 */

export const stateDeltaComputerModule = {
  id: "state_delta_computer",
  label: "State Delta Computer",
  description:
    "Compute raw numerical differences between baseline state and current event history per entity. Produces StateDelta — numbers only. Distinct from trend_interpreter which adds direction and meaning.",
  capabilities: ["compute_state_delta"],
  modulePipelineType: "processing",
  expectedContextVersion: 2,

  /** Consumes SnapshotSet (aggregate) + DeliveryEventLog + SalesEventLog (event) */
  consumes: ["aggregate", "event"],

  /** Produces StateDelta — per-entity delta analysis */
  produces: [{ kind: "analysis", mode: "create" }],

  /**
   * Engine kinds called by this module via runClaira().
   * ❌ computeStateDelta does not exist yet — must be built in CLAIRA_RUN_HANDLERS.
   */
  engineKinds: ["computeStateDelta"],

  // ---------------------------------------------------------------------------
  // Orchestration methods
  // ---------------------------------------------------------------------------

  /**
   * Build the payload for runClaira("computeStateDelta", ...).
   *
   * Consumes the most recent SnapshotSet, DeliveryEventLog, and SalesEventLog.
   * The "most recent" rule applies: always use .at(-1) for each kind.
   *
   * Payload shape (defined here; engine must accept this shape):
   * {
   *   snapshots:       SnapshotRecord[],    // baseline state
   *   deliveryEvents:  DeliveryEvent[],     // incoming events
   *   saleEvents:      SaleEvent[],         // outgoing events
   * }
   *
   * @param {Record<string, import("../pipeline/runtimeArtifactStore.js").RuntimeArtifact[]>} consumedArtifacts
   * @param {Record<string, unknown>} [_moduleOptions]
   * @returns {{ snapshots: unknown[], deliveryEvents: unknown[], saleEvents: unknown[] }}
   */
  buildPayload(consumedArtifacts, _moduleOptions = {}) {
    const snapshotArtifact = consumedArtifacts["aggregate"]?.at(-1);
    if (!snapshotArtifact) {
      throw new Error(
        "state_delta_computer: no aggregate artifact in store — inventory_snapshot_logger must run first",
      );
    }

    // Split the event artifacts by artifactType.
    // Both delivery_logger and sales_logger write to the "event" kind.
    const eventArtifacts = consumedArtifacts["event"] ?? [];
    const deliveryArtifact = [...eventArtifacts]
      .reverse()
      .find((a) => a.artifactType === "DeliveryEventLog");
    const salesArtifact = [...eventArtifacts]
      .reverse()
      .find((a) => a.artifactType === "SalesEventLog");

    if (!deliveryArtifact) {
      throw new Error(
        "state_delta_computer: no DeliveryEventLog artifact in store — delivery_logger must run first",
      );
    }
    if (!salesArtifact) {
      throw new Error(
        "state_delta_computer: no SalesEventLog artifact in store — sales_logger must run first",
      );
    }

    const snapshotData = /** @type {SnapshotSetData} */ (snapshotArtifact.data);
    const deliveryData = /** @type {DeliveryEventLogData} */ (deliveryArtifact.data);
    const salesData = /** @type {SalesEventLogData} */ (salesArtifact.data);

    return {
      snapshots: snapshotData.snapshots ?? [],
      deliveryEvents: deliveryData.events ?? [],
      saleEvents: salesData.events ?? [],
    };
  },

  /**
   * Normalize the computeStateDelta engine result into a StateDelta artifact.
   *
   * ❌ ENGINE KIND NOT YET BUILT — this will not execute until computeStateDelta
   * is registered in CLAIRA_RUN_HANDLERS. The normalizer is defined here to
   * document the expected output contract for the engine implementor.
   *
   * @param {{ computeStateDelta: unknown }} engineResults
   * @returns {{ artifactType: "StateDelta", data: StateDeltaData }}
   */
  normalizeToArtifacts(engineResults) {
    const result = /** @type {{ deltas?: EntityDelta[] }} */ (
      engineResults.computeStateDelta ?? {}
    );
    return {
      artifactType: "StateDelta",
      data: {
        deltas: result.deltas ?? [],
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

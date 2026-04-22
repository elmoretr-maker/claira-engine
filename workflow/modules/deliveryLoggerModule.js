/**
 * delivery_logger — Engine-aware module (Phase 4+, plan.md §15 Module 4)
 *
 * Responsibility: Record incoming stock deliveries as timestamped events
 * against entities. This represents an EVENT, not a state update.
 *
 * Note on "event_logger" naming from plan.md §16:
 * The original overloaded event_logger mixed delivery and sale events — two
 * distinct event types with different semantics. Per plan.md §16 Rule 1, they
 * must be separate modules. delivery_logger and sales_logger replace event_logger.
 *
 * Engine capabilities:
 *   ✅ addTrackingSnapshot  — exists in CLAIRA_RUN_HANDLERS
 *      (payload extension: eventType: "delivery" distinguishes events from state)
 *
 * Artifact flow:
 *   consumes: entity  (artifactType: "EntitySet"        — produced by entity_registry)
 *   produces: event   (artifactType: "DeliveryEventLog" — timestamped delivery records)
 *
 * Universal: any domain with incoming stock, intake, arrival, or accession events.
 */

/**
 * @typedef {{ entityId: string, label: string }} RegisteredEntity
 * @typedef {{ entities: RegisteredEntity[] }} EntitySetData
 *
 * @typedef {{
 *   entityId: string,
 *   quantity: number,
 *   unit?: string,
 *   source?: string,
 *   notes?: string,
 *   occurredAt: string,
 * }} DeliveryEvent
 * @typedef {{ events: DeliveryEvent[] }} DeliveryEventLogData
 */

export const deliveryLoggerModule = {
  id: "delivery_logger",
  label: "Delivery Logger",
  description:
    "Record incoming stock deliveries as timestamped events against entities. This is an event, not a state update. Produces a DeliveryEventLog for delta computation.",
  capabilities: ["log_delivery_event"],
  modulePipelineType: "tracking",
  expectedContextVersion: 2,

  /** Consumes EntitySet produced by entity_registry */
  consumes: ["entity"],

  /** Produces DeliveryEventLog — an append-only event record */
  produces: [{ kind: "event", mode: "create" }],

  /** Engine kinds called by this module via runClaira() */
  engineKinds: ["addTrackingSnapshot"],

  // ---------------------------------------------------------------------------
  // Orchestration methods
  // ---------------------------------------------------------------------------

  /**
   * Build the payload for runClaira("addTrackingSnapshot", ...).
   * eventType: "delivery" distinguishes this from state snapshots and sale events.
   * moduleOptions.deliveries provides the user-entered delivery records.
   *
   * @param {Record<string, import("../pipeline/runtimeArtifactStore.js").RuntimeArtifact[]>} consumedArtifacts
   * @param {Record<string, unknown>} [moduleOptions]
   * @returns {{ eventType: "delivery", entries: unknown[], occurredAt: string }}
   */
  buildPayload(consumedArtifacts, moduleOptions = {}) {
    const entityArtifact = consumedArtifacts["entity"]?.at(-1);
    if (!entityArtifact) {
      throw new Error(
        "delivery_logger: no entity artifact in store — entity_registry must run first",
      );
    }
    const deliveries = /** @type {unknown[]} */ (moduleOptions.deliveries ?? []);

    return {
      eventType: "delivery",
      entries: deliveries,
      occurredAt: new Date().toISOString(),
    };
  },

  /**
   * Normalize the addTrackingSnapshot result (eventType: "delivery") into a
   * DeliveryEventLog artifact payload.
   *
   * @param {{ addTrackingSnapshot: unknown }} engineResults
   * @returns {{ artifactType: "DeliveryEventLog", data: DeliveryEventLogData }}
   */
  normalizeToArtifacts(engineResults) {
    const result = /** @type {{ events?: DeliveryEvent[] }} */ (
      engineResults.addTrackingSnapshot ?? {}
    );
    return {
      artifactType: "DeliveryEventLog",
      data: {
        events: result.events ?? [],
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

/**
 * sales_logger — Engine-aware module (Phase 4+, plan.md §15 Module 5)
 *
 * Responsibility: Record outgoing sales as timestamped events against entities.
 * This represents an EVENT, not a state update.
 *
 * Note on "event_logger" naming from plan.md §16:
 * The original overloaded event_logger mixed delivery and sale events — two
 * distinct event types with different semantics. Per plan.md §16 Rule 1, they
 * must be separate modules. delivery_logger and sales_logger replace event_logger.
 *
 * Engine capabilities:
 *   ✅ addTrackingSnapshot  — exists in CLAIRA_RUN_HANDLERS
 *      (payload extension: eventType: "sale" distinguishes events from state)
 *
 * Artifact flow:
 *   consumes: entity  (artifactType: "EntitySet"     — produced by entity_registry)
 *   produces: event   (artifactType: "SalesEventLog" — timestamped sale records)
 *
 * Universal: any domain with outgoing activity, consumption, dispensing, discharge,
 * or usage events.
 */

/**
 * @typedef {{ entityId: string, label: string }} RegisteredEntity
 * @typedef {{ entities: RegisteredEntity[] }} EntitySetData
 *
 * @typedef {{
 *   entityId: string,
 *   quantity: number,
 *   unit?: string,
 *   channel?: string,
 *   notes?: string,
 *   occurredAt: string,
 * }} SaleEvent
 * @typedef {{ events: SaleEvent[] }} SalesEventLogData
 */

export const salesLoggerModule = {
  id: "sales_logger",
  label: "Sales Logger",
  description:
    "Record outgoing sales as timestamped events against entities. This is an event, not a state update. Produces a SalesEventLog for delta computation.",
  capabilities: ["log_sale_event"],
  modulePipelineType: "tracking",
  expectedContextVersion: 2,

  /** Consumes EntitySet produced by entity_registry */
  consumes: ["entity"],

  /** Produces SalesEventLog — an append-only event record */
  produces: [{ kind: "event", mode: "create" }],

  /** Engine kinds called by this module via runClaira() */
  engineKinds: ["addTrackingSnapshot"],

  // ---------------------------------------------------------------------------
  // Orchestration methods
  // ---------------------------------------------------------------------------

  /**
   * Build the payload for runClaira("addTrackingSnapshot", ...).
   * eventType: "sale" distinguishes this from state snapshots and delivery events.
   * moduleOptions.sales provides the user-entered sale records.
   *
   * @param {Record<string, import("../pipeline/runtimeArtifactStore.js").RuntimeArtifact[]>} consumedArtifacts
   * @param {Record<string, unknown>} [moduleOptions]
   * @returns {{ eventType: "sale", entries: unknown[], occurredAt: string }}
   */
  buildPayload(consumedArtifacts, moduleOptions = {}) {
    const entityArtifact = consumedArtifacts["entity"]?.at(-1);
    if (!entityArtifact) {
      throw new Error(
        "sales_logger: no entity artifact in store — entity_registry must run first",
      );
    }
    const sales = /** @type {unknown[]} */ (moduleOptions.sales ?? []);

    return {
      eventType: "sale",
      entries: sales,
      occurredAt: new Date().toISOString(),
    };
  },

  /**
   * Normalize the addTrackingSnapshot result (eventType: "sale") into a
   * SalesEventLog artifact payload.
   *
   * @param {{ addTrackingSnapshot: unknown }} engineResults
   * @returns {{ artifactType: "SalesEventLog", data: SalesEventLogData }}
   */
  normalizeToArtifacts(engineResults) {
    const result = /** @type {{ events?: SaleEvent[] }} */ (
      engineResults.addTrackingSnapshot ?? {}
    );
    return {
      artifactType: "SalesEventLog",
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

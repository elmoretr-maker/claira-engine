/**
 * ranking_engine — Engine-aware module (Phase 4+, plan.md §15 Module 8)
 *
 * Responsibility: Sort and rank entities by a configurable performance metric
 * (sales volume, net delta, velocity). Produces an ordered list.
 * Distinct from performance_classifier: ranking produces ORDER; classification
 * produces LABELS. These are separate modules.
 *
 * Engine capabilities:
 *   ❌ analyzePerformanceTrends  — DOES NOT EXIST in CLAIRA_RUN_HANDLERS
 *      Must be built and registered before this module can execute.
 *
 * Expected engine output shape:
 *   [{ entityId, label, rank, score }] sorted descending by score
 *
 * Artifact flow:
 *   consumes: analysis   (artifactType: "TrendReport"    — produced by trend_interpreter)
 *   produces: aggregate  (artifactType: "RankedEntities" — ordered entity list by score)
 *
 * Universal: products, clients, campaigns, assets — any entity set requiring
 * ranked output by a configurable metric.
 *
 * moduleOptions.rankBy: configures the sort metric (default: "velocity")
 *   Valid values: "velocity" | "netDelta" | "salesTotal"
 *
 * ⚠ BUILD PREREQUISITE: analyzePerformanceTrends handler + pipeline must exist before use.
 */

/**
 * @typedef {{ trends: import("./trendInterpreterModule.js").TrendSignal[] }} TrendReportData
 *
 * @typedef {{
 *   entityId: string,
 *   label:    string,
 *   rank:     number,
 *   score:    number,
 * }} RankedEntity
 *
 * @typedef {{ entities: RankedEntity[] }} RankedEntitiesData
 */

export const rankingEngineModule = {
  id: "ranking_engine",
  label: "Ranking Engine",
  description:
    "Sort and rank entities by a configurable performance metric. Produces an ordered list (rank, score). Distinct from performance_classifier which applies labels to ranked output.",
  capabilities: ["rank_entities"],
  modulePipelineType: "processing",
  expectedContextVersion: 2,

  /** Consumes TrendReport (analysis) produced by trend_interpreter */
  consumes: ["analysis"],

  /** Produces RankedEntities — an ordered aggregate of scored entities */
  produces: [{ kind: "aggregate", mode: "create" }],

  /**
   * Engine kinds called by this module via runClaira().
   * ❌ analyzePerformanceTrends does not exist yet — must be built in CLAIRA_RUN_HANDLERS.
   */
  engineKinds: ["analyzePerformanceTrends"],

  // ---------------------------------------------------------------------------
  // Orchestration methods
  // ---------------------------------------------------------------------------

  /**
   * Build the payload for runClaira("analyzePerformanceTrends", ...).
   *
   * Consumes the most recent TrendReport artifact.
   * moduleOptions.rankBy selects the sort metric.
   *
   * Payload shape (defined here; engine must accept this shape):
   * {
   *   trends:  TrendSignal[],
   *   rankBy:  "velocity" | "netDelta" | "salesTotal",
   * }
   *
   * @param {Record<string, import("../pipeline/runtimeArtifactStore.js").RuntimeArtifact[]>} consumedArtifacts
   * @param {Record<string, unknown>} [moduleOptions]
   * @returns {{ trends: unknown[], rankBy: string }}
   */
  buildPayload(consumedArtifacts, moduleOptions = {}) {
    const trendArtifact = consumedArtifacts["analysis"]?.at(-1);
    if (!trendArtifact || trendArtifact.artifactType !== "TrendReport") {
      throw new Error(
        "ranking_engine: no TrendReport artifact in store — trend_interpreter must run first",
      );
    }
    const trendData = /** @type {TrendReportData} */ (trendArtifact.data);

    const rankBy =
      typeof moduleOptions.rankBy === "string"
        ? moduleOptions.rankBy
        : "velocity";

    return {
      trends: trendData.trends ?? [],
      rankBy,
    };
  },

  /**
   * Normalize the analyzePerformanceTrends engine result into a RankedEntities artifact.
   *
   * ❌ ENGINE KIND NOT YET BUILT — this will not execute until analyzePerformanceTrends
   * is registered in CLAIRA_RUN_HANDLERS.
   *
   * @param {{ analyzePerformanceTrends: unknown }} engineResults
   * @returns {{ artifactType: "RankedEntities", data: RankedEntitiesData }}
   */
  normalizeToArtifacts(engineResults) {
    const result = /** @type {{ entities?: RankedEntity[] }} */ (
      engineResults.analyzePerformanceTrends ?? {}
    );
    return {
      artifactType: "RankedEntities",
      data: {
        entities: result.entities ?? [],
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

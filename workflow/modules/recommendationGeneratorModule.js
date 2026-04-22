/**
 * recommendation_generator — Engine-aware module (Phase 4+, plan.md §15 Module 11)
 *
 * Responsibility: Generate specific, actionable recommendations from alert
 * conditions and performance data. Produces a RecommendationSet.
 *
 * Engine capabilities:
 *   ❌ generateRecommendations  — DOES NOT EXIST in CLAIRA_RUN_HANDLERS
 *      Must be built and registered before this module can execute.
 *
 * Expected engine output shape (per recommendation):
 *   { entityId, label, action, urgency: "high" | "medium" | "low", reason }
 *
 * Artifact flow:
 *   consumes: aggregate  (artifactType: "AlertSet"        — produced by threshold_evaluator)
 *             aggregate  (artifactType: "RankedEntities"  — produced by ranking_engine)
 *   produces: deliverable (artifactType: "RecommendationSet" — actionable output for user)
 *
 * Universal: reorder, escalate, retire, promote — action types configurable via
 * moduleOptions.actionTypes.
 *
 * moduleOptions.actionTypes: string[]  — e.g. ["reorder", "promote", "retire"]
 *   Passed to the engine to filter or scope recommendation types.
 *
 * ⚠ BUILD PREREQUISITE: generateRecommendations handler + pipeline must exist before use.
 *
 * ⚠ WORKFLOW PREREQUISITE: threshold_evaluator must run before this module.
 *   threshold_evaluator is not yet defined in this file set — see plan.md §15 Module 10.
 */

/**
 * @typedef {{
 *   entityId:    string,
 *   alertType:   "low_stock" | "declining" | "critical",
 *   currentValue: number,
 *   threshold:   number,
 * }} AlertRecord
 * @typedef {{ alerts: AlertRecord[] }} AlertSetData
 *
 * @typedef {{ entities: import("./rankingEngineModule.js").RankedEntity[] }} RankedEntitiesData
 *
 * @typedef {{
 *   entityId: string,
 *   label:    string,
 *   action:   string,
 *   urgency:  "high" | "medium" | "low",
 *   reason:   string,
 * }} Recommendation
 *
 * @typedef {{ recommendations: Recommendation[] }} RecommendationSetData
 */

export const recommendationGeneratorModule = {
  id: "recommendation_generator",
  label: "Recommendation Generator",
  description:
    "Generate specific actionable recommendations from alert conditions and performance data. Action types are configurable (reorder, promote, retire). Produces a RecommendationSet deliverable.",
  capabilities: ["generate_recommendations"],
  modulePipelineType: "processing",
  expectedContextVersion: 2,

  /**
   * Consumes AlertSet + RankedEntities (both aggregate kind).
   * threshold_evaluator produces AlertSet; ranking_engine produces RankedEntities.
   */
  consumes: ["aggregate"],

  /** Produces RecommendationSet — a deliverable for user-facing action */
  produces: [{ kind: "deliverable", mode: "create" }],

  /**
   * Engine kinds called by this module via runClaira().
   * ❌ generateRecommendations does not exist yet — must be built in CLAIRA_RUN_HANDLERS.
   */
  engineKinds: ["generateRecommendations"],

  // ---------------------------------------------------------------------------
  // Orchestration methods
  // ---------------------------------------------------------------------------

  /**
   * Build the payload for runClaira("generateRecommendations", ...).
   *
   * Consumes the most recent AlertSet and RankedEntities artifacts.
   * Both are in the "aggregate" kind — distinguished by artifactType.
   *
   * Payload shape (defined here; engine must accept this shape):
   * {
   *   alerts:       AlertRecord[],
   *   rankedEntities: RankedEntity[],
   *   actionTypes?: string[],
   * }
   *
   * @param {Record<string, import("../pipeline/runtimeArtifactStore.js").RuntimeArtifact[]>} consumedArtifacts
   * @param {Record<string, unknown>} [moduleOptions]
   * @returns {{ alerts: unknown[], rankedEntities: unknown[], actionTypes?: string[] }}
   */
  buildPayload(consumedArtifacts, moduleOptions = {}) {
    const aggregates = consumedArtifacts["aggregate"] ?? [];

    // Find the most recent AlertSet and RankedEntities by artifactType.
    const alertArtifact = [...aggregates]
      .reverse()
      .find((a) => a.artifactType === "AlertSet");
    const rankedArtifact = [...aggregates]
      .reverse()
      .find((a) => a.artifactType === "RankedEntities");

    if (!alertArtifact) {
      throw new Error(
        "recommendation_generator: no AlertSet artifact in store — threshold_evaluator must run first",
      );
    }
    if (!rankedArtifact) {
      throw new Error(
        "recommendation_generator: no RankedEntities artifact in store — ranking_engine must run first",
      );
    }

    const alertData = /** @type {AlertSetData} */ (alertArtifact.data);
    const rankedData = /** @type {RankedEntitiesData} */ (rankedArtifact.data);

    return {
      alerts: alertData.alerts ?? [],
      rankedEntities: rankedData.entities ?? [],
      ...(Array.isArray(moduleOptions.actionTypes)
        ? { actionTypes: /** @type {string[]} */ (moduleOptions.actionTypes) }
        : {}),
    };
  },

  /**
   * Normalize the generateRecommendations engine result into a RecommendationSet artifact.
   *
   * ❌ ENGINE KIND NOT YET BUILT — this will not execute until generateRecommendations
   * is registered in CLAIRA_RUN_HANDLERS.
   *
   * @param {{ generateRecommendations: unknown }} engineResults
   * @returns {{ artifactType: "RecommendationSet", data: RecommendationSetData }}
   */
  normalizeToArtifacts(engineResults) {
    const result = /** @type {{ recommendations?: Recommendation[] }} */ (
      engineResults.generateRecommendations ?? {}
    );
    return {
      artifactType: "RecommendationSet",
      data: {
        recommendations: result.recommendations ?? [],
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

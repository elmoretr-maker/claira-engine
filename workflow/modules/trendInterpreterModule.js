/**
 * trend_interpreter — Engine-aware module (Phase 4+, plan.md §15 Module 7)
 *
 * Responsibility: Interpret raw numeric deltas into directional trend signals.
 * Distinct from state_delta_computer: that module produces NUMBERS; this module
 * produces MEANING (direction, velocity, periodCount).
 *
 * Engine capabilities:
 *   ❌ interpretTrends  — DOES NOT EXIST in CLAIRA_RUN_HANDLERS
 *      Must be built and registered before this module can execute.
 *
 * Expected engine output shape (per entity):
 *   { entityId, direction: "up" | "down" | "flat", velocity, periodCount }
 *
 * Artifact flow:
 *   consumes: analysis  (artifactType: "StateDelta"   — produced by state_delta_computer)
 *   produces: analysis  (artifactType: "TrendReport"  — directional trend signals)
 *
 * Universal: any domain where delta direction matters — inventory, fitness,
 * finances, client engagement, sales, any measurable quantity over time.
 *
 * ⚠ BUILD PREREQUISITE: interpretTrends handler + pipeline must exist before use.
 */

/**
 * @typedef {{ deltas: import("./stateDeltaComputerModule.js").EntityDelta[] }} StateDeltaData
 *
 * @typedef {{
 *   entityId:    string,
 *   direction:   "up" | "down" | "flat",
 *   velocity:    number,
 *   periodCount: number,
 * }} TrendSignal
 *
 * @typedef {{ trends: TrendSignal[] }} TrendReportData
 */

export const trendInterpreterModule = {
  id: "trend_interpreter",
  label: "Trend Interpreter",
  description:
    "Interpret raw delta values into directional trend signals (up / down / flat). Distinct from state_delta_computer which produces numbers. This module produces meaning.",
  capabilities: ["interpret_trends"],
  modulePipelineType: "processing",
  expectedContextVersion: 2,

  /** Consumes StateDelta (analysis) produced by state_delta_computer */
  consumes: ["analysis"],

  /** Produces TrendReport — interpreted directional trend signals */
  produces: [{ kind: "analysis", mode: "derive" }],

  /**
   * Engine kinds called by this module via runClaira().
   * ❌ interpretTrends does not exist yet — must be built in CLAIRA_RUN_HANDLERS.
   */
  engineKinds: ["interpretTrends"],

  // ---------------------------------------------------------------------------
  // Orchestration methods
  // ---------------------------------------------------------------------------

  /**
   * Build the payload for runClaira("interpretTrends", ...).
   *
   * Consumes the most recent StateDelta artifact.
   * moduleOptions may carry thresholds or window configuration.
   *
   * Payload shape (defined here; engine must accept this shape):
   * {
   *   deltas:           EntityDelta[],
   *   velocityWindow?:  number,   // optional: number of periods for velocity calc
   * }
   *
   * @param {Record<string, import("../pipeline/runtimeArtifactStore.js").RuntimeArtifact[]>} consumedArtifacts
   * @param {Record<string, unknown>} [moduleOptions]
   * @returns {{ deltas: unknown[], velocityWindow?: number }}
   */
  buildPayload(consumedArtifacts, moduleOptions = {}) {
    const deltaArtifact = consumedArtifacts["analysis"]?.at(-1);
    if (!deltaArtifact || deltaArtifact.artifactType !== "StateDelta") {
      throw new Error(
        "trend_interpreter: no StateDelta artifact in store — state_delta_computer must run first",
      );
    }
    const deltaData = /** @type {StateDeltaData} */ (deltaArtifact.data);

    return {
      deltas: deltaData.deltas ?? [],
      ...(typeof moduleOptions.velocityWindow === "number"
        ? { velocityWindow: moduleOptions.velocityWindow }
        : {}),
    };
  },

  /**
   * Normalize the interpretTrends engine result into a TrendReport artifact.
   *
   * ❌ ENGINE KIND NOT YET BUILT — this will not execute until interpretTrends
   * is registered in CLAIRA_RUN_HANDLERS.
   *
   * @param {{ interpretTrends: unknown }} engineResults
   * @returns {{ artifactType: "TrendReport", data: TrendReportData }}
   */
  normalizeToArtifacts(engineResults) {
    const result = /** @type {{ trends?: TrendSignal[] }} */ (
      engineResults.interpretTrends ?? {}
    );
    return {
      artifactType: "TrendReport",
      data: {
        trends: result.trends ?? [],
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

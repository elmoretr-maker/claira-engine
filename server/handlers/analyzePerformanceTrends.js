/**
 * analyzePerformanceTrends — pure engine handler function.
 *
 * Ranks entities by a selected performance metric, producing an ordered list
 * with explicit rank positions, scores, and forwarded direction for downstream use.
 *
 * Exported as a named function so it can be:
 *   1. Registered in CLAIRA_RUN_HANDLERS (server/index.js)
 *   2. Tested in isolation without server initialization
 *
 * This is a pure function. No API calls, no side effects, no store access.
 *
 * Algorithm:
 *   1. Validate rankBy — must be "velocity" | "netDelta" | "salesTotal".
 *   2. Extract the metric value for each entity.
 *      - "velocity"   → trend.velocity
 *      - "netDelta"   → trend.netDelta  (forwarded from interpretTrends)
 *      - "salesTotal" → trend.salesTotal (forwarded from interpretTrends)
 *   3. Guard: non-finite scores default to 0 (safe, not skipped — entity must appear in output).
 *   4. Sort descending — highest metric value = rank 1.
 *      Sort is stable (insertion-order preserved for equal scores) in Node.js >= 11.
 *   5. Assign standard competition ranks (1, 1, 3 for ties — not dense 1, 1, 2).
 *   6. score = the extracted metric value (raw, not normalized).
 *   7. label = entityId (no external label source at this layer).
 *   8. direction = forwarded unchanged from trend row for downstream recommendation use.
 *   9. label resolved from entityLabelMap if provided; falls back to entityId.
 *
 * Input shape:
 *   {
 *     trends:  Array<{
 *       entityId:    string,
 *       direction?:  string,
 *       velocity:    number,
 *       periodCount: number,
 *       netDelta:    number,
 *       salesTotal:  number,
 *     }>,
 *     rankBy?:         "velocity" | "netDelta" | "salesTotal",   // default: "velocity"
 *     entityLabelMap?: Record<string, string>,                    // optional human-readable labels
 *   }
 *
 * Output shape:
 *   {
 *     entities: Array<{
 *       entityId:  string,
 *       label:     string,    // entityLabelMap[entityId] ?? entityId
 *       rank:      number,    // integer >= 1
 *       score:     number,
 *       direction: string,    // forwarded from trend for generateRecommendations
 *     }>
 *   }
 */

const VALID_RANK_BY = /** @type {const} */ (["velocity", "netDelta", "salesTotal"]);

/**
 * @typedef {{
 *   entityId:    string,
 *   direction?:  string,
 *   velocity:    number,
 *   periodCount?: number,
 *   netDelta?:   number,
 *   salesTotal?: number,
 * }} TrendRow
 *
 * @typedef {{
 *   entityId:  string,
 *   label:     string,
 *   rank:      number,
 *   score:     number,
 *   direction: string,
 * }} RankedEntity
 */

/**
 * Rank entities by a selected performance metric.
 * Forwards direction for downstream recommendation generation.
 * Resolves human-readable labels from optional entityLabelMap.
 *
 * @param {{ trends: TrendRow[], rankBy?: string, entityLabelMap?: Record<string, string> }} body
 * @returns {{ entities: RankedEntity[] }}
 */
export function analyzePerformanceTrends(body) {
  if (!body || typeof body !== "object") {
    throw new Error("analyzePerformanceTrends: body must be an object");
  }

  const { trends, rankBy: rawRankBy, entityLabelMap } = body;

  // Validate entityLabelMap when provided — must be a plain object (not required).
  const labelMap = entityLabelMap != null && typeof entityLabelMap === "object" && !Array.isArray(entityLabelMap)
    ? /** @type {Record<string, string>} */ (entityLabelMap)
    : null;

  if (!Array.isArray(trends)) {
    throw new Error("analyzePerformanceTrends: trends must be an array");
  }

  const rankBy = rawRankBy != null ? String(rawRankBy) : "velocity";

  if (!VALID_RANK_BY.includes(/** @type {never} */ (rankBy))) {
    throw new Error(
      `analyzePerformanceTrends: rankBy must be one of ${VALID_RANK_BY.join(", ")} — got "${rankBy}"`,
    );
  }

  // ── Extract, score, and capture direction for each entity ─────────────────
  /** @type {Array<{ entityId: string, score: number, direction: string }>} */
  const scored = [];

  for (const trend of trends) {
    // Skip non-object entries silently.
    if (trend == null || typeof trend !== "object") continue;

    const entityId = String(trend.entityId ?? "").trim();
    if (!entityId) continue;

    let score;
    if (rankBy === "velocity") {
      score = Number(trend.velocity ?? 0);
    } else if (rankBy === "netDelta") {
      score = Number(trend.netDelta ?? 0);
    } else {
      score = Number(trend.salesTotal ?? 0);
    }

    // Non-finite score defaults to 0 — entity must still appear in ranked output.
    if (!Number.isFinite(score)) score = 0;

    // Forward direction unchanged; default to "unknown" if not provided.
    const direction = typeof trend.direction === "string" && trend.direction.length > 0
      ? trend.direction
      : "unknown";

    scored.push({ entityId, score, direction });
  }

  // ── Sort descending — highest score = rank 1.
  // Array.prototype.sort is stable in Node.js >= 11 (V8 7.0+): equal scores
  // preserve insertion order, making output deterministic for identical inputs.
  const sorted = [...scored].sort((a, b) => b.score - a.score);

  // ── Assign standard competition ranks (1, 1, 3 for ties, not 1, 1, 2) ─────
  /** @type {RankedEntity[]} */
  const entities = [];
  let currentRank = 1;

  for (let i = 0; i < sorted.length; i++) {
    const { entityId, score, direction } = sorted[i];

    // Advance rank to current position whenever score drops from the previous entry.
    if (i > 0 && sorted[i - 1].score !== score) {
      currentRank = i + 1;
    }

    // Resolve label: prefer entityLabelMap entry, fall back to entityId.
    const label = (labelMap && typeof labelMap[entityId] === "string" && labelMap[entityId].length > 0)
      ? labelMap[entityId]
      : entityId;

    entities.push({
      entityId,
      label,
      rank: currentRank,   // always integer >= 1
      score,
      direction,
    });
  }

  return { entities };
}

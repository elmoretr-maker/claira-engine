/**
 * analyzePerformanceTrends — pure engine handler function.
 *
 * Ranks entities by a selected performance metric, producing an ordered list
 * with explicit rank positions and scores. Input comes from interpretTrends.
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
 *      - "netDelta"   → trend.netDelta  (pass-through from delta, if present)
 *      - "salesTotal" → trend.salesTotal (pass-through from delta, if present)
 *   3. Sort descending — highest metric value = rank 1.
 *   4. Assign rank by position (1-based). Ties receive equal rank; next non-tied
 *      entity gets the rank it would hold if ties hadn't existed (dense ranking
 *      is NOT used — standard competition ranking: 1,1,3 not 1,1,2).
 *   5. score = the extracted metric value (raw, not normalized).
 *   6. label = entity id (no external label source available at this layer).
 *
 * Input shape:
 *   {
 *     trends:  Array<{ entityId, direction, velocity, periodCount, netDelta?, salesTotal? }>,
 *     rankBy?: "velocity" | "netDelta" | "salesTotal"   // default: "velocity"
 *   }
 *
 * Output shape:
 *   {
 *     entities: Array<{
 *       entityId: string,
 *       label:    string,   // same as entityId — no label source at this layer
 *       rank:     number,
 *       score:    number,
 *     }>
 *   }
 */

const VALID_RANK_BY = /** @type {const} */ (["velocity", "netDelta", "salesTotal"]);

/**
 * @typedef {{ entityId: string, direction?: string, velocity: number, periodCount?: number, netDelta?: number, salesTotal?: number }} TrendRow
 *
 * @typedef {{ entityId: string, label: string, rank: number, score: number }} RankedEntity
 */

/**
 * Rank entities by a selected performance metric.
 *
 * @param {{ trends: TrendRow[], rankBy?: string }} body
 * @returns {{ entities: RankedEntity[] }}
 */
export function analyzePerformanceTrends(body) {
  if (!body || typeof body !== "object") {
    throw new Error("analyzePerformanceTrends: body must be an object");
  }

  const { trends, rankBy: rawRankBy } = body;

  if (!Array.isArray(trends)) {
    throw new Error("analyzePerformanceTrends: trends must be an array");
  }

  const rankBy = rawRankBy != null ? String(rawRankBy) : "velocity";

  if (!VALID_RANK_BY.includes(/** @type {never} */ (rankBy))) {
    throw new Error(
      `analyzePerformanceTrends: rankBy must be one of ${VALID_RANK_BY.join(", ")} — got "${rankBy}"`,
    );
  }

  // ── Extract and score each entity ──────────────────────────────────────────
  /** @type {Array<{ entityId: string, score: number }>} */
  const scored = [];

  for (const trend of trends) {
    if (trend == null || typeof trend !== "object") continue;

    const entityId = String(trend.entityId ?? "").trim();
    if (!entityId) continue;

    let score;
    if (rankBy === "velocity") {
      score = Number(trend.velocity ?? 0);
    } else if (rankBy === "netDelta") {
      score = Number(trend.netDelta ?? 0);
    } else {
      // salesTotal
      score = Number(trend.salesTotal ?? 0);
    }

    if (!Number.isFinite(score)) score = 0;

    scored.push({ entityId, score });
  }

  // ── Sort descending — highest score = rank 1 ─────────────────────────────
  const sorted = [...scored].sort((a, b) => b.score - a.score);

  // ── Assign standard competition ranks (1, 1, 3 for ties, not 1, 1, 2) ────
  /** @type {RankedEntity[]} */
  const entities = [];
  let currentRank = 1;

  for (let i = 0; i < sorted.length; i++) {
    const { entityId, score } = sorted[i];

    // If this entity's score is lower than the previous, advance rank
    // to account for the number of entities that outranked it.
    if (i > 0 && sorted[i - 1].score !== score) {
      currentRank = i + 1;
    }

    entities.push({
      entityId,
      label: entityId,
      rank: currentRank,
      score,
    });
  }

  return { entities };
}

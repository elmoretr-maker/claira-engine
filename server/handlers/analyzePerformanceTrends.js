/**
 * analyzePerformanceTrends — pure engine handler function.
 *
 * Ranks entities by a selected performance metric with a fully deterministic
 * multi-field tie-breaking strategy. All ties are broken — every entity
 * receives a unique, strictly sequential rank.
 *
 * Exported as a named function so it can be:
 *   1. Registered in CLAIRA_RUN_HANDLERS (server/index.js)
 *   2. Tested in isolation without server initialization
 *
 * This is a pure function. No API calls, no side effects, no store access.
 *
 * Algorithm:
 *   1. Validate rankBy — must be "velocity" | "netDelta" | "salesTotal".
 *   2. Extract the primary metric score for each entity.
 *      Capture velocity and salesTotal as tie-breaker fields regardless of rankBy.
 *   3. Sort using a fully deterministic 5-level comparator (see below).
 *   4. Assign strictly sequential ranks: 1, 2, 3 … (no shared ranks).
 *   5. Compute tieBreakReason per entity: explains which criteria determined
 *      the entity's position relative to the entity immediately above it.
 *   6. Resolve label from entityLabelMap if provided; falls back to entityId.
 *   7. Forward direction unchanged for downstream recommendation use.
 *
 * Comparator levels (descending priority):
 *   1. score          — primary metric, descending (higher = better)
 *   2. direction      — "up" (2) > "flat" (1) > "down"/"unknown" (0), descending
 *   3. velocity       — descending
 *   4. salesTotal     — descending
 *   5. entityId       — ascending (alphabetical; deterministic stable fallback)
 *
 * Input shape:
 *   {
 *     trends:  Array<{
 *       entityId:    string,
 *       direction?:  string,
 *       velocity?:   number,
 *       netDelta?:   number,
 *       salesTotal?: number,
 *       periodCount?: number,
 *     }>,
 *     rankBy?:         "velocity" | "netDelta" | "salesTotal",   // default: "velocity"
 *     entityLabelMap?: Record<string, string>,                    // optional human-readable labels
 *   }
 *
 * Output shape:
 *   {
 *     entities: Array<{
 *       entityId:       string,
 *       label:          string,     // entityLabelMap[entityId] ?? entityId
 *       rank:           number,     // strictly sequential integer >= 1; no ties
 *       score:          number,
 *       direction:      string,
 *       tieBreakReason: string[],   // criteria chain that determined this position
 *     }>
 *   }
 */

const VALID_RANK_BY = /** @type {const} */ (["velocity", "netDelta", "salesTotal"]);

/** Direction priority for tie-breaking: higher = ranked better. */
const DIRECTION_PRIORITY = Object.freeze({ up: 2, flat: 1, down: 0, unknown: 0 });

/**
 * @typedef {{
 *   entityId:    string,
 *   direction?:  string,
 *   velocity?:   number,
 *   netDelta?:   number,
 *   salesTotal?: number,
 * }} TrendRow
 *
 * @typedef {{
 *   entityId:       string,
 *   label:          string,
 *   rank:           number,
 *   score:          number,
 *   direction:      string,
 *   tieBreakReason: string[],
 * }} RankedEntity
 *
 * @typedef {{
 *   entityId:  string,
 *   score:     number,
 *   direction: string,
 *   velocity:  number,
 *   salesTotal: number,
 * }} ScoredRow
 */

/**
 * 5-level deterministic comparator.
 * Returns negative if a should rank before b, positive if b before a.
 *
 * @param {ScoredRow} a
 * @param {ScoredRow} b
 * @returns {number}
 */
function compareEntities(a, b) {
  // Level 1 — primary score, descending
  if (b.score !== a.score) return b.score - a.score;

  // Level 2 — direction priority, descending ("up" > "flat" > "down")
  const da = DIRECTION_PRIORITY[/** @type {keyof typeof DIRECTION_PRIORITY} */ (a.direction)] ?? 0;
  const db = DIRECTION_PRIORITY[/** @type {keyof typeof DIRECTION_PRIORITY} */ (b.direction)] ?? 0;
  if (db !== da) return db - da;

  // Level 3 — velocity, descending
  if (b.velocity !== a.velocity) return b.velocity - a.velocity;

  // Level 4 — salesTotal, descending
  if (b.salesTotal !== a.salesTotal) return b.salesTotal - a.salesTotal;

  // Level 5 — entityId, ascending (stable alphabetical fallback)
  return a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0;
}

/**
 * Build the tieBreakReason array for entity at position i relative to
 * the entity at position i-1 (previous). Returns [] for the rank-1 entity.
 *
 * The array contains the chain of criteria checked in order. Criteria
 * that were equal contribute a "tied X" entry; the first criterion that
 * differed contributes the deciding entry, then the array ends.
 *
 * @param {ScoredRow} current
 * @param {ScoredRow | null} previous
 * @returns {string[]}
 */
function computeTieBreakReason(current, previous) {
  // First entity — no prior comparison.
  if (previous === null) return [];

  const reasons = [];

  // Level 1: score
  if (current.score !== previous.score) {
    reasons.push("score");
    return reasons;
  }
  reasons.push("tied score");

  // Level 2: direction priority
  const dc = DIRECTION_PRIORITY[/** @type {keyof typeof DIRECTION_PRIORITY} */ (current.direction)]  ?? 0;
  const dp = DIRECTION_PRIORITY[/** @type {keyof typeof DIRECTION_PRIORITY} */ (previous.direction)] ?? 0;
  if (dc !== dp) {
    reasons.push("direction priority");
    return reasons;
  }
  reasons.push("tied direction");

  // Level 3: velocity
  if (current.velocity !== previous.velocity) {
    reasons.push("velocity");
    return reasons;
  }
  reasons.push("tied velocity");

  // Level 4: salesTotal
  if (current.salesTotal !== previous.salesTotal) {
    reasons.push("salesTotal");
    return reasons;
  }
  reasons.push("tied salesTotal");

  // Level 5: entityId (always breaks the tie — final fallback)
  reasons.push("entityId");
  return reasons;
}

/**
 * Rank entities by a selected performance metric with deterministic tie-breaking.
 * Every entity receives a unique, strictly sequential rank.
 *
 * @param {{ trends: TrendRow[], rankBy?: string, entityLabelMap?: Record<string, string> }} body
 * @returns {{ entities: RankedEntity[] }}
 */
export function analyzePerformanceTrends(body) {
  if (!body || typeof body !== "object") {
    throw new Error("analyzePerformanceTrends: body must be an object");
  }

  const { trends, rankBy: rawRankBy, entityLabelMap } = body;

  // Validate entityLabelMap — must be a plain object when provided.
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

  // ── Extract primary score + tie-breaker fields for each entity ─────────────
  /** @type {ScoredRow[]} */
  const scored = [];

  for (const trend of trends) {
    if (trend == null || typeof trend !== "object") continue;

    const entityId = String(trend.entityId ?? "").trim();
    if (!entityId) continue;

    // Primary ranking metric
    let score;
    if (rankBy === "velocity") {
      score = Number(trend.velocity ?? 0);
    } else if (rankBy === "netDelta") {
      score = Number(trend.netDelta ?? 0);
    } else {
      score = Number(trend.salesTotal ?? 0);
    }
    if (!Number.isFinite(score)) score = 0;

    // Direction — forwarded and used as tie-breaker level 2
    const direction = typeof trend.direction === "string" && trend.direction.length > 0
      ? trend.direction
      : "unknown";

    // Velocity and salesTotal — captured for tie-breaking regardless of rankBy
    const rawVelocity   = Number(trend.velocity   ?? 0);
    const rawSalesTotal = Number(trend.salesTotal  ?? 0);
    const velocity   = Number.isFinite(rawVelocity)   ? rawVelocity   : 0;
    const salesTotal = Number.isFinite(rawSalesTotal) ? rawSalesTotal : 0;

    scored.push({ entityId, score, direction, velocity, salesTotal });
  }

  // ── Sort using 5-level deterministic comparator ───────────────────────────
  // Result: no two entities occupy the same position — all ties are broken.
  const sorted = [...scored].sort(compareEntities);

  // ── Assign strictly sequential ranks (1, 2, 3 …) and compute reasons ──────
  /** @type {RankedEntity[]} */
  const entities = sorted.map((item, i) => {
    const previous = i > 0 ? sorted[i - 1] : null;
    const tieBreakReason = computeTieBreakReason(item, previous);

    const label = (labelMap && typeof labelMap[item.entityId] === "string" && labelMap[item.entityId].length > 0)
      ? labelMap[item.entityId]
      : item.entityId;

    return {
      entityId:       item.entityId,
      label,
      rank:           i + 1,  // strictly sequential — no shared ranks
      score:          item.score,
      direction:      item.direction,
      tieBreakReason,
    };
  });

  return { entities };
}

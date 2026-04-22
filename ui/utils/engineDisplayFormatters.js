/**
 * engineDisplayFormatters.js
 *
 * Converts raw engine pipeline output fields into human-readable UI values.
 * Pure JS — no React dependency. Safe to import in any component or test.
 *
 * Covers all fields produced by the four pipeline stages:
 *   Stage 1: computeStateDelta   → startValue, endValue, netDelta, deliveryTotal, salesTotal, timeRange
 *   Stage 2: interpretTrends     → direction, velocity, velocityPerTime, periodCount
 *   Stage 3: analyzePerformanceTrends → rank, score, tieBreakReason
 *   Stage 4: generateRecommendations  → action, urgency, reason, alertCount, percentile
 */

// ── Time constants ────────────────────────────────────────────────────────────

const MS_PER_DAY  = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

// ── Urgency sort map ──────────────────────────────────────────────────────────

/** Lower number = higher priority. Used for sort. */
export const URGENCY_ORDER = Object.freeze({
  critical: 0,
  high:     1,
  medium:   2,
  low:      3,
});

// ── Stage 2 formatters ────────────────────────────────────────────────────────

/**
 * Convert velocityPerTime (units per millisecond) to a human-readable per-day string.
 * Returns "—" for zero or non-finite inputs.
 *
 * @param {number} velocityPerTime - raw engine output (units / ms)
 * @returns {string}
 */
export function formatVelocityPerDay(velocityPerTime) {
  if (!Number.isFinite(velocityPerTime) || velocityPerTime === 0) return "—";
  const perDay = velocityPerTime * MS_PER_DAY;
  if (perDay >= 1000) return `${Math.round(perDay).toLocaleString()} / day`;
  if (perDay >= 100)  return `${Math.round(perDay)} / day`;
  if (perDay >= 10)   return `${perDay.toFixed(1)} / day`;
  return `${perDay.toFixed(2)} / day`;
}

/**
 * Format velocity with directional context: "↑ Gaining 0.83/day", "↓ Losing 1.65/day", "→ Stable".
 *
 * FIX 2: replaces bare "1.65 / day" with action-oriented phrasing.
 *
 * @param {number} velocityPerTime - raw engine output (units / ms)
 * @param {string} direction       - "up" | "down" | "flat"
 * @returns {string}
 */
export function formatDirectionalVelocity(velocityPerTime, direction) {
  // Flat or zero → always "Stable" regardless of velocityPerTime sign
  if (direction === "flat" || !Number.isFinite(velocityPerTime) || velocityPerTime === 0) {
    return "→ Stable";
  }

  const perDay = Math.abs(velocityPerTime) * MS_PER_DAY;
  let valueStr;
  if (perDay >= 1000) valueStr = `${Math.round(perDay).toLocaleString()}/day`;
  else if (perDay >= 100) valueStr = `${Math.round(perDay)}/day`;
  else if (perDay >= 10)  valueStr = `${perDay.toFixed(1)}/day`;
  else                    valueStr = `${perDay.toFixed(2)}/day`;

  if (direction === "up")   return `↑ Gaining ${valueStr}`;
  if (direction === "down") return `↓ Losing ${valueStr}`;
  // Fallback: unknown direction but non-zero velocity
  return valueStr;
}

/**
 * Convert velocityPerTime (units per ms) to a human-readable per-week string.
 * Useful as a secondary metric for slow-moving entities.
 *
 * @param {number} velocityPerTime
 * @returns {string}
 */
export function formatVelocityPerWeek(velocityPerTime) {
  if (!Number.isFinite(velocityPerTime) || velocityPerTime === 0) return "—";
  const perWeek = velocityPerTime * MS_PER_WEEK;
  if (perWeek >= 1000) return `${Math.round(perWeek).toLocaleString()} / wk`;
  if (perWeek >= 10)   return `${Math.round(perWeek)} / wk`;
  return `${perWeek.toFixed(1)} / wk`;
}

// ── Stage 1 / time formatters ─────────────────────────────────────────────────

/**
 * Convert durationMs to a human-readable duration string.
 *
 * @param {number | null | undefined} durationMs
 * @returns {string}
 */
export function formatDurationDays(durationMs) {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) return "—";
  if (durationMs === 0) return "same day";
  const days = Math.round(durationMs / MS_PER_DAY);
  if (days === 0) return "< 1 day";
  if (days === 1) return "1 day";
  if (days < 7)   return `${days} days`;
  const weeks = Math.round(days / 7);
  return weeks === 1 ? "1 week" : `${weeks} weeks`;
}

/**
 * Format an ISO 8601 timestamp as a locale-appropriate date string.
 * Returns "—" if the string is absent or invalid.
 *
 * @param {string | null | undefined} isoString
 * @returns {string}
 */
export function formatDate(isoString) {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

// ── Stage 3 formatters ────────────────────────────────────────────────────────

/**
 * Derive a performance tier label from a percentile value.
 * Optionally append "#N of M" position badge.
 *
 * Tiers:
 *   percentile ≤ 0.25 → "Top Performer"
 *   percentile ≤ 0.50 → "Mid Tier"
 *   percentile ≤ 0.75 → "At Risk"
 *   percentile > 0.75 → "Critical"
 *
 * @param {number} percentile - 0.0 to 1.0 (rank / totalEntities)
 * @param {{ rank?: number, total?: number }} [opts]
 * @returns {{ tier: "Top Performer" | "Mid Tier" | "At Risk" | "Critical", badge: string }}
 */
export function formatRankLabel(percentile, opts = {}) {
  let tier;
  if (!Number.isFinite(percentile)) {
    tier = /** @type {const} */ ("Mid Tier");
  } else if (percentile <= 0.25) {
    tier = /** @type {const} */ ("Top Performer");
  } else if (percentile <= 0.5) {
    tier = /** @type {const} */ ("Mid Tier");
  } else if (percentile <= 0.75) {
    tier = /** @type {const} */ ("At Risk");
  } else {
    tier = /** @type {const} */ ("Critical");
  }

  const { rank, total } = opts;
  const badge = rank != null && total != null ? `#${rank} of ${total}` : "";
  return { tier, badge };
}

/**
 * Convert tieBreakReason array to a readable tooltip string.
 *
 * @param {string[]} reasons
 * @returns {string}
 */
export function formatTieBreakReason(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) return "Ranked by primary score";
  return `Ranked by: ${reasons.join(" → ")}`;
}

// ── Stage 4 formatters ────────────────────────────────────────────────────────

/**
 * Format urgency value to a title-case label.
 *
 * @param {"critical"|"high"|"medium"|"low"|string} urgency
 * @returns {string}
 */
export function formatUrgencyLabel(urgency) {
  switch (urgency) {
    case "critical": return "Critical";
    case "high":     return "High";
    case "medium":   return "Medium";
    case "low":      return "Low";
    default:         return String(urgency ?? "—");
  }
}

/**
 * Format an action value to a display-friendly label.
 *
 * @param {"reorder"|"promote"|"investigate"|"monitor"|string} action
 * @returns {string}
 */
export function formatActionLabel(action) {
  switch (action) {
    case "reorder":     return "Reorder";
    case "promote":     return "Promote";
    case "investigate": return "Investigate";
    case "monitor":     return "Monitor";
    default:            return String(action ?? "—");
  }
}

/**
 * Derive a short, user-facing impact summary from the recommendation reason.
 * Strips internal jargon and capitalizes the first sentence.
 *
 * @param {string} reason
 * @returns {string}
 */
export function formatImpactSummary(reason) {
  if (!reason || typeof reason !== "string") return "";
  // Capitalize first letter, ensure it ends with a period.
  const trimmed = reason.trim();
  if (!trimmed) return "";
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return capitalized.endsWith(".") ? capitalized : `${capitalized}.`;
}

// ── Sorting & grouping ────────────────────────────────────────────────────────

/**
 * Sort merged entity records by urgency (critical → high → medium → low) then rank.
 * Returns a new array — does not mutate input.
 *
 * @template {{ urgency: string, rank: number }} T
 * @param {T[]} entities
 * @returns {T[]}
 */
export function sortByUrgencyThenRank(entities) {
  return [...entities].sort((a, b) => {
    const ua = URGENCY_ORDER[/** @type {keyof typeof URGENCY_ORDER} */ (a.urgency)] ?? 4;
    const ub = URGENCY_ORDER[/** @type {keyof typeof URGENCY_ORDER} */ (b.urgency)] ?? 4;
    if (ua !== ub) return ua - ub;
    return a.rank - b.rank;
  });
}

/**
 * Group entities into the three ActionQueue tiers.
 *
 * FIX 5: Within each tier, entities are sorted by:
 *   1. urgency priority (critical before high inside "Act Now")
 *   2. velocity descending  — faster-moving entities shown first
 *   3. alertCount descending — more alerts = higher priority within same velocity
 *
 * @template {{ urgency: string, velocity?: number, alertCount?: number }} T
 * @param {T[]} entities - already sorted by sortByUrgencyThenRank
 * @returns {{ actNow: T[], monitor: T[], performingWell: T[] }}
 */
export function groupByActionTier(entities) {
  /** @type {T[]} */ const actNow         = [];
  /** @type {T[]} */ const monitor        = [];
  /** @type {T[]} */ const performingWell = [];

  for (const e of entities) {
    if (e.urgency === "critical" || e.urgency === "high") actNow.push(e);
    else if (e.urgency === "medium") monitor.push(e);
    else performingWell.push(e);
  }

  /** @param {T[]} arr @returns {T[]} */
  function sortTier(arr) {
    return [...arr].sort((a, b) => {
      const ua = URGENCY_ORDER[/** @type {keyof typeof URGENCY_ORDER} */ (a.urgency)] ?? 4;
      const ub = URGENCY_ORDER[/** @type {keyof typeof URGENCY_ORDER} */ (b.urgency)] ?? 4;
      if (ua !== ub) return ua - ub;
      const va = Number(a.velocity ?? 0);
      const vb = Number(b.velocity ?? 0);
      if (vb !== va) return vb - va;
      return Number(b.alertCount ?? 0) - Number(a.alertCount ?? 0);
    });
  }

  return {
    actNow:         sortTier(actNow),
    monitor:        sortTier(monitor),
    performingWell: sortTier(performingWell),
  };
}

// ── Data merge helper ─────────────────────────────────────────────────────────

/**
 * Merge the four pipeline stage outputs into a single flat record per entity.
 *
 * The caller passes:
 *   trends          — Stage 2 output  (interpretTrends)
 *   rankedEntities  — Stage 3 output  (analyzePerformanceTrends)
 *   recommendations — Stage 4 output  (generateRecommendations)
 *
 * Stage 1 fields (startValue, endValue, etc.) are forwarded through Stage 2.
 *
 * @param {object[]} trends          - TrendRow[]
 * @param {object[]} rankedEntities  - RankedEntity[]
 * @param {object[]} recommendations - Recommendation[]
 * @returns {import("./entityTypes.js").MergedEntity[]}
 */
export function mergeEntityPipelineData(trends, rankedEntities, recommendations) {
  // Index by entityId for O(1) lookup
  /** @type {Map<string, Record<string, unknown>>} */
  const trendMap = new Map(trends.map((t) => [String(t?.entityId ?? ""), /** @type {Record<string, unknown>} */ (t)]));
  /** @type {Map<string, Record<string, unknown>>} */
  const recMap   = new Map(recommendations.map((r) => [String(r?.entityId ?? ""), /** @type {Record<string, unknown>} */ (r)]));

  /** @type {import("./entityTypes.js").MergedEntity[]} */
  const merged = [];

  for (const ranked of rankedEntities) {
    const r = /** @type {Record<string, unknown>} */ (ranked);
    const id = String(r.entityId ?? "");
    if (!id) continue;

    const trend = trendMap.get(id) ?? {};
    const rec   = recMap.get(id)   ?? {};

    merged.push({
      // Identity
      entityId: id,
      label:    String(r.label ?? id),

      // Ranking (Stage 3)
      rank:           Number(r.rank   ?? 0),
      score:          Number(r.score  ?? 0),
      tieBreakReason: Array.isArray(r.tieBreakReason) ? /** @type {string[]} */ (r.tieBreakReason) : [],

      // Trend (Stage 2 — includes forwarded Stage 1 fields)
      direction:       String(trend.direction ?? r.direction ?? "unknown"),
      velocity:        Number(trend.velocity  ?? 0),
      velocityPerTime: Number(trend.velocityPerTime ?? 0),
      periodCount:     Number(trend.periodCount ?? 0),
      netDelta:        Number(trend.netDelta   ?? 0),
      salesTotal:      Number(trend.salesTotal ?? 0),
      startValue:      Number(trend.startValue ?? 0),
      endValue:        Number(trend.endValue   ?? 0),
      deliveryTotal:   Number(trend.deliveryTotal ?? 0),
      timeRange:       trend.timeRange && typeof trend.timeRange === "object"
        ? /** @type {{ startTimestamp: string, endTimestamp: string, durationMs: number }} */ (trend.timeRange)
        : null,

      // Recommendation (Stage 4)
      action:     String(rec.action   ?? "monitor"),
      urgency:    String(rec.urgency  ?? "low"),
      reason:     String(rec.reason   ?? ""),
      alertCount: Number(rec.alertCount ?? 0),
      percentile: Number(rec.percentile ?? (r.rank != null && rankedEntities.length > 0
        ? Number(r.rank) / rankedEntities.length
        : 0.5)),
    });
  }

  return merged;
}

// ── Sample data (development / Storybook use only) ───────────────────────────

/**
 * Sample merged entity records for UI development.
 * Import directly when no real pipeline data is available.
 *
 * @type {ReturnType<typeof mergeEntityPipelineData>}
 */
export const SAMPLE_ENTITIES = [
  {
    entityId: "oxford-classic",  label: "Oxford Classic",
    rank: 1, score: 35, tieBreakReason: [],
    direction: "down", velocity: 35, velocityPerTime: 35 / 2_592_000_000, periodCount: 3,
    netDelta: -35, salesTotal: 55, startValue: 100, endValue: 65,
    deliveryTotal: 12, timeRange: { startTimestamp: "2026-04-01T00:00:00Z", endTimestamp: "2026-04-26T00:00:00Z", durationMs: 2_592_000_000 },
    action: "reorder", urgency: "high", reason: "Declining inventory with multiple low-stock alerts; ranked in bottom 33%.", alertCount: 2, percentile: 0.33,
  },
  {
    entityId: "running-sneaker", label: "Running Sneaker",
    rank: 2, score: 25, tieBreakReason: ["score"],
    direction: "up", velocity: 25, velocityPerTime: 25 / 2_592_000_000, periodCount: 3,
    netDelta: 25, salesTotal: 30, startValue: 80, endValue: 105,
    deliveryTotal: 50, timeRange: { startTimestamp: "2026-04-01T00:00:00Z", endTimestamp: "2026-04-26T00:00:00Z", durationMs: 2_592_000_000 },
    action: "promote", urgency: "low", reason: "Strong upward trend; highest velocity in the set.", alertCount: 0, percentile: 0.17,
  },
  {
    entityId: "chelsea-boot",    label: "Chelsea Boot",
    rank: 3, score: 0, tieBreakReason: ["score"],
    direction: "flat", velocity: 0, velocityPerTime: 0, periodCount: 2,
    netDelta: 0, salesTotal: 8, startValue: 45, endValue: 45,
    deliveryTotal: 8, timeRange: { startTimestamp: "2026-04-01T00:00:00Z", endTimestamp: "2026-04-15T00:00:00Z", durationMs: 1_209_600_000 },
    action: "monitor", urgency: "medium", reason: "No net movement; low sales velocity suggests stagnation.", alertCount: 1, percentile: 0.5,
  },
  {
    entityId: "hiking-boot",     label: "Hiking Boot",
    rank: 4, score: 0, tieBreakReason: ["tied score", "direction priority"],
    direction: "down", velocity: 5, velocityPerTime: 5 / 2_592_000_000, periodCount: 2,
    netDelta: -5, salesTotal: 12, startValue: 60, endValue: 55,
    deliveryTotal: 7, timeRange: { startTimestamp: "2026-04-01T00:00:00Z", endTimestamp: "2026-04-26T00:00:00Z", durationMs: 2_592_000_000 },
    action: "investigate", urgency: "critical", reason: "Ranked bottom 25% with declining stock and no restock activity; alert threshold exceeded.", alertCount: 3, percentile: 0.83,
  },
  {
    entityId: "slip-on-loafer",  label: "Slip-on Loafer",
    rank: 5, score: 0, tieBreakReason: ["tied score", "tied direction", "velocity"],
    direction: "up", velocity: 3, velocityPerTime: 3 / 2_592_000_000, periodCount: 2,
    netDelta: 3, salesTotal: 5, startValue: 30, endValue: 33,
    deliveryTotal: 8, timeRange: { startTimestamp: "2026-04-08T00:00:00Z", endTimestamp: "2026-04-26T00:00:00Z", durationMs: 1_555_200_000 },
    action: "monitor", urgency: "low", reason: "Slight positive movement; insufficient data for promotion decision.", alertCount: 0, percentile: 0.42,
  },
  {
    entityId: "platform-wedge",  label: "Platform Wedge",
    rank: 6, score: 0, tieBreakReason: ["tied score", "tied direction", "tied velocity", "salesTotal"],
    direction: "flat", velocity: 0, velocityPerTime: 0, periodCount: 2,
    netDelta: 0, salesTotal: 2, startValue: 20, endValue: 20,
    deliveryTotal: 2, timeRange: { startTimestamp: "2026-04-08T00:00:00Z", endTimestamp: "2026-04-26T00:00:00Z", durationMs: 1_555_200_000 },
    action: "investigate", urgency: "medium", reason: "No movement and very low sales volume may indicate demand gap.", alertCount: 0, percentile: 0.67,
  },
];

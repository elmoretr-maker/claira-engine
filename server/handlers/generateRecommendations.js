/**
 * generateRecommendations — pure engine handler function.
 *
 * Combines alert signals and ranking positions into actionable recommendations
 * for each entity. This is the final processing step in the shoe-store workflow
 * (plan.md §15, module: recommendation_generator).
 *
 * Exported as a named function so it can be:
 *   1. Registered in CLAIRA_RUN_HANDLERS (server/index.js)
 *   2. Tested in isolation without server initialization
 *
 * This is a pure function. No API calls, no side effects, no store access.
 *
 * Decision logic (rule-based):
 *   For each ranked entity:
 *   1. Collect ALL alerts for the entity (multi-alert support).
 *      - severity = highest severity across all alerts
 *      - alertCount = number of matching alerts
 *   2. Derive action:
 *      - Alert present AND direction "down"/"flat" → "reorder" (if in actionTypes)
 *                                                  → "investigate" (fallback)
 *      - Alert present AND direction "up"          → "investigate"
 *      - No alert, rank = 1, direction "up"        → "promote"
 *      - No alert, bottom performer (percentile >= 0.8), direction "down"/"flat" → "investigate"
 *      - Otherwise                                 → "monitor"
 *   3. Urgency (percentile-based — stable across dataset size):
 *      - "critical" — alert.severity === "critical" OR (direction "down" AND percentile >= 0.8)
 *      - "high"     — alert present (non-critical) OR (percentile > 0.5 AND direction "down")
 *      - "medium"   — percentile > 0.5 OR direction "flat"
 *      - "low"      — otherwise
 *   4. Reason: human-readable explanation of the decision.
 *
 * Input shape:
 *   {
 *     alerts:         Array<{ entityId, severity?, message? }>,
 *     rankedEntities: Array<{ entityId, label, rank, score, direction? }>,
 *     actionTypes?:   Array<"reorder" | "promote" | "retire" | "investigate" | "monitor">
 *   }
 *
 * Output shape:
 *   {
 *     recommendations: Array<{
 *       entityId:   string,
 *       label:      string,
 *       action:     string,
 *       urgency:    "critical" | "high" | "medium" | "low",
 *       reason:     string,
 *       alertCount: number,   // number of alerts matching this entity (0 if none)
 *       percentile: number,   // rank / totalEntities (0–1, stable across dataset sizes)
 *     }>
 *   }
 */

const DEFAULT_ACTION_TYPES = /** @type {const} */ (["reorder", "promote", "retire", "investigate", "monitor"]);

/** Numeric rank for severity comparison — higher = more severe. */
const SEVERITY_RANK = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });

/**
 * @typedef {{ entityId: string, severity?: string, message?: string }} AlertRow
 * @typedef {{ entityId: string, label: string, rank: number, score: number, direction?: string }} RankedEntity
 * @typedef {{
 *   entityId:   string,
 *   label:      string,
 *   action:     string,
 *   urgency:    "critical" | "high" | "medium" | "low",
 *   reason:     string,
 *   alertCount: number,
 *   percentile: number,
 * }} Recommendation
 */

/**
 * Return the highest severity string across all alerts for an entity.
 * Returns undefined if alerts list is empty.
 *
 * @param {AlertRow[]} alerts
 * @returns {string | undefined}
 */
function highestSeverity(alerts) {
  let best = /** @type {string | undefined} */ (undefined);
  let bestRank = -1;
  for (const a of alerts) {
    const sev  = typeof a.severity === "string" ? a.severity.toLowerCase() : "";
    const rank = SEVERITY_RANK[/** @type {keyof typeof SEVERITY_RANK} */ (sev)] ?? 0;
    if (rank > bestRank) { bestRank = rank; best = sev || undefined; }
  }
  return best;
}

/**
 * Return the first non-empty message from an array of alerts.
 *
 * @param {AlertRow[]} alerts
 * @returns {string | undefined}
 */
function firstMessage(alerts) {
  for (const a of alerts) {
    if (typeof a.message === "string" && a.message.trim()) return a.message.trim();
  }
  return undefined;
}

/**
 * Check if an action is permitted given the resolved actionTypes list.
 *
 * @param {string} action
 * @param {string[]} actionTypes
 * @returns {boolean}
 */
function actionAllowed(action, actionTypes) {
  return actionTypes.includes(action);
}

/**
 * Resolve which action to take.
 *
 * @param {{ hasAlert: boolean, direction: string | undefined, rank: number, percentile: number, worstRank: number, actionTypes: string[] }} params
 * @returns {string}
 */
function resolveAction({ hasAlert, direction, rank, percentile, worstRank, actionTypes }) {
  if (hasAlert) {
    if (direction === "down" || direction === "flat") {
      if (actionAllowed("reorder", actionTypes)) return "reorder";
    }
    if (actionAllowed("investigate", actionTypes)) return "investigate";
    if (actionAllowed("monitor", actionTypes)) return "monitor";
    return actionTypes[0] ?? "monitor";
  }

  if (rank === 1 && direction === "up") {
    if (actionAllowed("promote", actionTypes)) return "promote";
  }

  // Bottom performer: use percentile for stability; fall back to last-rank comparison.
  const isBottomPerformer = percentile >= 0.8 || rank === worstRank;
  if (isBottomPerformer && (direction === "down" || direction === "flat")) {
    if (actionAllowed("investigate", actionTypes)) return "investigate";
  }

  if (actionAllowed("monitor", actionTypes)) return "monitor";
  return actionTypes[0] ?? "monitor";
}

/**
 * Derive urgency — percentile-based for dataset-size stability.
 *
 * @param {{ hasAlert: boolean, alertSeverity: string | undefined, direction: string | undefined, percentile: number }} params
 * @returns {"critical" | "high" | "medium" | "low"}
 */
function resolveUrgency({ hasAlert, alertSeverity, direction, percentile }) {
  // Critical: explicit severity OR trending down in bottom 20% of performers.
  if (alertSeverity === "critical" || (direction === "down" && percentile >= 0.8)) {
    return "critical";
  }
  // High: any active alert OR bottom half trending down.
  if (hasAlert || (percentile > 0.5 && direction === "down")) {
    return "high";
  }
  // Medium: bottom half OR stable/flat.
  if (percentile > 0.5 || direction === "flat") {
    return "medium";
  }
  return "low";
}

/**
 * Build a human-readable reason string.
 *
 * @param {{ entityId: string, hasAlert: boolean, alertMessage: string | undefined, alertCount: number, action: string, direction: string | undefined, rank: number, percentile: number }} params
 * @returns {string}
 */
function buildReason({ entityId, hasAlert, alertMessage, alertCount, action, direction, rank, percentile }) {
  const parts = [];

  if (hasAlert) {
    if (alertMessage) {
      parts.push(`Alert: ${alertMessage}.`);
    } else {
      parts.push(`Alert triggered for ${entityId}.`);
    }
    if (alertCount > 1) {
      parts.push(`(${alertCount} alerts total.)`);
    }
  }

  if (direction) {
    const dirLabel = direction === "up" ? "trending up" : direction === "down" ? "trending down" : "stable";
    parts.push(`Entity is ${dirLabel}.`);
  }

  parts.push(`Ranked #${rank} (${Math.round(percentile * 100)}th percentile).`);
  parts.push(`Action: ${action}.`);

  return parts.join(" ");
}

/**
 * Generate actionable recommendations from ranked entities and alerts.
 * Supports multiple alerts per entity; urgency is percentile-based.
 *
 * @param {{
 *   alerts:          AlertRow[],
 *   rankedEntities:  RankedEntity[],
 *   actionTypes?:    string[],
 * }} body
 * @returns {{ recommendations: Recommendation[] }}
 */
export function generateRecommendations(body) {
  if (!body || typeof body !== "object") {
    throw new Error("generateRecommendations: body must be an object");
  }

  const { alerts, rankedEntities, actionTypes: rawActionTypes } = body;

  if (!Array.isArray(alerts)) {
    throw new Error("generateRecommendations: alerts must be an array");
  }
  if (!Array.isArray(rankedEntities)) {
    throw new Error("generateRecommendations: rankedEntities must be an array");
  }

  const actionTypes =
    Array.isArray(rawActionTypes) && rawActionTypes.length > 0
      ? rawActionTypes.map(String)
      : [...DEFAULT_ACTION_TYPES];

  // ── Index ALL alerts by entityId (multi-alert: one entity may have many) ──
  /** @type {Map<string, AlertRow[]>} */
  const alertsByEntity = new Map();
  for (const alert of alerts) {
    if (alert == null || typeof alert !== "object") continue;
    const id = String(alert.entityId ?? "").trim();
    if (!id) continue;
    if (!alertsByEntity.has(id)) alertsByEntity.set(id, []);
    alertsByEntity.get(id)?.push(alert);
  }

  // ── Filter valid ranked entities ──────────────────────────────────────────
  const validEntities = rankedEntities.filter(
    (e) => e != null && typeof e === "object" && String(e.entityId ?? "").trim() !== "",
  );

  const totalEntities = validEntities.length;
  const worstRank = totalEntities > 0 ? Math.max(...validEntities.map((e) => Number(e.rank ?? 1))) : 1;

  // ── Build recommendations ────────────────────────────────────────────────
  /** @type {Recommendation[]} */
  const recommendations = [];

  for (const entity of validEntities) {
    const entityId = String(entity.entityId).trim();
    const label    = String(entity.label ?? entityId);
    const rank     = Number(entity.rank ?? 1);

    // percentile: 0–1 scale, stable regardless of totalEntities changes.
    const percentile = totalEntities > 0 ? rank / totalEntities : 1;

    const entityAlerts   = alertsByEntity.get(entityId) ?? [];
    const hasAlert       = entityAlerts.length > 0;
    const alertCount     = entityAlerts.length;
    const alertSeverity  = highestSeverity(entityAlerts);
    const alertMessage   = firstMessage(entityAlerts);

    // Direction flows natively from analyzePerformanceTrends output.
    const direction =
      typeof /** @type {Record<string, unknown>} */ (entity).direction === "string"
        ? /** @type {string} */ (/** @type {Record<string, unknown>} */ (entity).direction)
        : undefined;

    const action  = resolveAction({ hasAlert, direction, rank, percentile, worstRank, actionTypes });
    const urgency = resolveUrgency({ hasAlert, alertSeverity, direction, percentile });
    const reason  = buildReason({ entityId, hasAlert, alertMessage, alertCount, action, direction, rank, percentile });

    recommendations.push({ entityId, label, action, urgency, reason, alertCount, percentile });
  }

  return { recommendations };
}

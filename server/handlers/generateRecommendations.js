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
 *   1. Check for a matching alert (by entityId).
 *   2. Derive action:
 *      - Alert present AND direction "down"/"flat" → "reorder" (if in actionTypes)
 *                                                  → "investigate" (fallback)
 *      - Alert present AND direction "up"          → "investigate"
 *      - No alert, rank = 1, direction "up"        → "promote"
 *      - No alert, rank > bottom third, direction "down" or "flat" → "investigate"
 *      - Otherwise                                 → "monitor"
 *   3. Urgency:
 *      - "critical" — alert.severity === "critical" OR (direction "down" AND rank is last)
 *      - "high"     — alert present (non-critical) OR rank in bottom half AND direction "down"
 *      - "medium"   — rank in bottom half OR direction "flat"
 *      - "low"      — otherwise
 *   4. Reason: human-readable explanation of the decision.
 *
 * Input shape:
 *   {
 *     alerts:         Array<{ entityId, severity?, message? }>,
 *     rankedEntities: Array<{ entityId, label, rank, score }>,
 *     actionTypes?:   Array<"reorder" | "promote" | "retire" | "investigate" | "monitor">
 *   }
 *
 * Output shape:
 *   {
 *     recommendations: Array<{
 *       entityId: string,
 *       label:    string,
 *       action:   string,
 *       urgency:  "critical" | "high" | "medium" | "low",
 *       reason:   string,
 *     }>
 *   }
 */

const DEFAULT_ACTION_TYPES = /** @type {const} */ (["reorder", "promote", "retire", "investigate", "monitor"]);

/**
 * @typedef {{ entityId: string, severity?: string, message?: string }} AlertRow
 * @typedef {{ entityId: string, label: string, rank: number, score: number }} RankedEntity
 * @typedef {{ entityId: string, label: string, action: string, urgency: "critical" | "high" | "medium" | "low", reason: string }} Recommendation
 */

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
 * Resolve which action to take based on alert, direction, and rank.
 *
 * @param {{ hasAlert: boolean, alertSeverity: string | undefined, direction: string | undefined, rank: number, worstRank: number, actionTypes: string[] }} params
 * @returns {string}
 */
function resolveAction({ hasAlert, direction, rank, worstRank, actionTypes }) {
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

  if (rank === worstRank && (direction === "down" || direction === "flat")) {
    if (actionAllowed("investigate", actionTypes)) return "investigate";
  }

  if (actionAllowed("monitor", actionTypes)) return "monitor";
  return actionTypes[0] ?? "monitor";
}

/**
 * Derive urgency level from alert severity, direction, rank, and total entity count.
 *
 * @param {{ hasAlert: boolean, alertSeverity: string | undefined, direction: string | undefined, rank: number, totalEntities: number }} params
 * @returns {"critical" | "high" | "medium" | "low"}
 */
function resolveUrgency({ hasAlert, alertSeverity, direction, rank, totalEntities }) {
  const bottomHalfThreshold = totalEntities > 1 ? Math.ceil(totalEntities / 2) : 1;

  if (alertSeverity === "critical" || (direction === "down" && rank === totalEntities)) {
    return "critical";
  }
  if (hasAlert || (rank > bottomHalfThreshold && direction === "down")) {
    return "high";
  }
  if (rank > bottomHalfThreshold || direction === "flat") {
    return "medium";
  }
  return "low";
}

/**
 * Build a human-readable reason string.
 *
 * @param {{ entityId: string, hasAlert: boolean, alertMessage: string | undefined, action: string, direction: string | undefined, rank: number }} params
 * @returns {string}
 */
function buildReason({ entityId, hasAlert, alertMessage, action, direction, rank }) {
  const parts = [];

  if (hasAlert && alertMessage) {
    parts.push(`Alert: ${alertMessage}.`);
  } else if (hasAlert) {
    parts.push(`Alert triggered for ${entityId}.`);
  }

  if (direction) {
    const dirLabel = direction === "up" ? "trending up" : direction === "down" ? "trending down" : "stable";
    parts.push(`Entity is ${dirLabel}.`);
  }

  parts.push(`Ranked #${rank}.`);
  parts.push(`Action: ${action}.`);

  return parts.join(" ");
}

/**
 * Generate actionable recommendations from ranked entities and alerts.
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

  // ── Index alerts by entityId for O(1) lookup ─────────────────────────────
  /** @type {Map<string, AlertRow>} */
  const alertIndex = new Map();
  for (const alert of alerts) {
    if (alert == null || typeof alert !== "object") continue;
    const id = String(alert.entityId ?? "").trim();
    if (!id) continue;
    alertIndex.set(id, alert);
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

    const alert    = alertIndex.get(entityId);
    const hasAlert = alert != null;
    const alertSeverity = alert?.severity != null ? String(alert.severity) : undefined;
    const alertMessage  = alert?.message  != null ? String(alert.message)  : undefined;

    // Direction is not in the ranked entity — it was in the trend layer.
    // Accept it as an optional pass-through on the entity object.
    const direction =
      typeof /** @type {Record<string, unknown>} */ (entity).direction === "string"
        ? /** @type {string} */ (/** @type {Record<string, unknown>} */ (entity).direction)
        : undefined;

    const action = resolveAction({ hasAlert, alertSeverity, direction, rank, worstRank, actionTypes });
    const urgency = resolveUrgency({ hasAlert, alertSeverity, direction, rank, totalEntities });
    const reason = buildReason({ entityId, hasAlert, alertMessage, action, direction, rank });

    recommendations.push({ entityId, label, action, urgency, reason });
  }

  return { recommendations };
}

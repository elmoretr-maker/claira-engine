/**
 * interpretTrends — pure engine handler function.
 *
 * Converts raw per-entity numerical deltas (from computeStateDelta) into
 * directional meaning: direction, velocity, and period count.
 *
 * Exported as a named function so it can be:
 *   1. Registered in CLAIRA_RUN_HANDLERS (server/index.js)
 *   2. Tested in isolation without server initialization
 *
 * This is a pure function. No API calls, no side effects, no store access.
 * The same input always produces the same output.
 *
 * Algorithm (per entity):
 *   direction  — netDelta > 0 → "up" | netDelta < 0 → "down" | 0 → "flat"
 *   velocity   — Math.abs(netDelta)  (magnitude of change, direction-agnostic)
 *   periodCount — pass through from delta if present; defaults to 2 (minimum
 *                 required for a delta to exist; exact count requires upstream data)
 *
 * Input shape:
 *   {
 *     deltas: Array<{
 *       entityId:      string,
 *       startValue:    number,
 *       endValue:      number,
 *       netDelta:      number,
 *       deliveryTotal: number,
 *       salesTotal:    number,
 *       periodCount?:  number,   // optional pass-through from upstream
 *     }>
 *   }
 *
 * Output shape:
 *   {
 *     trends: Array<{
 *       entityId:    string,
 *       direction:   "up" | "down" | "flat",
 *       velocity:    number,
 *       periodCount: number,
 *     }>
 *   }
 */

/**
 * @typedef {{ entityId: string, netDelta: number, periodCount?: number }} DeltaRow
 *
 * @typedef {{
 *   entityId:    string,
 *   direction:   "up" | "down" | "flat",
 *   velocity:    number,
 *   periodCount: number,
 * }} TrendRow
 */

/**
 * Interpret directional trends from per-entity state deltas.
 *
 * @param {{ deltas: DeltaRow[] }} body
 * @returns {{ trends: TrendRow[] }}
 */
export function interpretTrends(body) {
  if (!body || typeof body !== "object") {
    throw new Error("interpretTrends: body must be an object");
  }

  const { deltas } = body;

  if (!Array.isArray(deltas)) {
    throw new Error("interpretTrends: deltas must be an array");
  }

  /** @type {TrendRow[]} */
  const trends = [];

  for (const delta of deltas) {
    if (delta == null || typeof delta !== "object") continue;

    const entityId = String(delta.entityId ?? "").trim();
    if (!entityId) continue;

    const netDelta = Number(delta.netDelta ?? 0);
    if (!Number.isFinite(netDelta)) continue;

    /** @type {"up" | "down" | "flat"} */
    const direction = netDelta > 0 ? "up" : netDelta < 0 ? "down" : "flat";
    const velocity = Math.abs(netDelta);

    // Pass through if upstream computed it; default to 2 (minimum to produce a delta).
    const periodCount =
      typeof delta.periodCount === "number" && Number.isFinite(delta.periodCount) && delta.periodCount > 0
        ? delta.periodCount
        : 2;

    trends.push({ entityId, direction, velocity, periodCount });
  }

  return { trends };
}

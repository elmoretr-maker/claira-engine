/**
 * interpretTrends — pure engine handler function.
 *
 * Converts raw per-entity numerical deltas (from computeStateDelta) into
 * directional meaning, and forwards ALL upstream fields for downstream stages
 * and Claira Insights without requiring re-reads of Stage 1 artifacts.
 *
 * Exported as a named function so it can be:
 *   1. Registered in CLAIRA_RUN_HANDLERS (server/index.js)
 *   2. Tested in isolation without server initialization
 *
 * This is a pure function. No API calls, no side effects, no store access.
 * The same input always produces the same output.
 *
 * Algorithm (per entity):
 *   direction       — netDelta > 0 → "up" | netDelta < 0 → "down" | 0 → "flat"
 *   velocity        — Math.abs(netDelta)  (magnitude, direction-agnostic)
 *   velocityPerTime — velocity / durationMs (rate per millisecond; 0 if no duration)
 *   periodCount     — snapshotCount (preferred) > periodCount (legacy) > 2 (minimum)
 *   netDelta        — forwarded unchanged
 *   salesTotal      — forwarded; defaults to 0 if absent
 *   startValue      — forwarded unchanged (enables cross-run comparison)
 *   endValue        — forwarded unchanged (enables cross-run comparison)
 *   deliveryTotal   — forwarded unchanged
 *   timeRange       — forwarded unchanged ({ startTimestamp, endTimestamp, durationMs })
 *
 * Input shape:
 *   {
 *     deltas: Array<{
 *       entityId:       string,
 *       netDelta:       number,
 *       startValue?:    number,
 *       endValue?:      number,
 *       deliveryTotal?: number,
 *       salesTotal?:    number,
 *       snapshotCount?: number,
 *       periodCount?:   number,
 *       timeRange?:     { startTimestamp: string, endTimestamp: string, durationMs: number },
 *     }>
 *   }
 *
 * Output shape:
 *   {
 *     trends: Array<{
 *       entityId:       string,
 *       direction:      "up" | "down" | "flat",
 *       velocity:       number,
 *       velocityPerTime: number,
 *       periodCount:    number,
 *       netDelta:       number,
 *       salesTotal:     number,
 *       startValue:     number,
 *       endValue:       number,
 *       deliveryTotal:  number,
 *       timeRange:      { startTimestamp: string, endTimestamp: string, durationMs: number } | null,
 *     }>
 *   }
 */

/**
 * @typedef {{
 *   entityId:        string,
 *   netDelta:        number,
 *   startValue?:     number,
 *   endValue?:       number,
 *   deliveryTotal?:  number,
 *   salesTotal?:     number,
 *   snapshotCount?:  number,
 *   periodCount?:    number,
 *   timeRange?:      { startTimestamp: string, endTimestamp: string, durationMs: number },
 * }} DeltaRow
 *
 * @typedef {{
 *   entityId:        string,
 *   direction:       "up" | "down" | "flat",
 *   velocity:        number,
 *   velocityPerTime: number,
 *   periodCount:     number,
 *   netDelta:        number,
 *   salesTotal:      number,
 *   startValue:      number,
 *   endValue:        number,
 *   deliveryTotal:   number,
 *   timeRange:       { startTimestamp: string, endTimestamp: string, durationMs: number } | null,
 * }} TrendRow
 */

/**
 * Interpret directional trends from per-entity state deltas.
 * Forwards all upstream fields for downstream pipeline composability.
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
    // Skip non-object entries silently — allow rest of array to process.
    if (delta == null || typeof delta !== "object") continue;

    const entityId = String(delta.entityId ?? "").trim();
    if (!entityId) continue;

    const netDelta = Number(delta.netDelta ?? 0);
    // Skip rows where netDelta is not a usable number — direction logic would be unsafe.
    if (!Number.isFinite(netDelta)) continue;

    /** @type {"up" | "down" | "flat"} */
    const direction = netDelta > 0 ? "up" : netDelta < 0 ? "down" : "flat";
    const velocity  = Math.abs(netDelta);

    // Prefer snapshotCount (exact) > periodCount (legacy pass-through) > 2 (minimum).
    const rawSnapshotCount = delta.snapshotCount;
    const rawPeriodCount   = delta.periodCount;
    const periodCount =
      typeof rawSnapshotCount === "number" && Number.isFinite(rawSnapshotCount) && rawSnapshotCount > 0
        ? rawSnapshotCount
        : typeof rawPeriodCount === "number" && Number.isFinite(rawPeriodCount) && rawPeriodCount > 0
          ? rawPeriodCount
          : 2;

    // Time-normalised velocity: magnitude per millisecond (0 when no duration).
    const timeRange = delta.timeRange != null && typeof delta.timeRange === "object"
      ? /** @type {{ startTimestamp: string, endTimestamp: string, durationMs: number }} */ (delta.timeRange)
      : null;
    const durationMs = timeRange && Number.isFinite(timeRange.durationMs) && timeRange.durationMs > 0
      ? timeRange.durationMs
      : 0;
    const velocityPerTime = durationMs > 0 ? velocity / durationMs : 0;

    // ── Pass-through fields — exact values, no recomputation ─────────────────
    const rawSalesTotal    = Number(delta.salesTotal    ?? 0);
    const rawStartValue    = Number(delta.startValue    ?? 0);
    const rawEndValue      = Number(delta.endValue      ?? 0);
    const rawDeliveryTotal = Number(delta.deliveryTotal ?? 0);

    const salesTotal    = Number.isFinite(rawSalesTotal)    ? rawSalesTotal    : 0;
    const startValue    = Number.isFinite(rawStartValue)    ? rawStartValue    : 0;
    const endValue      = Number.isFinite(rawEndValue)      ? rawEndValue      : 0;
    const deliveryTotal = Number.isFinite(rawDeliveryTotal) ? rawDeliveryTotal : 0;

    trends.push({
      entityId,
      direction,
      velocity,
      velocityPerTime,
      periodCount,
      netDelta,
      salesTotal,
      startValue,
      endValue,
      deliveryTotal,
      timeRange,
    });
  }

  return { trends };
}

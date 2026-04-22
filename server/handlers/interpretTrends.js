/**
 * interpretTrends — pure engine handler function.
 *
 * Converts raw per-entity numerical deltas (from computeStateDelta) into
 * directional meaning, and forwards fields needed by downstream stages.
 *
 * Exported as a named function so it can be:
 *   1. Registered in CLAIRA_RUN_HANDLERS (server/index.js)
 *   2. Tested in isolation without server initialization
 *
 * This is a pure function. No API calls, no side effects, no store access.
 * The same input always produces the same output.
 *
 * Algorithm (per entity):
 *   direction   — netDelta > 0 → "up" | netDelta < 0 → "down" | 0 → "flat"
 *   velocity    — Math.abs(netDelta)  (magnitude of change, direction-agnostic)
 *   periodCount — snapshotCount from delta (exact) if present; else periodCount
 *                 pass-through if present; else defaults to 2 (minimum required
 *                 for a delta to exist)
 *   netDelta    — forwarded unchanged from input delta
 *   salesTotal  — forwarded unchanged from input delta; defaults to 0 if absent
 *
 * Input shape:
 *   {
 *     deltas: Array<{
 *       entityId:       string,
 *       netDelta:       number,
 *       deliveryTotal?: number,
 *       salesTotal?:    number,
 *       snapshotCount?: number,   // preferred source for periodCount
 *       periodCount?:   number,   // fallback if snapshotCount absent
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
 *       netDelta:    number,    // forwarded for downstream rankBy / insights
 *       salesTotal:  number,   // forwarded for downstream rankBy / insights
 *     }>
 *   }
 */

/**
 * @typedef {{
 *   entityId:       string,
 *   netDelta:       number,
 *   deliveryTotal?: number,
 *   salesTotal?:    number,
 *   snapshotCount?: number,
 *   periodCount?:   number,
 * }} DeltaRow
 *
 * @typedef {{
 *   entityId:    string,
 *   direction:   "up" | "down" | "flat",
 *   velocity:    number,
 *   periodCount: number,
 *   netDelta:    number,
 *   salesTotal:  number,
 * }} TrendRow
 */

/**
 * Interpret directional trends from per-entity state deltas.
 * Forwards netDelta and salesTotal for downstream pipeline use.
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
    const velocity = Math.abs(netDelta);

    // Prefer snapshotCount (exact) > periodCount (legacy pass-through) > 2 (minimum).
    const rawSnapshotCount = delta.snapshotCount;
    const rawPeriodCount   = delta.periodCount;
    const periodCount =
      typeof rawSnapshotCount === "number" && Number.isFinite(rawSnapshotCount) && rawSnapshotCount > 0
        ? rawSnapshotCount
        : typeof rawPeriodCount === "number" && Number.isFinite(rawPeriodCount) && rawPeriodCount > 0
          ? rawPeriodCount
          : 2;

    // Forward salesTotal; default to 0 if absent or non-finite.
    const rawSalesTotal = Number(delta.salesTotal ?? 0);
    const salesTotal = Number.isFinite(rawSalesTotal) ? rawSalesTotal : 0;

    trends.push({ entityId, direction, velocity, periodCount, netDelta, salesTotal });
  }

  return { trends };
}

/**
 * computeStateDelta — pure engine handler function.
 *
 * Exported as a named function so it can be:
 *   1. Registered in CLAIRA_RUN_HANDLERS (server/index.js)
 *   2. Tested in isolation without server initialization
 *
 * This is a pure function. It does not call any API, write to any store,
 * or produce side effects. The same computation always produces the same
 * result for the same input.
 *
 * Algorithm (per entity):
 *   1. Sort snapshots by timestamp ascending.
 *   2. startValue = earliest snapshot value; endValue = latest snapshot value.
 *   3. deliveryTotal = sum of all delivery event quantities for this entity.
 *   4. salesTotal    = sum of all sale event quantities for this entity.
 *   5. netDelta      = endValue - startValue.
 *   6. Skip entities with fewer than 2 snapshots (insufficient baseline).
 *
 * Input shape:
 *   {
 *     snapshots:       Array<{ entityId, value, timestamp }>
 *     deliveryEvents?: Array<{ entityId, quantity, timestamp, eventType }>
 *     saleEvents?:     Array<{ entityId, quantity, timestamp, eventType }>
 *   }
 *
 * Output shape:
 *   {
 *     deltas: Array<{
 *       entityId:       string,
 *       startValue:     number,
 *       endValue:       number,
 *       netDelta:       number,
 *       deliveryTotal:  number,
 *       salesTotal:     number,
 *     }>
 *   }
 */

/**
 * @typedef {{
 *   entityId:  string,
 *   value:     number,
 *   timestamp: string | number,
 * }} SnapshotRow
 *
 * @typedef {{
 *   entityId:  string,
 *   quantity:  number,
 *   timestamp: string | number,
 *   eventType: string,
 * }} EventRow
 *
 * @typedef {{
 *   entityId:      string,
 *   startValue:    number,
 *   endValue:      number,
 *   netDelta:      number,
 *   deliveryTotal: number,
 *   salesTotal:    number,
 * }} EntityDelta
 */

/**
 * Compute per-entity state deltas from snapshot history and event logs.
 *
 * @param {{
 *   snapshots:        SnapshotRow[],
 *   deliveryEvents?:  EventRow[],
 *   saleEvents?:      EventRow[],
 * }} body
 * @returns {{ deltas: EntityDelta[] }}
 */
export function computeStateDelta(body) {
  const snapshots      = body.snapshots;
  const deliveryEvents = Array.isArray(body.deliveryEvents) ? body.deliveryEvents : [];
  const saleEvents     = Array.isArray(body.saleEvents)     ? body.saleEvents     : [];

  if (!Array.isArray(snapshots)) {
    throw new Error("computeStateDelta: snapshots must be an array");
  }

  // ── Group snapshots by entityId ──────────────────────────────────────────
  /** @type {Map<string, SnapshotRow[]>} */
  const snapshotsByEntity = new Map();
  for (const snap of snapshots) {
    const id = String(snap?.entityId ?? "").trim();
    if (!id) continue;
    if (!snapshotsByEntity.has(id)) snapshotsByEntity.set(id, []);
    snapshotsByEntity.get(id).push(snap);
  }

  // ── Sum delivery quantities by entityId ──────────────────────────────────
  /** @type {Map<string, number>} */
  const deliveryTotals = new Map();
  for (const ev of deliveryEvents) {
    const id  = String(ev?.entityId ?? "").trim();
    const qty = Number(ev?.quantity ?? 0);
    if (!id || !Number.isFinite(qty)) continue;
    deliveryTotals.set(id, (deliveryTotals.get(id) ?? 0) + qty);
  }

  // ── Sum sale quantities by entityId ──────────────────────────────────────
  /** @type {Map<string, number>} */
  const saleTotals = new Map();
  for (const ev of saleEvents) {
    const id  = String(ev?.entityId ?? "").trim();
    const qty = Number(ev?.quantity ?? 0);
    if (!id || !Number.isFinite(qty)) continue;
    saleTotals.set(id, (saleTotals.get(id) ?? 0) + qty);
  }

  // ── Compute delta per entity ─────────────────────────────────────────────
  /** @type {EntityDelta[]} */
  const deltas = [];

  for (const [entityId, entitySnapshots] of snapshotsByEntity) {
    // Sort a copy ascending by timestamp — never mutate input.
    const sorted = [...entitySnapshots].sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      return ta - tb;
    });

    // Require at least 2 snapshots to compute a meaningful delta.
    if (sorted.length < 2) continue;

    const startValue    = Number(sorted[0].value ?? 0);
    const endValue      = Number(sorted[sorted.length - 1].value ?? 0);
    const netDelta      = endValue - startValue;
    const deliveryTotal = deliveryTotals.get(entityId) ?? 0;
    const salesTotal    = saleTotals.get(entityId) ?? 0;

    deltas.push({ entityId, startValue, endValue, netDelta, deliveryTotal, salesTotal });
  }

  return { deltas };
}

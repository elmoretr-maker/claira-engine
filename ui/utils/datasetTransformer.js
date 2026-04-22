/**
 * datasetTransformer.js
 *
 * Pure transformation functions: form values → engine-ready data shapes.
 *
 * RULES (enforced here):
 *   - DO NOT fabricate data
 *   - DO NOT auto-calculate hidden values
 *   - Only transform what the user explicitly provided
 *   - Event timestamps = periodEnd, NOT midpoint
 *   - Events with quantity 0 are excluded (not sent to engine)
 */

/**
 * Convert a human-readable name to a stable, URL-safe entity ID.
 * "Oxford Classic" → "oxford-classic"
 *
 * @param {string} name
 * @returns {string}
 */
export function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Parse a multi-line textarea into { entityId, label } pairs.
 * Deduplicates by entityId. Skips blank lines.
 *
 * @param {string} raw - multi-line textarea value
 * @returns {Array<{ entityId: string, label: string }>}
 */
export function parseEntityNames(raw) {
  if (!raw || typeof raw !== "string") return [];
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Array<{ entityId: string, label: string }>} */
  const entities = [];
  for (const line of lines) {
    const id = slugify(line);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    entities.push({ entityId: id, label: line });
  }
  return entities;
}

/**
 * Build snapshot records from per-entity current-state form values.
 * Produces ONE snapshot per entity per call (the value the user entered).
 *
 * No fabrication: if the user provides only current state, only one snapshot
 * is produced. computeStateDelta will skip entities with <2 snapshots —
 * the caller must show a warning to the user.
 *
 * @param {Array<{ entityId: string, label: string }>} entities
 * @param {{ [entityId: string]: { value: string | number, timestamp: string } }} stateData
 * @returns {Array<{ entityId: string, value: number, timestamp: string }>}
 */
export function buildSnapshots(entities, stateData) {
  /** @type {Array<{ entityId: string, value: number, timestamp: string }>} */
  const snapshots = [];
  for (const entity of entities) {
    const entry = stateData[entity.entityId];
    if (!entry) continue;
    if (entry.value === "" || entry.value === undefined || entry.value === null) continue;
    const value = Number(entry.value);
    if (!Number.isFinite(value) || value < 0) continue;
    if (!entry.timestamp) continue;
    snapshots.push({ entityId: entity.entityId, value, timestamp: entry.timestamp });
  }
  return snapshots;
}

/**
 * Build sale and delivery event records from activity form values.
 *
 * TIMESTAMP RULE: timestamp = periodEnd date as selected by user.
 * NOT the midpoint. NOT today unless periodEnd is today.
 *
 * @param {Array<{ entityId: string, label: string }>} entities
 * @param {{
 *   periodEnd:  string,
 *   sales:      { [entityId: string]: string | number },
 *   deliveries: { [entityId: string]: string | number },
 * }} activityData
 * @returns {{
 *   saleEvents:     Array<{ entityId: string, quantity: number, timestamp: string, eventType: "sale" }>,
 *   deliveryEvents: Array<{ entityId: string, quantity: number, timestamp: string, eventType: "delivery" }>,
 * }}
 */
export function buildEvents(entities, activityData) {
  const { periodEnd, sales = {}, deliveries = {} } = activityData;

  /** @type {Array<{ entityId: string, quantity: number, timestamp: string, eventType: "sale" }>} */
  const saleEvents = [];
  /** @type {Array<{ entityId: string, quantity: number, timestamp: string, eventType: "delivery" }>} */
  const deliveryEvents = [];

  for (const entity of entities) {
    const saleQty = Number(sales[entity.entityId] ?? 0);
    if (Number.isFinite(saleQty) && saleQty > 0) {
      saleEvents.push({
        entityId:  entity.entityId,
        quantity:  saleQty,
        timestamp: periodEnd,
        eventType: "sale",
      });
    }

    const deliveryQty = Number(deliveries[entity.entityId] ?? 0);
    if (Number.isFinite(deliveryQty) && deliveryQty > 0) {
      deliveryEvents.push({
        entityId:  entity.entityId,
        quantity:  deliveryQty,
        timestamp: periodEnd,
        eventType: "delivery",
      });
    }
  }

  return { saleEvents, deliveryEvents };
}

/**
 * runPipeline.js
 *
 * Orchestrates the four existing engine handlers for a given dataset.
 * The handlers themselves (computeStateDelta, interpretTrends,
 * analyzePerformanceTrends, generateRecommendations) are never modified.
 *
 * Intent-specific pipeline paths:
 *
 *   inventory / wellness / custom
 *     computeStateDelta → interpretTrends → analyzePerformanceTrends
 *     → generateRecommendations → mergeEntityPipelineData → enrich
 *
 *   sales / workforce
 *     transformEventsToMetrics → interpretTrends → analyzePerformanceTrends
 *     → generateRecommendations → mergeEntityPipelineData → enrich
 *
 * Why sales and workforce use a different first stage:
 *   These intents skip StateStep — they have no persistent stock-level snapshots.
 *   computeStateDelta requires ≥ 2 snapshots per entity (for a meaningful delta),
 *   so calling it with the wizard's single zero-value placeholders would drop every
 *   entity as "insufficient". transformEventsToMetrics() produces equivalent EntityDelta
 *   rows directly from the event aggregates that are already in the dataset, keeping
 *   all downstream stages unchanged. No duplication: computeStateDelta is simply not
 *   called for these intents, so each aggregation step runs exactly once.
 *
 * Semantic note — sales and workforce field mapping:
 *   salesTotal    = "this period" (sales) | "completed" (workforce)   — from saleEvents
 *   deliveryTotal = "prior period" (sales) | "assigned" (workforce)   — from deliveryEvents
 *   startValue    = deliveryTotal  (period baseline)
 *   endValue      = salesTotal     (period result)
 *   netDelta      = salesTotal − deliveryTotal  (period-over-period change)
 *
 *   This is semantically different from inventory (where startValue / endValue represent
 *   actual measured stock levels at two points in time), but the downstream pipeline
 *   stages treat them identically — direction, rank, urgency, and action are derived
 *   from the same netDelta and velocity signals regardless of intent.
 */

import { mergeEntityPipelineData }      from "./engineDisplayFormatters.js";
import { enrichMergedForWellnessIntent } from "./wellnessAnalysis.js";
import { enrichInventoryForOutput }      from "./inventoryAnalysis.js";
import { enrichSalesForOutput }          from "./salesAnalysis.js";
import { enrichWorkforceForOutput }      from "./workforceAnalysis.js";

const ENGINE_URL = "/__claira/run";

// ── Pre-processing ────────────────────────────────────────────────────────────

/**
 * transformEventsToMetrics — first pipeline stage for sales and workforce.
 *
 * Sales and workforce track period-over-period comparison (or output vs. assignment),
 * not a persistent state level. They skip StateStep, so their wizard-generated
 * snapshots are single zero-value placeholders that computeStateDelta cannot use
 * (it requires ≥ 2 snapshots per entity to compute a delta).
 *
 * This function replaces computeStateDelta for these intents. It aggregates
 * saleEvents and deliveryEvents directly — a single pass, no duplication — and
 * returns EntityDelta-format rows that the remaining pipeline stages
 * (interpretTrends → analyzePerformanceTrends → generateRecommendations)
 * consume identically to what computeStateDelta would produce.
 *
 * Field semantics (see also module-level comment):
 *   salesTotal    = endValue   = this period  (sales) | completed  (workforce)
 *   deliveryTotal = startValue = prior period (sales) | assigned   (workforce)
 *   netDelta      = salesTotal − deliveryTotal
 *
 * Time range is derived from actual dataset timestamps — no hardcoded windows:
 *   periodEnd   = event timestamp (the periodEnd the user chose in ActivityStep)
 *   periodStart = snapshot timestamp (stateDate, set by the wizard)
 * When both are the same day, durationMs = 0 and velocity = 0. The analysis
 * layer for these intents does not use velocity, so this is acceptable.
 *
 * @param {{
 *   entities?:       Array<{ entityId: string }>,
 *   snapshots?:      Array<{ entityId: string, timestamp: string }>,
 *   saleEvents?:     Array<{ entityId: string, quantity: number, timestamp: string }>,
 *   deliveryEvents?: Array<{ entityId: string, quantity: number, timestamp: string }>,
 * }} dataset
 * @returns {Array<{
 *   entityId: string, startValue: number, endValue: number,
 *   netDelta: number, salesTotal: number, deliveryTotal: number,
 *   snapshotCount: number,
 *   timeRange: { startTimestamp: string, endTimestamp: string, durationMs: number }
 * }>}
 */
function transformEventsToMetrics(dataset) {
  const entities      = dataset.entities       ?? [];
  const saleEvs       = dataset.saleEvents     ?? [];
  const deliveryEvs   = dataset.deliveryEvents ?? [];
  const existingSnaps = dataset.snapshots      ?? [];

  // Aggregate totals per entity — single aggregation, no duplication with computeStateDelta
  /** @type {Map<string, number>} */
  const saleMap  = new Map();
  /** @type {Map<string, number>} */
  const delivMap = new Map();

  for (const ev of saleEvs) {
    const id  = String(ev?.entityId ?? "");
    const qty = Number(ev?.quantity ?? 0);
    if (id && Number.isFinite(qty)) saleMap.set(id, (saleMap.get(id) ?? 0) + qty);
  }
  for (const ev of deliveryEvs) {
    const id  = String(ev?.entityId ?? "");
    const qty = Number(ev?.quantity ?? 0);
    if (id && Number.isFinite(qty)) delivMap.set(id, (delivMap.get(id) ?? 0) + qty);
  }

  // Derive period boundaries from real dataset timestamps — no hardcoded windows.
  // periodEnd   = the periodEnd the user selected in ActivityStep (stored in event timestamps)
  // periodStart = stateDate (stored in snapshot timestamps)
  const rawEnd   = saleEvs[0]?.timestamp ?? deliveryEvs[0]?.timestamp ?? new Date().toISOString();
  const rawStart = existingSnaps[0]?.timestamp ?? rawEnd;

  const endMs   = new Date(rawEnd).getTime();
  const startMs = new Date(rawStart).getTime();
  // durationMs may be 0 if the user kept both dates as today (single-session entry).
  // interpretTrends handles this by setting velocity = 0 and deriving direction from netDelta sign.
  const durationMs = Math.max(0, endMs - startMs);

  const periodEndStr   = isNaN(endMs)   ? String(rawEnd)   : new Date(endMs).toISOString();
  const periodStartStr = isNaN(startMs) ? String(rawStart) : new Date(startMs).toISOString();

  return entities.map((entity) => {
    // salesTotal    = endValue   = this period (sales) | completed (workforce)
    // deliveryTotal = startValue = prior period (sales) | assigned (workforce)
    const salesTotal    = saleMap.get(entity.entityId)  ?? 0;
    const deliveryTotal = delivMap.get(entity.entityId) ?? 0;
    const netDelta      = salesTotal - deliveryTotal;

    return {
      entityId:      entity.entityId,
      startValue:    deliveryTotal,   // prior period / assigned
      endValue:      salesTotal,      // this period / completed
      netDelta,
      salesTotal,
      deliveryTotal,
      snapshotCount: 2,               // signals a valid two-point comparison to downstream stages
      timeRange: {
        startTimestamp: periodStartStr,
        endTimestamp:   periodEndStr,
        durationMs,
      },
    };
  });
}

/**
 * POST a single request to an existing Claira engine handler.
 *
 * @param {string} kind
 * @param {Record<string, unknown>} payload
 * @returns {Promise<Record<string, unknown>>}
 */
async function callEngine(kind, payload) {
  // Prefer flat `{ kind, ...fields }` (matches clairaApiClient). Server also unwraps nested
  // `{ kind, payload: { ... } }` in runClaira.normalizeRunRequestBody for backward compatibility.
  const res = await fetch(ENGINE_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ kind, ...payload }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Engine error [${kind}] ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Run the full pipeline for a saved dataset.
 * Returns merged UI-ready entities for EntityPerformanceScreen.
 *
 * @param {{
 *   entities:       Array<{ entityId: string, label: string }>,
 *   snapshots:      Array<{ entityId: string, value: number, timestamp: string }>,
 *   saleEvents:     Array<{ entityId: string, quantity: number, timestamp: string, eventType: string }>,
 *   deliveryEvents: Array<{ entityId: string, quantity: number, timestamp: string, eventType: string }>,
 * }} dataset
 * @returns {Promise<ReturnType<typeof mergeEntityPipelineData>>}
 */
export async function runPipeline(dataset) {
  const { entities, snapshots, saleEvents, deliveryEvents } = dataset;
  const intent = dataset.intent ?? "custom";

  // Build entityLabelMap — passed to analyzePerformanceTrends (existing capability)
  const entityLabelMap = Object.fromEntries(
    (entities ?? []).map((e) => [e.entityId, e.label]),
  );

  // ── Stage 1 ─────────────────────────────────────────────────────────────────
  // Sales and workforce bypass computeStateDelta entirely: they have no persistent
  // state snapshots, only period event totals. transformEventsToMetrics() aggregates
  // the events directly and produces the same EntityDelta format that all downstream
  // stages expect — no synthetic timestamps, no hardcoded time windows.
  //
  // All other intents (inventory, wellness, custom) call computeStateDelta as normal.
  /** @type {any[]} */
  let deltas;
  if (intent === "sales" || intent === "workforce") {
    // salesTotal = this period / completed  (endValue)
    // deliveryTotal = prior period / assigned (startValue)
    // netDelta = salesTotal − deliveryTotal
    deltas = transformEventsToMetrics(dataset);
  } else {
    const stage1 = await callEngine("computeStateDelta", { snapshots, deliveryEvents, saleEvents });
    deltas = stage1.deltas ?? [];
  }

  // ── Stage 2: interpretTrends (existing handler, unchanged) ─────────────────
  const stage2 = await callEngine("interpretTrends", { deltas });
  const trends  = /** @type {any[]} */ (stage2.trends ?? []);

  // ── Stage 3: analyzePerformanceTrends (existing handler, unchanged) ────────
  const stage3         = await callEngine("analyzePerformanceTrends", {
    trends,
    rankBy: "velocity",
    entityLabelMap,
  });
  const rankedEntities = /** @type {any[]} */ (stage3.entities ?? []);

  // ── Stage 4: generateRecommendations (existing handler, unchanged) ─────────
  const stage4          = await callEngine("generateRecommendations", {
    alerts: [],
    rankedEntities,
  });
  const recommendations = /** @type {any[]} */ (stage4.recommendations ?? []);

  // ── Merge using existing utility (engineDisplayFormatters.js — unchanged) ──
  const merged = mergeEntityPipelineData(trends, rankedEntities, recommendations);

  // ── Dispatch to the intent-specific enrichment layer ────────────────────────
  if (intent === "inventory") return enrichInventoryForOutput(merged, dataset);
  if (intent === "sales")     return enrichSalesForOutput(merged, dataset);
  if (intent === "workforce") return enrichWorkforceForOutput(merged, dataset);
  return enrichMergedForWellnessIntent(merged, dataset);
}

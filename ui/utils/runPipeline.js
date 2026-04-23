/**
 * runPipeline.js
 *
 * Calls the EXISTING engine handlers in sequence for a given dataset.
 *
 * NO new logic. NO new data formats.
 * This is the bridge between a saved dataset and the existing pipeline.
 *
 * Pipeline (all existing, unchanged handlers):
 *   computeStateDelta → interpretTrends → analyzePerformanceTrends → generateRecommendations
 *   → mergeEntityPipelineData (existing utility)
 *
 * Returns merged entity data ready for EntityPerformanceScreen (existing, unchanged).
 */

import { mergeEntityPipelineData } from "./engineDisplayFormatters.js";
import { enrichMergedForWellnessIntent } from "./wellnessAnalysis.js";

const ENGINE_URL = "/__claira/run";

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

  // Build entityLabelMap — passed to analyzePerformanceTrends (existing capability)
  const entityLabelMap = Object.fromEntries(
    (entities ?? []).map((e) => [e.entityId, e.label]),
  );

  // ── Stage 1: computeStateDelta (existing handler, unchanged) ───────────────
  const stage1 = await callEngine("computeStateDelta", {
    snapshots,
    deliveryEvents,
    saleEvents,
  });
  const deltas = /** @type {any[]} */ (stage1.deltas ?? []);

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
  return enrichMergedForWellnessIntent(merged, dataset);
}

/**
 * Claira Engine — computation-only API (no game deps, no file moves).
 */

import { pathToFileURL } from "url";
import { classifyFromReferenceEmbeddings } from "./core/classifier.js";
import { decide } from "./core/decision.js";
import { getLearningStats, recordCorrection } from "./learning/learningStore.js";
import {
  generateSessionReport,
  recordAnalyzeOutcome,
  recordApplyDecisionOutcome,
  resetSessionLedger,
} from "./interfaces/sessionLedger.js";
import { buildDestinations } from "./routing/router.js";
import { loadEngineConfig } from "./utils/loadConfig.js";

export { classifyFromReferenceEmbeddings } from "./core/classifier.js";
export { decide, isHighConflictCosineTop2, DEFAULT_HIGH_CONFLICT_PAIRS } from "./core/decision.js";
export { compareWorkflow, normalizeWorkflowText, workflowItemToString } from "./core/workflowEngine.js";
export { expandIntent } from "./core/intentEngine.js";
export {
  simulateIntegration,
  analyzeIntegrationData,
  suggestionsToExpectedItems,
} from "./core/integrationEngine.js";
export { registerSimulation, getSimulations } from "./core/simulationRegistry.js";
export { SYSTEM_MODE } from "./core/systemMode.js";
export { isRealExternalIntegrationReady } from "./core/integrationAvailability.js";
export { recordCorrection, getLearningStats } from "./learning/learningStore.js";
export { resolveDestination, buildDestinations } from "./routing/router.js";
export { loadEngineConfig } from "./utils/loadConfig.js";
export { generateSessionReport, resetSessionLedger } from "./interfaces/sessionLedger.js";

/** @type {{ classification: object, routing: object, decision: object, file?: string | null } | null} */
let lastResult = null;
let lastClassification = null;
let lastDecision = null;
let lastRouting = null;
let lastFile = null;

/**
 * Full analyze() payload, or null to use lastResult.
 * @param {{ classification?: object, routing?: object, decision?: object, file?: string | null } | null | undefined} r
 */
function pickResult(r) {
  if (r && r.classification != null) return r;
  return lastResult;
}

/**
 * Analyze result, or bare classify() output, or last in-memory classification.
 * @param {object | null | undefined} r
 */
function pickClassificationSource(r) {
  if (r == null) return lastClassification;
  if (r.classification != null) return r.classification;
  if (r.alternatives != null && r.predicted_label !== undefined) return r;
  return lastClassification;
}

/**
 * Full pass: embedding vs reference pools → classification → routing → decision.
 * @param {{
 *   inputEmbedding: Float32Array,
 *   referenceEmbeddingsByLabel: Map<string, Float32Array[]>,
 *   softmaxTemperature?: number,
 *   file?: string | null,
 *   filePath?: string | null,
 * }} input
 */
export async function analyze(input) {
  if (!input?.inputEmbedding || !input?.referenceEmbeddingsByLabel) {
    lastResult = null;
    return {
      error: "missing_inputEmbedding_or_referenceEmbeddingsByLabel",
      classification: null,
      routing: null,
      decision: null,
    };
  }
  const config = loadEngineConfig();
  const thresholds = config.thresholds;
  const classification = classifyFromReferenceEmbeddings({
    inputEmbedding: input.inputEmbedding,
    referenceEmbeddingsByLabel: input.referenceEmbeddingsByLabel,
    softmaxTemperature: input.softmaxTemperature ?? config.softmaxTemperature ?? 12,
  });
  lastClassification = classification;

  const routing = buildDestinations(classification, config);
  lastRouting = routing;

  lastFile = input.file ?? input.filePath ?? null;

  const decision = decide({
    predicted_label: classification.predicted_label,
    second_label: classification.second_label,
    confidence: classification.confidence,
    margin: classification.margin,
    thresholds,
    hasRoutingDestination: routing.proposed_destination != null,
  });
  lastDecision = decision;

  const file = lastFile;
  lastResult = { classification, routing, decision, file };
  recordAnalyzeOutcome({ file, classification, routing, decision });
  return lastResult;
}

/**
 * Classification only (no routing / decision).
 */
export async function classify(input) {
  if (!input?.inputEmbedding || !input?.referenceEmbeddingsByLabel) {
    return { error: "missing_inputEmbedding_or_referenceEmbeddingsByLabel" };
  }
  const config = loadEngineConfig();
  const classification = classifyFromReferenceEmbeddings({
    inputEmbedding: input.inputEmbedding,
    referenceEmbeddingsByLabel: input.referenceEmbeddingsByLabel,
    softmaxTemperature: input.softmaxTemperature ?? config.softmaxTemperature ?? 12,
  });
  lastClassification = classification;
  lastDecision = null;
  lastRouting = null;
  lastFile = null;
  lastResult = null;
  return classification;
}

/**
 * Ranked label/score pairs from a result object or the last successful analyze().
 * @param {{ classification?: object } | null | undefined} [result]
 */
export async function getSuggestions(result) {
  const cls = pickClassificationSource(result);
  if (!cls?.alternatives?.length) {
    return { suggestions: [] };
  }
  return {
    suggestions: cls.alternatives.map((a) => ({
      label: a.label,
      score: a.score,
    })),
  };
}

/**
 * Place-card shaped summary (in-memory; no files written).
 * @param {{ classification?: object, routing?: object, decision?: object, file?: string | null } | null | undefined} [result]
 */
export async function generatePlaceCard(result) {
  const cls = pickClassificationSource(result);
  if (!cls) {
    return { placeCard: null };
  }
  const bundle =
    result && result.routing != null && result.decision != null
      ? result
      : pickResult(result);
  const rout = bundle?.routing ?? lastRouting;
  const dec = bundle?.decision ?? lastDecision;
  const fileField = bundle?.file ?? lastFile ?? null;

  const stats =
    cls.predicted_label != null
      ? getLearningStats(cls.predicted_label, rout?.routing_label ?? null)
      : null;

  const placeCard = {
    file: fileField,
    predicted_label: cls.predicted_label,
    routing_label: rout?.routing_label ?? null,
    proposed_destination: rout?.proposed_destination ?? null,
    alternative_destinations: rout?.alternative_destinations ?? [],
    confidence: cls.confidence,
    margin: cls.margin,
    reason: dec?.reason ?? null,
  };

  if (stats && stats.count > 0) {
    placeCard.learning_hint = {
      seen: stats.count,
      confidence: stats.confidence,
    };
  }

  return { placeCard };
}

/**
 * Acknowledge user decision; records passive learning when selected label ≠ predicted (no routing changes).
 * @param {{
 *   predicted_label?: string | null,
 *   selected_label?: string | null,
 *   confidence?: number }} [input]
 */
export async function applyDecision(input = {}) {
  const pred = input.predicted_label;
  const sel = input.selected_label;
  if (pred != null && sel != null && String(sel) !== String(pred)) {
    recordCorrection(pred, sel, { confidence: input.confidence });
    recordApplyDecisionOutcome({ correctionRecorded: true, predicted_label: pred, selected_label: sel });
    return { applied: true, correctionRecorded: true };
  }
  return { applied: true, correctionRecorded: false };
}

export const engine = {
  name: "claira-engine",
  version: "1.0.0",
  analyze,
  classify,
  getSuggestions,
  generatePlaceCard,
  applyDecision,
  generateSessionReport,
  resetSessionLedger,
};

export default engine;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(
    "claira-engine: import { analyze, classify } from this module; supply embeddings in-memory.",
  );
}

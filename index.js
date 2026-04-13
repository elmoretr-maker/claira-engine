/**
 * Claira Engine — computation-only API (no game deps, no file moves).
 */

import { appendFileSync, mkdirSync } from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { classifyFromReferenceEmbeddings } from "./core/classifier.js";
import { decide } from "./core/decision.js";
import { augmentClassificationWithReferenceContext } from "./core/referenceAugmentation.js";
import {
  getEffectiveDecisionThresholds,
  normalizeAppMode,
  normalizeOversightLevel,
} from "./core/oversightProfile.js";
import { suggestLabelFromText } from "./core/textAnalysis.js";
import { addUserReference } from "./learning/addUserReference.js";
import { getLearningStats, recordCorrection } from "./learning/learningStore.js";
import { addRiskSignal, applyRiskAdjustment } from "./learning/riskStore.js";
import {
  generateSessionReport,
  recordAnalyzeOutcome,
  recordApplyDecisionOutcome,
  resetSessionLedger,
} from "./interfaces/sessionLedger.js";
import { buildDestinations } from "./routing/router.js";
import { loadEngineConfig } from "./utils/loadConfig.js";
import { loadIndustryPack } from "./packs/loadIndustryPack.js";
import { readStructureCategoryKeysLower } from "./interfaces/referenceLoader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFLICT_LOG = join(__dirname, "logs", "moves.log");

/**
 * @param {object} cls
 * @returns {object}
 */
function cloneClassificationSnapshot(cls) {
  return {
    predicted_label: cls.predicted_label ?? null,
    second_label: cls.second_label ?? null,
    confidence: cls.confidence,
    margin: cls.margin,
    match_source: cls.match_source,
    visualCosineTop3: Array.isArray(cls.visualCosineTop3)
      ? cls.visualCosineTop3.map((x) => ({
          id: x.id,
          cosine: x.cosine,
        }))
      : [],
    softmaxTop3: Array.isArray(cls.softmaxTop3)
      ? cls.softmaxTop3.map((x) => ({
          id: x.id,
          confidence: x.confidence,
        }))
      : [],
    alternatives: Array.isArray(cls.alternatives)
      ? cls.alternatives.map((x) => ({
          label: x.label,
          score: x.score,
        }))
      : [],
  };
}

export { classifyFromReferenceEmbeddings } from "./core/classifier.js";
export { decide } from "./core/decision.js";
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
export { addRiskSignal, getRiskStoreSnapshot } from "./learning/riskStore.js";
export {
  inferPatternMismatchDetails,
  inferPatternMismatchSeverity,
} from "./learning/patternMismatchSeverity.js";
export { getRiskInsights } from "./learning/riskStore.js";
export { resolveDestination, buildDestinations } from "./routing/router.js";
export { loadEngineConfig } from "./utils/loadConfig.js";
export { generateSessionReport, resetSessionLedger } from "./interfaces/sessionLedger.js";
export { loadIndustryPack };

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
 *   referenceEmbeddingsByLabel: Map<string, unknown>,
 *   softmaxTemperature?: number,
 *   file?: string | null,
 *   filePath?: string | null,
 *   extractedText?: string | null,
 *   runtimeContext?: { appMode?: string, oversightLevel?: string, expectedCategory?: string },
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
  const runtimeCtx = input.runtimeContext ?? {};
  const oversightLevel = normalizeOversightLevel(runtimeCtx.oversightLevel);
  const appMode = normalizeAppMode(runtimeCtx.appMode);

  let classification = classifyFromReferenceEmbeddings({
    inputEmbedding: input.inputEmbedding,
    referenceEmbeddingsByLabel: input.referenceEmbeddingsByLabel,
    softmaxTemperature: input.softmaxTemperature ?? config.softmaxTemperature ?? 12,
  });
  const classificationPreFallback = cloneClassificationSnapshot(classification);

  const fallbackThRaw = config.classificationFallbackThreshold;
  const fallbackTh =
    typeof fallbackThRaw === "number" && Number.isFinite(fallbackThRaw) ? fallbackThRaw : 0.75;
  if (classification.confidence < fallbackTh) {
    const allowed = readStructureCategoryKeysLower();
    const hint = suggestLabelFromText(input.extractedText, {
      allowedLabels: allowed.size > 0 ? allowed : null,
    });
    if (hint) {
      classification = {
        ...classification,
        predicted_label: hint,
        match_source: "ocr",
        margin: 0,
      };
    } else {
      classification = {
        ...classification,
        predicted_label: "unknown",
        match_source: "none",
        margin: 0,
      };
    }
  }

  lastFile = input.file ?? input.filePath ?? null;

  const effectiveThresholds = getEffectiveDecisionThresholds(oversightLevel, appMode, thresholds);
  classification = augmentClassificationWithReferenceContext(
    classification,
    input.extractedText,
    effectiveThresholds,
  );
  classification = applyRiskAdjustment(classification, {
    oversightLevel,
    extractedText: input.extractedText,
  });

  lastClassification = classification;

  const routing = buildDestinations(classification, config);
  lastRouting = routing;

  const refCtx =
    classification.reference_context && typeof classification.reference_context === "object"
      ? classification.reference_context
      : null;
  const decision = decide({
    predicted_label: classification.predicted_label,
    second_label: classification.second_label,
    confidence: classification.confidence,
    margin: classification.margin,
    thresholds: effectiveThresholds,
    hasRoutingDestination: routing.proposed_destination != null,
    potential_conflict: refCtx?.potential_conflict === true,
  });
  lastDecision = decision;

  const file = lastFile;
  lastResult = {
    classification,
    classificationPreFallback,
    routing,
    decision,
    file,
  };
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
  let classification = classifyFromReferenceEmbeddings({
    inputEmbedding: input.inputEmbedding,
    referenceEmbeddingsByLabel: input.referenceEmbeddingsByLabel,
    softmaxTemperature: input.softmaxTemperature ?? config.softmaxTemperature ?? 12,
  });
  const fallbackThRaw = config.classificationFallbackThreshold;
  const fallbackTh =
    typeof fallbackThRaw === "number" && Number.isFinite(fallbackThRaw) ? fallbackThRaw : 0.75;
  if (classification.confidence < fallbackTh) {
    const allowed = readStructureCategoryKeysLower();
    const hint = suggestLabelFromText(input.extractedText, {
      allowedLabels: allowed.size > 0 ? allowed : null,
    });
    if (hint) {
      classification = {
        ...classification,
        predicted_label: hint,
        match_source: "ocr",
        margin: 0,
      };
    } else {
      classification = {
        ...classification,
        predicted_label: "unknown",
        match_source: "none",
        margin: 0,
      };
    }
  }
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

  const preFb = bundle?.classificationPreFallback ?? null;

  const placeCard = {
    file: fileField,
    predicted_label: cls.predicted_label,
    routing_label: rout?.routing_label ?? null,
    proposed_destination: rout?.proposed_destination ?? null,
    alternative_destinations: rout?.alternative_destinations ?? [],
    confidence: cls.confidence,
    margin: cls.margin,
    reason: dec?.reason ?? null,
    decision: dec?.decision ?? null,
    match_source: typeof cls.match_source === "string" ? cls.match_source : null,
  };

  if (preFb && typeof preFb === "object") {
    placeCard.classification_pre_fallback = preFb;
  }

  if (stats && stats.count > 0) {
    placeCard.learning_hint = {
      seen: stats.count,
      confidence: stats.confidence,
    };
  }

  return { placeCard };
}

/**
 * Acknowledge user decision when selected label ≠ predicted (no routing changes).
 * Global scope: recordCorrection + copy into references/user for future embeddings.
 * Single scope: logs only — no learning stats and no reference copy (true one-off).
 * @param {{
 *   predicted_label?: string | null,
 *   selected_label?: string | null,
 *   confidence?: number,
 *   file?: string | null,
 *   filePath?: string | null,
 *   scope?: "global" | "single",
 *   extractedText?: string | null,
 *   classification?: object | null,
 *   mismatchSeverity?: "high" | "medium" | "low",
 *   mismatchFingerprint?: string | null,
 *   mismatchReason?: string | null,
 * }} [input]
 */
export async function applyDecision(input = {}) {
  const pred = input.predicted_label;
  const sel = input.selected_label;
  const scope = input.scope === "single" ? "single" : "global";

  if (pred != null && sel != null && String(sel) !== String(pred)) {
    const learnGlobally = scope === "global";
    if (learnGlobally) {
      recordCorrection(pred, sel, { confidence: input.confidence });
    } else {
      let ctx = input.extractedText != null ? String(input.extractedText).trim() : "";
      if (!ctx) {
        const fp = input.file ?? input.filePath ?? lastFile;
        if (typeof fp === "string" && fp.trim()) ctx = basename(fp.trim());
      }
      addRiskSignal({
        predicted_label: pred,
        selected_label: sel,
        context: ctx || null,
        classification: input.classification ?? lastClassification,
        severity: input.mismatchSeverity,
        fingerprint: input.mismatchFingerprint,
        reason: input.mismatchReason,
      });
    }
    recordApplyDecisionOutcome({
      correctionRecorded: learnGlobally,
      predicted_label: pred,
      selected_label: sel,
    });
    const filePath = input.file ?? input.filePath ?? lastFile ?? null;
    if (learnGlobally && typeof filePath === "string" && filePath.trim()) {
      addUserReference(filePath.trim(), sel);
    }
    console.log(`User decision: ${pred} → ${sel} (${learnGlobally ? "global" : "single"})`);
    try {
      mkdirSync(join(__dirname, "logs"), { recursive: true });
      appendFileSync(
        CONFLICT_LOG,
        `User resolved conflict: ${pred} → ${sel} [${learnGlobally ? "global" : "single"}]${typeof filePath === "string" && filePath.trim() ? ` (${filePath.trim()})` : ""}\n`,
        "utf8",
      );
    } catch {
      /* ignore logging failures */
    }
    return { applied: true, correctionRecorded: learnGlobally, scope };
  }
  return { applied: true, correctionRecorded: false, scope: "none" };
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
  loadIndustryPack,
};

export default engine;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(
    "claira-engine: import { analyze, classify } from this module; supply embeddings in-memory.",
  );
}

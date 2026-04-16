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
  effectiveOversightLevelFromRuntime,
} from "./core/oversightProfile.js";
import { suggestLabelFromText } from "./core/textAnalysis.js";
import { persistReferenceLearning } from "./learning/addUserReference.js";
import { getLearningStats, recordCorrection } from "./learning/learningStore.js";
import { addRiskSignal, applyRiskAdjustment } from "./learning/riskStore.js";
import { recordExemption } from "./policies/exemptions.js";
import { recordExpressPass } from "./policies/expressPass.js";
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
 * Softmax probability for `label` from classifier output (same space as Entrance review threshold).
 * @param {object | null | undefined} cls
 * @param {string | null | undefined} label
 */
function softmaxConfidenceForPredictedLabel(cls, label) {
  if (!cls || typeof cls !== "object" || label == null || String(label).trim() === "") return null;
  const top = /** @type {{ softmaxTop3?: unknown }} */ (cls).softmaxTop3;
  if (!Array.isArray(top)) return null;
  const row = top.find((r) => r && typeof r === "object" && /** @type {{ id?: unknown }} */ (r).id === label);
  const c = row && typeof row === "object" ? /** @type {{ confidence?: unknown }} */ (row).confidence : null;
  return typeof c === "number" && Number.isFinite(c) ? c : null;
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
 *   runtimeContext?: {
 *     appMode?: string,
 *     oversightLevel?: string,
 *     expectedCategory?: string,
 *     strictValidation?: boolean,
 *     reviewThreshold?: number,
 *   },
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
  const oversightLevel = effectiveOversightLevelFromRuntime(runtimeCtx);
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
  let decision = decide({
    predicted_label: classification.predicted_label,
    second_label: classification.second_label,
    confidence: classification.confidence,
    margin: classification.margin,
    thresholds: effectiveThresholds,
    hasRoutingDestination: routing.proposed_destination != null,
    potential_conflict: refCtx?.potential_conflict === true,
  });

  const rtRaw = runtimeCtx.reviewThreshold;
  if (typeof rtRaw === "number" && Number.isFinite(rtRaw)) {
    const floor = Math.min(1, Math.max(0, rtRaw));
    if (decision.decision === "auto") {
      let visSoft = softmaxConfidenceForPredictedLabel(classification, classification.predicted_label);
      if (visSoft == null) {
        visSoft = softmaxConfidenceForPredictedLabel(
          classificationPreFallback,
          classification.predicted_label,
        );
      }
      if (visSoft != null && visSoft < floor) {
        decision = { decision: "review", reason: "entrance_review_threshold" };
      }
    }
  }

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
 * @param {{ classification?: object, routing?: object, decision?: object, file?: string | null, execution?: object, user_control?: object } | null | undefined} [result]
 * @param {{ autoMove?: boolean }} [options] — when `autoMove === false` and decision is auto, sets `execution_mode: "confirm"` (distinct from review).
 */
export async function generatePlaceCard(result, options = {}) {
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

  const exec = bundle?.execution;
  if (exec && typeof exec === "object") {
    if (exec.execution_intent != null) placeCard.execution_intent = exec.execution_intent;
    if (exec.user_override != null) placeCard.user_override = exec.user_override;
  }

  const uc = bundle?.user_control;
  if (uc && typeof uc === "object") {
    placeCard.user_control = { ...uc };
  }

  if (dec?.decision === "auto" && options.autoMove === false) {
    placeCard.execution_mode = "confirm";
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
 * Unified decision API: durable reference learning via {@link persistReferenceLearning} only;
 * session-only behavior via riskStore (single-scope corrections); Express Pass / exemptions are audit-only.
 * User execution control: {@link ./policies/userControl.js}.
 *
 * learningStore holds in-session correction stats for hints — not embedding/classifier state.
 * riskStore adjusts scores in-session only — not persistent reference learning.
 *
 * @param {{
 *   decision_type?: "learning" | "express_pass" | "exemption",
 *   predicted_label?: string | null,
 *   selected_label?: string | null,
 *   selected_room?: string | null,
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
  const decisionType = String(input.decision_type ?? "learning").trim().toLowerCase();
  const fileForPolicy = input.file ?? input.filePath ?? null;
  const selected =
    input.selected_label != null && String(input.selected_label).trim() !== ""
      ? input.selected_label
      : input.selected_room;

  if (decisionType === "express_pass") {
    const pred = String(input.predicted_label ?? "").trim();
    const sel = String(selected ?? "").trim();
    if (!pred) {
      return { applied: false, error: "predicted_label required for express_pass" };
    }
    if (!sel) {
      return { applied: false, error: "selected_label or selected_room required for express_pass" };
    }
    recordExpressPass(
      typeof fileForPolicy === "string" ? fileForPolicy : null,
      pred,
      sel,
    );
    return { applied: true, decision_type: "express_pass" };
  }

  if (decisionType === "exemption") {
    const pred = String(input.predicted_label ?? "").trim();
    const sel = String(selected ?? "").trim();
    if (!pred) {
      return { applied: false, error: "predicted_label required for exemption" };
    }
    if (!sel) {
      return { applied: false, error: "selected_label or selected_room required for exemption" };
    }
    recordExemption(
      typeof fileForPolicy === "string" ? fileForPolicy : null,
      pred,
      sel,
    );
    return { applied: true, decision_type: "exemption" };
  }

  const pred = input.predicted_label;
  const sel = selected;
  const scope = input.scope === "single" ? "single" : "global";

  if (pred == null || sel == null) {
    return { applied: true, correctionRecorded: false, scope: "none" };
  }

  const predStr = String(pred);
  const selStr = String(sel);

  if (predStr === selStr) {
    if (scope === "single") {
      return {
        applied: true,
        correctionRecorded: false,
        scope: "confirm",
        kind: "confirmed_single_no_reference",
      };
    }
    const filePath = input.file ?? input.filePath ?? lastFile ?? null;
    if (typeof filePath !== "string" || !filePath.trim()) {
      console.error("[learning] confirmation requires a local filePath");
      return {
        applied: false,
        error: "no_local_file",
        scope: "confirm",
        referenceLearning: { ok: false, reason: "no_local_file" },
      };
    }
    const ref = persistReferenceLearning(filePath.trim(), predStr);
    if (!ref.ok) {
      console.error(`[learning] confirmation persistReferenceLearning failed: ${ref.reason}`);
      return { applied: false, error: ref.reason, referenceLearning: ref, scope: "confirm" };
    }
    if (ref.skipped) {
      console.log(`[learning] confirmation deduped (${ref.reason})`);
    }
    try {
      mkdirSync(join(__dirname, "logs"), { recursive: true });
      appendFileSync(
        CONFLICT_LOG,
        `User confirmed label: ${predStr} (${filePath.trim()})\n`,
        "utf8",
      );
    } catch {
      /* ignore */
    }
    return {
      applied: true,
      correctionRecorded: false,
      scope: "confirm",
      referenceLearning: ref,
    };
  }

  const learnGlobally = scope === "global";
  if (!learnGlobally) {
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
    recordApplyDecisionOutcome({
      correctionRecorded: false,
      predicted_label: pred,
      selected_label: sel,
    });
    console.log(`User decision: ${predStr} → ${selStr} (single)`);
    try {
      mkdirSync(join(__dirname, "logs"), { recursive: true });
      appendFileSync(
        CONFLICT_LOG,
        `User resolved conflict: ${predStr} → ${selStr} [single]${typeof input.file === "string" && input.file.trim() ? ` (${input.file.trim()})` : ""}\n`,
        "utf8",
      );
    } catch {
      /* ignore logging failures */
    }
    return { applied: true, correctionRecorded: false, scope };
  }

  const filePath = input.file ?? input.filePath ?? lastFile ?? null;
  if (typeof filePath !== "string" || !filePath.trim()) {
    console.error("[learning] global correction requires a local filePath");
    return {
      applied: false,
      error: "no_local_file",
      scope,
      referenceLearning: { ok: false, reason: "no_local_file" },
    };
  }

  const ref = persistReferenceLearning(filePath.trim(), selStr);
  if (!ref.ok) {
    console.error(`[learning] correction persistReferenceLearning failed: ${ref.reason}`);
    try {
      mkdirSync(join(__dirname, "logs"), { recursive: true });
      appendFileSync(
        CONFLICT_LOG,
        `User resolved conflict: ${predStr} → ${selStr} [global] (${filePath.trim()}) REFERENCE_FAILED ${ref.reason}\n`,
        "utf8",
      );
    } catch {
      /* ignore */
    }
    return {
      applied: false,
      error: ref.reason,
      correctionRecorded: false,
      scope,
      referenceLearning: ref,
    };
  }
  if (ref.skipped) {
    console.log(`[learning] correction reference deduped (${ref.reason})`);
  }

  recordCorrection(pred, sel, { confidence: input.confidence });
  recordApplyDecisionOutcome({
    correctionRecorded: true,
    predicted_label: pred,
    selected_label: sel,
  });

  console.log(`User decision: ${predStr} → ${selStr} (global)`);
  try {
    mkdirSync(join(__dirname, "logs"), { recursive: true });
    appendFileSync(
      CONFLICT_LOG,
      `User resolved conflict: ${predStr} → ${selStr} [global] (${filePath.trim()})\n`,
      "utf8",
    );
  } catch {
    /* ignore logging failures */
  }
  return { applied: true, correctionRecorded: true, scope, referenceLearning: ref };
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

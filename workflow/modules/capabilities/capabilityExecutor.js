/**
 * Single-capability runs and planned multi-step runs (controlled chaining only).
 */

import { findBestCapability, getCapabilities } from "./capabilityRegistry.js";

/**
 * @param {string} id
 */
function getCapabilityModuleById(id) {
  const mid = String(id ?? "").trim();
  if (!mid) return null;
  return getCapabilities().find((m) => m.id === mid) ?? null;
}

/**
 * Light merge of prior step outputs into the next step input (deterministic keys only).
 * @param {Record<string, unknown>} baseInput
 * @param {unknown} result
 */
function mergeChainedInput(baseInput, result) {
  const next = { ...baseInput };
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    next.previousStepResult = result;
    return next;
  }
  const r = /** @type {Record<string, unknown>} */ (result);
  for (const k of [
    "suggestedFilename",
    "suggestedTags",
    "tags",
    "suggestedFolderPath",
    "width",
    "height",
    "format",
    "summary",
  ]) {
    if (k in r && r[k] != null) next[k] = r[k];
  }
  next.previousStepResult = result;
  return next;
}

/**
 * @param {Array<{ step: number, moduleId: string }>} plan
 * @param {{
 *   intentCandidates: Array<{ label?: string, score?: number | null }>,
 *   refinedCategory?: string | null,
 *   inputData?: Record<string, unknown>,
 * }} rowContext
 * @returns {Promise<{
 *   steps: Array<{ moduleId: string, result: unknown, step: number }>,
 *   finalResult: unknown,
 *   finalModuleId: string | null,
 *   explanation: string,
 * }>}
 */
export async function executePlannedCapabilities(plan, rowContext) {
  const safePlan = Array.isArray(plan) ? plan.slice(0, 5) : [];
  const intentCandidates = Array.isArray(rowContext.intentCandidates) ? rowContext.intentCandidates : [];
  const refinedCategory = rowContext.refinedCategory ?? null;
  let inputData =
    rowContext.inputData != null && typeof rowContext.inputData === "object" && !Array.isArray(rowContext.inputData)
      ? /** @type {Record<string, unknown>} */ ({ ...rowContext.inputData })
      : {};

  /** @type {Array<{ moduleId: string, result: unknown, step: number }>} */
  const steps = [];
  /** @type {unknown} */
  let lastResult = null;
  /** @type {string | null} */
  let lastModuleId = null;

  /** @type {import("./capabilityContract.js").CapabilityRunContext} */
  const context = {
    intentCandidates: intentCandidates.map((c) => ({
      label: typeof c?.label === "string" ? c.label : "",
      score: typeof c?.score === "number" && Number.isFinite(c.score) ? c.score : null,
    })),
    refinedCategory,
    inputData,
  };

  for (const item of safePlan) {
    const moduleId = String(item.moduleId ?? "").trim();
    const stepNum = typeof item.step === "number" && item.step > 0 ? item.step : steps.length + 1;
    const mod = getCapabilityModuleById(moduleId);
    if (mod == null) {
      const err = { error: true, message: `Unknown or unregistered module: ${moduleId}` };
      steps.push({ moduleId, result: err, step: stepNum });
      lastResult = err;
      lastModuleId = moduleId;
      inputData = mergeChainedInput(inputData, err);
      continue;
    }
    context.inputData = inputData;
    let result;
    try {
      result = await Promise.resolve(mod.run(inputData, context));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result = { error: true, message: msg };
    }
    steps.push({ moduleId, result, step: stepNum });
    lastResult = result;
    lastModuleId = moduleId;
    inputData = mergeChainedInput(inputData, result);
  }

  const explanation =
    steps.length > 0
      ? `Planned run (${steps.length} step(s)): ${steps.map((s) => s.moduleId).join(" → ")}`
      : "Empty plan; no steps executed.";

  return {
    steps,
    finalResult: lastResult,
    finalModuleId: lastModuleId,
    explanation,
  };
}

/**
 * @param {{
 *   intentCandidates: Array<{ label?: string, score?: number | null }>,
 *   refinedCategory?: string | null,
 *   inputData?: Record<string, unknown>,
 * }} params
 * @returns {{
 *   moduleId: string | null,
 *   result: unknown,
 *   confidence: number,
 *   explanation: string,
 * }}
 */
export async function executeCapability(params) {
  const intentCandidates = Array.isArray(params.intentCandidates) ? params.intentCandidates : [];
  const refinedCategory = params.refinedCategory;
  const inputData =
    params.inputData != null && typeof params.inputData === "object" && !Array.isArray(params.inputData)
      ? /** @type {Record<string, unknown>} */ ({ ...params.inputData })
      : {};

  const { module, score, breakdown } = findBestCapability(intentCandidates);
  if (module == null) {
    return {
      moduleId: null,
      result: null,
      confidence: 0,
      explanation: `No capability matched intent candidates (${breakdown}).`,
    };
  }

  /** @type {import("./capabilityContract.js").CapabilityRunContext} */
  const context = {
    intentCandidates: intentCandidates.map((c) => ({
      label: typeof c?.label === "string" ? c.label : "",
      score: typeof c?.score === "number" && Number.isFinite(c.score) ? c.score : null,
    })),
    refinedCategory: refinedCategory ?? null,
    inputData,
  };

  let result;
  try {
    result = await Promise.resolve(module.run(inputData, context));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      moduleId: module.id,
      result: { error: true, message: msg },
      confidence: 0,
      explanation: `Capability "${module.id}" threw: ${msg}`,
    };
  }

  const confidence =
    score > 0 ? Math.min(1, Number((0.35 + 0.12 * Math.min(score, 5)).toFixed(4))) : 0.45;

  return {
    moduleId: module.id,
    result,
    confidence,
    explanation: `Selected "${module.id}" (${breakdown}; intent-only matching).`,
    planMode: "single",
  };
}

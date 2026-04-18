/**
 * Per pipeline row: run capability executor once and attach capabilityResult (Node / API).
 */

import { registerAllCapabilities } from "./registerAllCapabilities.js";
import { executeCapability, executePlannedCapabilities } from "./capabilityExecutor.js";
import { planCapabilities } from "./capabilityPlanner.js";
import { extractPipelineRowContext } from "./extractPipelineRowContext.js";
import { clearCapabilitySessionCaches } from "./capabilitySessionCache.js";
import { getCapabilities } from "./capabilityRegistry.js";

let registered = false;

function ensureCapabilities() {
  if (!registered) {
    registerAllCapabilities();
    registered = true;
  }
}

/**
 * @param {unknown[]} rows
 * @param {{ cwd?: string, domainMode?: string, planMode?: "single" | "planned" }} [options]
 * @returns {Promise<unknown[]>}
 */
export async function attachCapabilityResults(rows, options = {}) {
  ensureCapabilities();
  clearCapabilitySessionCaches();
  const cwd = typeof options.cwd === "string" && options.cwd.trim() ? options.cwd.trim() : process.cwd();
  const domainMode =
    typeof options.domainMode === "string" && options.domainMode.trim() ? options.domainMode.trim() : "general";
  const planMode = options.planMode === "planned" ? "planned" : "single";
  const list = Array.isArray(rows) ? rows : [];
  /** @type {unknown[]} */
  const out = [];

  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    if (row == null || typeof row !== "object" || Array.isArray(row)) {
      out.push(row);
      continue;
    }
    const { intentCandidates, refinedCategory, inputData } = extractPipelineRowContext(row, cwd, {
      allRows: list,
      rowIndex: i,
      attachDomainMode: domainMode,
      attachPlanMode: planMode,
    });
    const mergedInput = { ...inputData, cwd, paths: inputData.fileList };

    /** @type {Record<string, unknown>} */
    let capBox;
    if (planMode === "planned") {
      const available = getCapabilities().map((m) => m.id);
      const plan = planCapabilities({
        intentCandidates,
        refinedCategory,
        domainMode: typeof inputData.domainMode === "string" ? inputData.domainMode : domainMode,
        availableModules: available,
      });
      if (plan.length === 0) {
        const cap = await executeCapability({
          intentCandidates,
          refinedCategory,
          inputData: mergedInput,
        });
        capBox = {
          moduleId: cap.moduleId,
          result: cap.result,
          confidence: cap.confidence,
          explanation: `${cap.explanation} (planned mode; empty plan — single fallback).`,
          planMode: "planned",
          plan: [],
          planSteps: [],
        };
      } else {
        const planned = await executePlannedCapabilities(plan, {
          intentCandidates,
          refinedCategory,
          inputData: mergedInput,
        });
        const plannedOkSteps = planned.steps.filter((s) => {
          const r = s.result;
          if (r == null || typeof r !== "object" || Array.isArray(r)) return true;
          return /** @type {{ error?: boolean }} */ (r).error !== true;
        }).length;
        capBox = {
          moduleId: planned.finalModuleId,
          result: planned.finalResult,
          confidence: Math.min(1, Number((0.38 + 0.11 * Math.min(plan.length, 5)).toFixed(4))),
          explanation: planned.explanation,
          planMode: "planned",
          plan,
          planSteps: planned.steps,
          plannedStepCount: planned.steps.length,
          plannedOkSteps,
        };
      }
    } else {
      const cap = await executeCapability({
        intentCandidates,
        refinedCategory,
        inputData: mergedInput,
      });
      capBox = {
        moduleId: cap.moduleId,
        result: cap.result,
        confidence: cap.confidence,
        explanation: cap.explanation,
        planMode: "single",
      };
    }

    out.push({
      .../** @type {Record<string, unknown>} */ (row),
      capabilityDomainMode: domainMode,
      capabilityPlanMode: planMode,
      capabilityResult: capBox,
    });
  }
  return out;
}

/**
 * Re-run capability for one row with optional input overrides (dry-run; no full pipeline). Does not clear hash caches.
 * @param {{
 *   row: unknown,
 *   rowIndex: number,
 *   allRows: unknown[],
 *   cwd?: string,
 *   inputOverrides?: Record<string, unknown>,
 * }} params
 * @returns {Promise<{ moduleId: string | null, result: unknown, confidence: number, explanation: string }>}
 */
export async function previewCapabilityForRow(params) {
  ensureCapabilities();
  const row = params.row;
  const rowIndex = typeof params.rowIndex === "number" && params.rowIndex >= 0 ? params.rowIndex : 0;
  const allRows = Array.isArray(params.allRows) ? params.allRows : [];
  const cwd = typeof params.cwd === "string" && params.cwd.trim() ? params.cwd.trim() : process.cwd();
  const inputOverrides =
    params.inputOverrides != null && typeof params.inputOverrides === "object" && !Array.isArray(params.inputOverrides)
      ? params.inputOverrides
      : {};

  if (row == null || typeof row !== "object" || Array.isArray(row)) {
    return {
      moduleId: null,
      result: null,
      confidence: 0,
      explanation: "Invalid row for preview.",
    };
  }

  const { intentCandidates, refinedCategory, inputData } = extractPipelineRowContext(row, cwd, {
    allRows,
    rowIndex,
  });
  const merged = { ...inputData, ...inputOverrides, cwd };
  const fileList = Array.isArray(merged.fileList) ? merged.fileList : inputData.fileList;
  const cap = await executeCapability({
    intentCandidates,
    refinedCategory,
    inputData: { ...merged, paths: fileList },
  });
  return cap;
}

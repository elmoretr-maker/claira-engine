/**
 * ModuleHost — runs outside the Claira Engine; consumes sealed API-level pipeline output only.
 */

import { createSealedEngineOutput } from "./sealedEngineOutput.js";
import { readWorkflowTemplateFromActivePack } from "../trainer/readWorkflowTemplate.js";
import { getModuleDefinition } from "../modules/registry.js";
import { assertWorkflowTemplateContract } from "../validation/workflowTemplateContract.js";
import { readActivePackIndustry, readPackWorkflowSource } from "../../interfaces/packReference.js";

/**
 * @returns {string}
 */
function newExecutionId() {
  const c = /** @type {{ randomUUID?: () => string }} */ (globalThis.crypto);
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Context is boundary-normalized: use entityId only (API layer maps clientId → entityId).
 * @param {unknown} engineOutput — raw pipeline return (sealed before modules run)
 * @param {{ entityId?: string, cwd?: string, templateId?: string }} context
 * @returns {{ moduleErrors: string[] }}
 */
export function dispatchPostPipeline(engineOutput, context) {
  const entityId = String(context?.entityId ?? "").trim();
  if (!entityId) return { moduleErrors: [] };

  const packSlug = readActivePackIndustry();
  if (!packSlug) {
    throw new Error(
      "dispatchPostPipeline: no active pack — cannot resolve workflow_template.json (set active pack first)",
    );
  }

  const sourceHint = `packs/${packSlug}/workflow_template.json`;
  const template = readWorkflowTemplateFromActivePack();
  if (!template) {
    throw new Error(`dispatchPostPipeline: ${sourceHint} is missing`);
  }

  const wfSrc = readPackWorkflowSource(packSlug);
  if (wfSrc !== "generated") {
    throw new Error(
      "dispatchPostPipeline: modular workflow runs only for custom-built packs (pack.workflowSource must be \"generated\")",
    );
  }

  assertWorkflowTemplateContract(template, sourceHint);

  const tid = /** @type {string} */ (/** @type {{ templateId: string }} */ (template).templateId);
  const moduleIds = /** @type {string[]} */ (
    /** @type {{ modules: string[] }} */ (template).modules
  );

  const executionId = newExecutionId();

  console.log(
    `[ModuleHost] executionId=${executionId} templateId=${tid} modules=[${moduleIds.join(", ")}]`,
  );

  const sealed = createSealedEngineOutput(engineOutput);
  const ctx = {
    entityId,
    cwd: context?.cwd ? String(context.cwd) : "",
    templateId: tid,
    template,
    executionId,
  };

  /** @type {string[]} */
  const moduleErrors = [];

  for (const moduleId of moduleIds) {
    const def = getModuleDefinition(moduleId);
    if (!def || typeof def.post_pipeline !== "function") {
      throw new Error(
        `dispatchPostPipeline: module "${moduleId}" has no registered post_pipeline handler (registry out of sync)`,
      );
    }
    console.log(`[ModuleHost] executionId=${executionId} module=${moduleId} start`);
    try {
      def.post_pipeline(sealed, ctx);
      console.log(`[ModuleHost] executionId=${executionId} module=${moduleId} ok`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ModuleHost] executionId=${executionId} module=${moduleId} error=${msg}`, e);
      moduleErrors.push(`${moduleId}: ${msg}`);
    }
  }

  return { moduleErrors };
}

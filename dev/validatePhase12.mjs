/**
 * Phase 12 — Claira reasoning provider integration.
 * Run: node dev/validatePhase12.mjs
 */
import { validatePipelineConfiguration } from "../workflow/pipeline/validatePipelineConfiguration.js";
import { runPhase10Pipeline, PHASE10_PIPELINE } from "../workflow/watcher/runPhase10Pipeline.mjs";
import {
  clearClairaReasoningProvider,
  defaultWorkflowClairaReasoning,
  setClairaReasoningProvider,
} from "../workflow/integrations/clairaReasoningProvider.js";
import { clearImageAnalysisProvider, setImageAnalysisProvider } from "../workflow/integrations/imageAnalysisProvider.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

const hfFixture = {
  id: "phase12_hf",
  analyzeImage(asset) {
    const ref = String(asset?.ref ?? "");
    const m = /phase9:\/\/kind\/([\w-]+)/.exec(ref);
    const token = m ? m[1] : "";
    const table = {
      document: { category: "document", labels: ["document"] },
      other: { category: "misc", labels: ["unclassified"] },
    };
    const row = table[token] ?? table.other;
    return {
      category: row.category,
      labels: [...row.labels],
      confidence: 0.91,
      features: {},
      embeddings: null,
      modelSource: "mock",
      inferenceInput: {},
    };
  },
};

try {
  assert("pipeline lists claira_reasoning", PHASE10_PIPELINE.includes("claira_reasoning"));
  assert("pipeline validates", validatePipelineConfiguration({ orderedModuleIds: PHASE10_PIPELINE }).ok === true);

  setImageAnalysisProvider(hfFixture);
  setClairaReasoningProvider({
    id: "custom_test",
    refineReasoning: defaultWorkflowClairaReasoning,
  });

  const doc = await runPhase10Pipeline({
    cwd: process.cwd(),
    imagePaths: ["phase9://kind/document"],
    destinationRoot: "Assets",
    dryRun: true,
  });

  const cr = doc.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert("claira row present", cr != null && typeof cr === "object");
  assert("refinedCategory set", typeof cr.refinedCategory === "string" && cr.refinedCategory.length > 0);
  assert("reasoningConfidence present", typeof cr.reasoningConfidence === "number");
  assert("suggestedName enhanced", typeof cr.suggestedName === "string" && cr.suggestedName.includes("claira"));

  const route0 = doc.output.payload.moduleResults?.asset_router?.data?.routing?.items?.[0];
  assert("routing uses refinement toward Documents", route0?.destinationRelPath === "Documents");

  const other = await runPhase10Pipeline({
    cwd: process.cwd(),
    imagePaths: ["phase9://kind/other"],
    destinationRoot: "Assets",
    dryRun: true,
  });

  const route1 = other.output.payload.moduleResults?.asset_router?.data?.routing?.items?.[0];
  assert("ambiguous misc stays Review when validation is low", route1?.destinationRelPath === "Review");

  const hints = other.output.payload.moduleResults?.simple_presentation?.data?.uiModel?.presentationHints;
  assert("presentationHints.clairaReasoning", Array.isArray(hints?.clairaReasoning) && hints.clairaReasoning.length >= 1);

  console.log("\nAll Phase 12 checks passed.\n");
} finally {
  clearImageAnalysisProvider();
  clearClairaReasoningProvider();
}

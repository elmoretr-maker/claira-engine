/**
 * Phase 16 — Semantic memory, group decisions, intent, confidence breakdown.
 * Run: node dev/validatePhase16.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validatePipelineConfiguration } from "../workflow/pipeline/validatePipelineConfiguration.js";
import { runPhase10Pipeline, PHASE10_PIPELINE } from "../workflow/watcher/runPhase10Pipeline.mjs";
import {
  clearClairaReasoningProvider,
  defaultWorkflowClairaReasoning,
  setClairaReasoningProvider,
} from "../workflow/integrations/clairaReasoningProvider.js";
import { clearImageAnalysisProvider, setImageAnalysisProvider } from "../workflow/integrations/imageAnalysisProvider.js";
import { clearFeedbackStore, recordFeedbackEntry } from "../workflow/feedback/feedbackStore.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

const VEC_A = [0.12, 0.88, 0.02, 0.04, 0, 0, 0, 0];
const VEC_B = [0.11, 0.89, 0.03, 0.02, 0, 0, 0, 0];

const phase16Provider = {
  id: "phase16_hf",
  analyzeImage(asset) {
    const ref = String(asset?.ref ?? "").replace(/\\/g, "/");
    const base = ref.includes("/") ? ref.slice(ref.lastIndexOf("/") + 1) : ref;
    if (/toolbar_close_glyph\.png$/i.test(base)) {
      return {
        category: "misc",
        labels: ["unclassified"],
        confidence: 0.55,
        features: {},
        embeddings: VEC_A,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
    if (/^walk_frame_01\.png$/i.test(base)) {
      return {
        category: "document",
        labels: ["document", "scan"],
        confidence: 0.88,
        features: {},
        embeddings: VEC_A,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
    if (/^walk_frame_02\.png$/i.test(base)) {
      return {
        category: "video game asset",
        labels: ["video game asset", "character", "sprite"],
        confidence: 0.9,
        features: {},
        embeddings: VEC_B,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
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

  const feedbackDir = path.join(process.cwd(), "workflow", "feedback", "data");
  fs.mkdirSync(feedbackDir, { recursive: true });
  process.env.FEEDBACK_STORE_PATH = path.join(feedbackDir, `phase16_validate_${Date.now()}.json`);

  clearFeedbackStore();
  recordFeedbackEntry({
    originalLabels: ["misc"],
    refinedCategory: "misc",
    userCorrectedCategory: "ui element",
    filename: "glyph_alpha.png",
    semanticTokens: ["glyph", "toolbar", "alpha"],
    labelThemes: ["ui"],
    embeddingSignature: [...VEC_A],
  });
  recordFeedbackEntry({
    originalLabels: ["misc"],
    refinedCategory: "misc",
    userCorrectedCategory: "ui element",
    filename: "glyph_beta.png",
    semanticTokens: ["glyph", "toolbar", "beta"],
    labelThemes: ["ui"],
    embeddingSignature: [...VEC_B],
  });

  setImageAnalysisProvider(phase16Provider);
  setClairaReasoningProvider({
    id: "phase16_test",
    refineReasoning: defaultWorkflowClairaReasoning,
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claira-p16-"));
  const glyphPath = path.join(tmp, "toolbar_close_glyph.png");
  fs.writeFileSync(glyphPath, "x");

  const memRun = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [glyphPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const cr0 = memRun.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert("semantic memory match score", typeof cr0?.semanticMatchScore === "number" && cr0.semanticMatchScore > 0.35);
  assert("confidence breakdown present", cr0?.confidenceBreakdown?.perceptionConfidence != null);
  assert("intent inferred", typeof cr0?.inferredIntent === "string" && cr0.inferredIntent.length > 2);
  assert("intent candidates ranked", Array.isArray(cr0?.intentCandidates) && cr0.intentCandidates.length >= 1);
  assert("intent source set", cr0?.intentSource === "inferred" || cr0?.intentSource === "learned" || cr0?.intentSource === "fallback");
  assert("group prior present for batch", cr0?.groupPrior != null && typeof cr0.groupPrior.groupConfidence === "number");
  assert("effective semantic threshold", typeof cr0?.effectiveThresholds?.cosineSemantic === "number");

  const icon1 = path.join(tmp, "walk_frame_01.png");
  const icon2 = path.join(tmp, "walk_frame_02.png");
  for (const p of [icon1, icon2]) fs.writeFileSync(p, "x");

  const grp = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [icon1, icon2],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const items = grp.output.payload.moduleResults?.claira_reasoning?.data?.items;
  assert("group decision applied after category conflict", items?.[0]?.groupDecisionApplied === true);
  assert("group decision payload marks override", items?.[0]?.clairaReasoning?.groupDecision?.categoryOverride === true);
  assert("unified naming frame token", String(items?.[0]?.suggestedName ?? "").includes("frame_01"));
  assert("claira suffix preserved", String(items?.[0]?.suggestedName ?? "").includes("claira"));

  const other = await runPhase10Pipeline({
    cwd: process.cwd(),
    imagePaths: ["phase9://kind/other"],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const routeOther = other.output.payload.moduleResults?.asset_router?.data?.routing?.items?.[0];
  assert("ambiguous misc stays Review when validation is low", routeOther?.destinationRelPath === "Review");

  console.log("\nAll Phase 16 checks passed.\n");
} finally {
  clearImageAnalysisProvider();
  clearClairaReasoningProvider();
  clearFeedbackStore();
  try {
    if (process.env.FEEDBACK_STORE_PATH && fs.existsSync(process.env.FEEDBACK_STORE_PATH)) {
      fs.unlinkSync(process.env.FEEDBACK_STORE_PATH);
    }
  } catch {
    /* ignore */
  }
  delete process.env.FEEDBACK_STORE_PATH;
}

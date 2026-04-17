/**
 * Phase 15 — Semantic batch + embedding similarity + group awareness.
 * Run: node dev/validatePhase15.mjs
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
import { clearFeedbackStore } from "../workflow/feedback/feedbackStore.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

/** 8-dim mock CLIP vectors — A/B similar, C orthogonal */
const VEC_A = [0.12, 0.88, 0.02, 0.04, 0.0, 0.0, 0.0, 0.0];
const VEC_B = [0.1, 0.9, 0.03, 0.02, 0.0, 0.0, 0.0, 0.0];
const VEC_C = [0.9, 0.05, 0.02, 0.01, 0.0, 0.0, 0.0, 0.0];

const phase15Provider = {
  id: "phase15_hf",
  analyzeImage(asset) {
    const ref = String(asset?.ref ?? "").replace(/\\/g, "/");
    const base = ref.includes("/") ? ref.slice(ref.lastIndexOf("/") + 1) : ref;
    if (/^icon_\d+\.png$/i.test(base)) {
      const n = /icon_(\d+)/i.exec(base);
      const idx = n ? parseInt(n[1], 10) : 0;
      return {
        category: "ui element",
        labels: ["ui element", "icon", "interface"],
        confidence: 0.9,
        features: {},
        embeddings: idx <= 1 ? VEC_A : VEC_B,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
    if (/^hero_portrait\.png$/i.test(base)) {
      return {
        category: "photograph",
        labels: ["photograph", "portrait"],
        confidence: 0.9,
        features: {},
        embeddings: VEC_C,
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
  assert("pipeline unchanged", PHASE10_PIPELINE.includes("claira_reasoning"));
  assert("pipeline validates", validatePipelineConfiguration({ orderedModuleIds: PHASE10_PIPELINE }).ok === true);

  const feedbackDir = path.join(process.cwd(), "workflow", "feedback", "data");
  fs.mkdirSync(feedbackDir, { recursive: true });
  process.env.FEEDBACK_STORE_PATH = path.join(feedbackDir, `phase15_validate_${Date.now()}.json`);
  clearFeedbackStore();

  setImageAnalysisProvider(phase15Provider);
  setClairaReasoningProvider({
    id: "phase15_test",
    refineReasoning: defaultWorkflowClairaReasoning,
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claira-p15-"));
  const icon1 = path.join(tmp, "icon_01.png");
  const icon2 = path.join(tmp, "icon_02.png");
  const hero = path.join(tmp, "hero_portrait.png");
  for (const p of [icon1, icon2, hero]) fs.writeFileSync(p, "x");

  const batch = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [icon1, icon2, hero],
    destinationRoot: "Assets",
    dryRun: true,
  });

  const items = batch.output.payload.moduleResults?.claira_reasoning?.data?.items;
  assert("three claira rows", Array.isArray(items) && items.length === 3);

  const iconRow = items[0];
  assert("semantic similarity present", typeof iconRow?.semanticSimilarityScore === "number");
  assert("group id for batch mates", typeof iconRow?.groupId === "string" && iconRow.groupId.startsWith("grp_"));
  assert("group type icon pack or filename", /icon_pack|filename_sequence|embedding_cluster/.test(String(iconRow?.groupType ?? "")));
  assert("alternatives listed", Array.isArray(iconRow?.alternativeCategories) && iconRow.alternativeCategories.length >= 1);
  assert("reasoning explanation present", typeof iconRow?.reasoningExplanation === "string" && iconRow.reasoningExplanation.length > 40);
  assert("hierarchy hint in payload", iconRow?.clairaReasoning?.hierarchySubcategory != null || String(iconRow?.reasoningExplanation ?? "").includes("UI"));

  const name0 = String(items[0]?.suggestedName ?? "");
  assert("suggestedName still branded claira", name0.includes("claira"));

  // Ambiguous misc still Review (Phase 12 contract)
  const other = await runPhase10Pipeline({
    cwd: process.cwd(),
    imagePaths: ["phase9://kind/other"],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const routeOther = other.output.payload.moduleResults?.asset_router?.data?.routing?.items?.[0];
  assert("ambiguous misc stays Review when validation is low", routeOther?.destinationRelPath === "Review");

  console.log("\nAll Phase 15 checks passed.\n");
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

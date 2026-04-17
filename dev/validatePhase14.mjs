/**
 * Phase 14 — Advanced reasoning + semantic naming (provider-only).
 * Run: node dev/validatePhase14.mjs
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

const phase12Style = {
  id: "phase14_hf",
  analyzeImage(asset) {
    const ref = String(asset?.ref ?? "").replace(/\\/g, "/");
    const base = ref.includes("/") ? ref.slice(ref.lastIndexOf("/") + 1) : ref;
    if (/player_idle|sprite_sheet/i.test(base)) {
      return {
        category: "video game asset",
        labels: ["video game asset", "character", "sprite", "idle"],
        confidence: 0.92,
        features: {},
        embeddings: null,
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
  const feedbackFile = path.join(feedbackDir, `phase14_validate_${Date.now()}.json`);
  process.env.FEEDBACK_STORE_PATH = feedbackFile;

  setImageAnalysisProvider(phase12Style);
  setClairaReasoningProvider({
    id: "phase14_test",
    refineReasoning: defaultWorkflowClairaReasoning,
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claira-p14-"));
  const richPath = path.join(tmp, "player_idle_sprite.png");
  fs.writeFileSync(richPath, "x");

  const rich = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [richPath],
    destinationRoot: "Assets",
    dryRun: true,
  });

  const crRich = rich.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert("semantic naming uses multiple tokens", typeof crRich?.suggestedName === "string");
  const stemPart = String(crRich.suggestedName).split("_claira_")[0] ?? "";
  const tokenCount = stemPart.split("_").filter(Boolean).length;
  assert("suggestedName stem has rich snake_case parts", tokenCount >= 3, stemPart);
  assert("reasoning notes mention themes or inference", /theme|inferred|label|Claira/i.test(String(crRich?.reasoningNotes ?? "")));
  assert("clairaReasoning exposes semanticTokens", Array.isArray(crRich?.clairaReasoning?.semanticTokens));

  const routeGame = rich.output.payload.moduleResults?.asset_router?.data?.routing?.items?.[0];
  assert("multi-label routes toward Game", routeGame?.destinationRelPath === "Game");

  // Feedback history boosts reasoning output
  clearFeedbackStore();
  recordFeedbackEntry({
    originalLabels: ["misc"],
    refinedCategory: "misc",
    userCorrectedCategory: "document",
    filename: "player_idle_sprite.png",
  });
  recordFeedbackEntry({
    originalLabels: ["misc"],
    refinedCategory: "misc",
    userCorrectedCategory: "document",
    filename: "player_idle_sprite.png",
  });

  const withFb = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [richPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const crFb = withFb.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert("feedback learning surfaced in claira payload", crFb?.clairaReasoning?.feedbackLearning != null);
  assert(
    "reasoningNotes reference feedback when learned",
    /feedback|learned|match/i.test(String(crFb?.reasoningNotes ?? "")),
  );

  // Ambiguous misc + low validation still Review (Phase 12 contract)
  clearFeedbackStore();
  const other = await runPhase10Pipeline({
    cwd: process.cwd(),
    imagePaths: ["phase9://kind/other"],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const routeOther = other.output.payload.moduleResults?.asset_router?.data?.routing?.items?.[0];
  assert("ambiguous misc stays Review when validation is low", routeOther?.destinationRelPath === "Review");

  console.log("\nAll Phase 14 checks passed.\n");
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

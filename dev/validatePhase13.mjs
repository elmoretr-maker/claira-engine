/**
 * Phase 13 — User feedback + override + learned routing.
 * Run: node dev/validatePhase13.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { validatePipelineConfiguration } from "../workflow/pipeline/validatePipelineConfiguration.js";
import { runPhase10Pipeline, PHASE10_PIPELINE } from "../workflow/watcher/runPhase10Pipeline.mjs";
import {
  clearClairaReasoningProvider,
  defaultWorkflowClairaReasoning,
  setClairaReasoningProvider,
} from "../workflow/integrations/clairaReasoningProvider.js";
import { clearImageAnalysisProvider, setImageAnalysisProvider } from "../workflow/integrations/imageAnalysisProvider.js";
import {
  clearFeedbackStore,
  recordFeedbackEntry,
} from "../workflow/feedback/feedbackStore.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

const hfFixture = {
  id: "phase13_hf",
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
  assert("pipeline unchanged (no new module ids)", PHASE10_PIPELINE.join(",") === [
    "image_input",
    "basic_classifier",
    "structured_output",
    "asset_validation",
    "claira_reasoning",
    "asset_router",
    "asset_mover",
    "simple_presentation",
  ].join(","));
  assert("pipeline validates", validatePipelineConfiguration({ orderedModuleIds: PHASE10_PIPELINE }).ok === true);

  const feedbackDir = path.join(process.cwd(), "workflow", "feedback", "data");
  fs.mkdirSync(feedbackDir, { recursive: true });
  const feedbackFile = path.join(feedbackDir, `phase13_validate_${Date.now()}.json`);
  process.env.FEEDBACK_STORE_PATH = feedbackFile;

  setImageAnalysisProvider(hfFixture);
  setClairaReasoningProvider({
    id: "phase13_test",
    refineReasoning: defaultWorkflowClairaReasoning,
  });

  // --- Learned correction shifts routing after repeated store entries ---
  clearFeedbackStore();
  recordFeedbackEntry({
    originalLabels: ["document"],
    refinedCategory: "document",
    userCorrectedCategory: "photograph",
    filename: "document",
  });
  recordFeedbackEntry({
    originalLabels: ["document"],
    refinedCategory: "document",
    userCorrectedCategory: "photograph",
    filename: "document",
  });

  const learnedDoc = await runPhase10Pipeline({
    cwd: process.cwd(),
    imagePaths: ["phase9://kind/document"],
    destinationRoot: "Assets",
    dryRun: true,
  });

  const learnedRoute = learnedDoc.output.payload.moduleResults?.asset_router?.data?.routing?.items?.[0];
  assert("learned routing moves document asset to Reference", learnedRoute?.destinationRelPath === "Reference");
  assert("decisionSource is learned", learnedRoute?.decisionSource === "learned");
  assert("learnedApplied flag", learnedRoute?.learnedApplied === true);

  // --- Immediate override wins over classifier + is recorded ---
  clearFeedbackStore();
  const baseline = await runPhase10Pipeline({
    cwd: process.cwd(),
    imagePaths: ["phase9://kind/other"],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const assetId = baseline.output.payload.moduleResults?.asset_router?.data?.routing?.items?.[0]?.assetId;
  assert("baseline asset id present", typeof assetId === "string" && assetId.length > 0);

  const overridden = await runPhase10Pipeline({
    cwd: process.cwd(),
    imagePaths: ["phase9://kind/other"],
    destinationRoot: "Assets",
    dryRun: true,
    feedback: {
      persistCorrections: true,
      immediateOverrides: [{ assetId, userCorrectedCategory: "document", userRenamedTo: "user_override.png" }],
    },
  });

  const oRoute = overridden.output.payload.moduleResults?.asset_router?.data?.routing?.items?.[0];
  assert("immediate override destination", oRoute?.destinationRelPath === "Documents");
  assert("immediate override decisionSource", oRoute?.decisionSource === "user_immediate");
  assert("userCorrected set", oRoute?.userCorrected === true);
  assert("rename hint on routing item", oRoute?.userRenamedTo === "user_override.png");

  const raw = fs.readFileSync(feedbackFile, "utf8");
  const persisted = JSON.parse(raw);
  assert("feedback store recorded override", Array.isArray(persisted.entries) && persisted.entries.length >= 1);

  const mover = overridden.output.payload.moduleResults?.asset_mover?.data;
  const move0 = Array.isArray(mover?.moveLog) ? mover.moveLog[0] : null;
  assert("mover honors rename override", String(move0?.destinationSimulated ?? "").includes("user_override.png"));

  // --- Review queue surfaces in presentation for Review-bound assets ---
  clearFeedbackStore();
  const reviewRun = await runPhase10Pipeline({
    cwd: process.cwd(),
    imagePaths: ["phase9://kind/other"],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const hints = reviewRun.output.payload.moduleResults?.simple_presentation?.data?.uiModel?.presentationHints;
  assert("review queue present", Array.isArray(hints?.reviewQueue) && hints.reviewQueue.length === 1);
  assert("review queue ties to routing metadata", hints.reviewQueue[0]?.decisionSource === "ai");

  console.log("\nAll Phase 13 checks passed.\n");
} finally {
  clearImageAnalysisProvider();
  clearClairaReasoningProvider();
  try {
    if (process.env.FEEDBACK_STORE_PATH && fs.existsSync(process.env.FEEDBACK_STORE_PATH)) {
      fs.unlinkSync(process.env.FEEDBACK_STORE_PATH);
    }
  } catch {
    /* ignore */
  }
  delete process.env.FEEDBACK_STORE_PATH;
}

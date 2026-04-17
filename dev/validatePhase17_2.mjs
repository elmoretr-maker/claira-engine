import 'dotenv/config';
/**
 * Phase 17.2 — Signal agreement, conflict level, context-aware thresholds.
 * Run: node dev/validatePhase17_2.mjs
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
const VEC_Z = [0.02, 0.01, 0.97, 0.01, 0, 0, 0, 0];

const p172Provider = {
  id: "p172_hf",
  analyzeImage(asset) {
    const ref = String(asset?.ref ?? "").replace(/\\/g, "/");
    const base = ref.includes("/") ? ref.slice(ref.lastIndexOf("/") + 1) : ref;
    if (/high_agree_glyph\.png$/i.test(base)) {
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
    if (/low_agree_z\.png$/i.test(base)) {
      return {
        category: "misc",
        labels: ["unclassified"],
        confidence: 0.4,
        features: {},
        embeddings: VEC_Z,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
    if (/conflict_labels\.png$/i.test(base)) {
      return {
        category: "document",
        labels: ["invoice", "photograph", "sprite"],
        confidence: 0.62,
        features: {},
        embeddings: VEC_A,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
    return {
      category: "misc",
      labels: ["unclassified"],
      confidence: 0.5,
      features: {},
      embeddings: VEC_A,
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
  process.env.FEEDBACK_STORE_PATH = path.join(feedbackDir, `phase172_validate_${Date.now()}.json`);

  clearFeedbackStore();
  recordFeedbackEntry({
    originalLabels: ["misc"],
    refinedCategory: "misc",
    userCorrectedCategory: "ui element",
    filename: "glyph_alpha.png",
    semanticTokens: ["glyph", "toolbar"],
    labelThemes: ["ui"],
    embeddingSignature: [...VEC_A],
  });

  setImageAnalysisProvider(p172Provider);
  setClairaReasoningProvider({ id: "p172_test", refineReasoning: defaultWorkflowClairaReasoning });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claira-p172-"));

  const highPath = path.join(tmp, "high_agree_glyph.png");
  fs.writeFileSync(highPath, "x");
  const highRun = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [highPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const hi = highRun.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert("phase17_2 flag", hi?.clairaReasoning?.phase17_2 === true);
  assert("signalAgreementScore in range", typeof hi?.signalAgreementScore === "number" && hi.signalAgreementScore >= 0 && hi.signalAgreementScore <= 1);
  assert("signalConflictLevel enum", ["low", "medium", "high"].includes(String(hi?.signalConflictLevel)));
  assert("effectiveThreshold set", typeof hi?.effectiveThreshold === "number");
  assert("effectiveThresholds.effectiveThreshold matches", hi?.effectiveThreshold === hi?.clairaReasoning?.effectiveThresholds?.effectiveThreshold);
  assert("high agreement: no fallback", hi?.fallbackUsed === false);
  assert("fallbackEscape in thresholds", typeof hi?.clairaReasoning?.effectiveThresholds?.fallbackEscape === "number");

  const lowPath = path.join(tmp, "low_agree_z.png");
  fs.writeFileSync(lowPath, "x");
  const lowRun = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [lowPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const lo = lowRun.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert("low agreement: effectiveThreshold differs from base cosine", lo?.effectiveThreshold !== lo?.effectiveThresholds?.cosineSemantic);
  assert("low agreement: higher fallback escape vs high-agree (weaker signals)", (lo?.effectiveThresholds?.fallbackEscape ?? 0) >= (hi?.effectiveThresholds?.fallbackEscape ?? 1) - 1e-6);

  const cxPath = path.join(tmp, "conflict_labels.png");
  fs.writeFileSync(cxPath, "x");
  const cxRun = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [cxPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const cx = cxRun.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert("conflicting labels: conflict not low", String(cx?.signalConflictLevel) !== "low" || cx?.signalAgreementScore < 0.72);

  const r1 = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [highPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const r2 = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [highPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const a = r1.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  const b = r2.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert(
    "deterministic phase 17.2 fields",
    a?.signalAgreementScore === b?.signalAgreementScore &&
      a?.effectiveThreshold === b?.effectiveThreshold &&
      String(a?.signalConflictLevel) === String(b?.signalConflictLevel),
  );

  console.log("\nAll Phase 17.2 checks passed.\n");
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

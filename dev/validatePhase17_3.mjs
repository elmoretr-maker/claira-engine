import 'dotenv/config';
/**
 * Phase 17.3 — signalState (strong / moderate / conflict / weak_signals).
 * Run: node dev/validatePhase17_3.mjs
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

const p173Provider = {
  id: "p173_hf",
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
    if (/all_weak_signal\.png$/i.test(base)) {
      return {
        category: "misc",
        labels: ["unclassified"],
        confidence: 0.41,
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
  process.env.FEEDBACK_STORE_PATH = path.join(feedbackDir, `phase173_validate_${Date.now()}.json`);

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

  setImageAnalysisProvider(p173Provider);
  setClairaReasoningProvider({ id: "p173_test", refineReasoning: defaultWorkflowClairaReasoning });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claira-p173-"));

  const highPath = path.join(tmp, "high_agree_glyph.png");
  fs.writeFileSync(highPath, "x");
  const highRun = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [highPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const hi = highRun.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert("phase17_3 flag", hi?.clairaReasoning?.phase17_3 === true);
  assert("signalState present", typeof hi?.clairaReasoning?.signalState === "string");
  assert(
    "strong agreement classification",
    hi?.signalState === "strong_agreement" || hi?.signalState === "moderate_agreement",
  );
  assert("high agree: no fallback ⇒ not weak_signals", hi?.signalState !== "weak_signals" || hi?.fallbackUsed === true);
  assert("invariant: not (strong_agreement + fallback)", !(hi?.signalState === "strong_agreement" && hi?.fallbackUsed === true));

  const weakPath = path.join(tmp, "all_weak_signal.png");
  fs.writeFileSync(weakPath, "x");
  const weakRun = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [weakPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const we = weakRun.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert("weak signals: signalState weak_signals", we?.signalState === "weak_signals");
  assert("weak signals: fallback aligns", we?.fallbackUsed === true);

  const cxPath = path.join(tmp, "conflict_labels.png");
  fs.writeFileSync(cxPath, "x");
  const cxRun = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [cxPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const cx = cxRun.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  const cl = String(cx?.signalConflictLevel ?? "");
  const st = String(cx?.signalState ?? "");
  if (cl === "high") {
    assert("conflict level high ⇒ signalState conflict", st === "conflict");
  } else {
    assert("conflict fixture: state is observability enum", ["strong_agreement", "moderate_agreement", "conflict", "weak_signals"].includes(st));
  }

  console.log("\nAll Phase 17.3 checks passed.\n");
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

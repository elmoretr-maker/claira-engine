import 'dotenv/config';
/**
 * Phase 17.1 — Precedence + fallback hardening (batch-strong defer, smart fallback, metrics).
 * Run: node dev/validatePhase17_1.mjs
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

const phase171Provider = {
  id: "phase171_hf",
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
    if (/^weak_batch_a\.png$/i.test(base)) {
      return {
        category: "document",
        labels: ["document"],
        confidence: 0.88,
        features: {},
        embeddings: VEC_A,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
    if (/^weak_batch_b\.png$/i.test(base)) {
      return {
        category: "video game asset",
        labels: ["sprite"],
        confidence: 0.88,
        features: {},
        embeddings: VEC_B,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
    if (/^strong_batch_0[12]\.png$/i.test(base)) {
      return {
        category: "document",
        labels: ["document", "scan"],
        confidence: 0.9,
        features: {},
        embeddings: VEC_A,
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
  process.env.FEEDBACK_STORE_PATH = path.join(feedbackDir, `phase171_validate_${Date.now()}.json`);

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

  setImageAnalysisProvider(phase171Provider);
  setClairaReasoningProvider({
    id: "phase171_test",
    refineReasoning: defaultWorkflowClairaReasoning,
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claira-p171-"));

  const glyphPath = path.join(tmp, "toolbar_close_glyph.png");
  fs.writeFileSync(glyphPath, "x");
  const weak = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [glyphPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const w0 = weak.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert("phase17_1 flag", w0?.clairaReasoning?.phase17_1 === true);
  assert("signal completeness object", w0?.clairaReasoning?.signalCompleteness != null);
  assert("fallback fields present", typeof w0?.fallbackUsed === "boolean" && (w0.fallbackReason === null || typeof w0.fallbackReason === "string"));
  assert(
    "weak signal prefers structured intent when possible",
    typeof w0?.inferredIntent === "string" && !/^intent_category_misc$/i.test(String(w0.inferredIntent)),
  );

  const wa = path.join(tmp, "weak_batch_a.png");
  const wb = path.join(tmp, "weak_batch_b.png");
  fs.writeFileSync(wa, "x");
  fs.writeFileSync(wb, "x");
  const weakBatch = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [wa, wb],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const wbItems = weakBatch.output.payload.moduleResults?.claira_reasoning?.data?.items ?? [];
  assert("weak batch: not strong group defer", wbItems[0]?.clairaReasoning?.categoryPrecedence?.batchStrongGroupDefer === false);
  assert("weak batch: precedence may apply", typeof wbItems[0]?.clairaReasoning?.categoryPrecedence?.applied === "boolean");

  const s1 = path.join(tmp, "strong_batch_01.png");
  const s2 = path.join(tmp, "strong_batch_02.png");
  fs.writeFileSync(s1, "x");
  fs.writeFileSync(s2, "x");
  const strongBatch = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [s1, s2],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const sbItems = strongBatch.output.payload.moduleResults?.claira_reasoning?.data?.items ?? [];
  assert("strong batch: defer precedence for group finalize", sbItems[0]?.clairaReasoning?.categoryPrecedence?.batchStrongGroupDefer === true);

  assert("batch fallback metrics", typeof sbItems[0]?.clairaReasoning?.fallbackRate === "number");
  assert(
    "batch fallbackMetrics shape",
    sbItems[0]?.clairaReasoning?.fallbackMetrics != null &&
      typeof sbItems[0].clairaReasoning.fallbackMetrics.batchFallbackRate === "number" &&
      typeof sbItems[0].clairaReasoning.fallbackMetrics.byCategory === "object",
  );

  const r1 = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [glyphPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const r2 = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [glyphPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const g1 = r1.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  const g2 = r2.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert(
    "deterministic fallback behavior",
    String(g1?.inferredIntent) === String(g2?.inferredIntent) && String(g1?.fallbackUsed) === String(g2?.fallbackUsed),
  );

  console.log("\nAll Phase 17.1 checks passed.\n");
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

/**
 * Phase 18 — override feedback as high-confidence correction (deterministic).
 * Run: node dev/validatePhase18Override.mjs
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  clearFeedbackStore,
  computeGroupPatternMemoryMetrics,
  getGroupPatternEntry,
  getOverrideFeedbackGroupSignatures,
  recordFeedbackEntry,
} from "../workflow/feedback/feedbackStore.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

try {
  const feedbackDir = path.join(process.cwd(), "workflow", "feedback", "data");
  fs.mkdirSync(feedbackDir, { recursive: true });
  const storePath = path.join(feedbackDir, "phase18_override_validate.json");
  process.env.FEEDBACK_STORE_PATH = storePath;

  // --- Test 1 — Reinforcement: override outperforms passive same-signal memory ---
  clearFeedbackStore();
  const passive = computeGroupPatternMemoryMetrics(
    {
      groupSignature: "synthetic_passive",
      dominantCategory: "logo",
      hitCount: 1,
      timestamp: 0,
      usageCount: 1,
      successCount: 1,
      incorrectCount: 0,
      userOverridePrioritized: false,
    },
    0.75,
    1,
  );
  recordFeedbackEntry({
    feedbackType: "override",
    lastFeedbackType: "override",
    incorrectCount: 0,
    originalLabels: ["ui"],
    refinedCategory: "misc",
    userCorrectedCategory: "logo",
    filename: "icon_a.png",
    semanticTokens: ["icon", "brand", "vector"],
    labelThemes: ["ui"],
    reasoningContext: { userOverride: true, source: "phase18_override_validate" },
  });
  const sigs = getOverrideFeedbackGroupSignatures({
    refinedCategory: "misc",
    userCorrectedCategory: "logo",
    semanticTokens: ["icon", "brand", "vector"],
    labelThemes: ["ui"],
  });
  const eCorr = getGroupPatternEntry(sigs.corrected);
  assert("reinforcement: corrected pattern exists", eCorr != null);
  const afterOverride = computeGroupPatternMemoryMetrics(/** @type {*} */ (eCorr), 0.75, 1);
  assert(
    "reinforcement: corrected confidence >= passive",
    afterOverride.successRate + 1e-9 >= passive.successRate,
  );
  assert(
    "reinforcement: memoryInfluenceScore > passive same base semantic",
    afterOverride.memoryInfluenceScore > passive.memoryInfluenceScore + 1e-9,
  );

  // --- Test 2 — Penalty: extra incorrectCount reduces influence (fixed success) ---
  const mBeforePen = computeGroupPatternMemoryMetrics(
    {
      groupSignature: "pen_base",
      dominantCategory: "wrong",
      hitCount: 1,
      timestamp: 0,
      usageCount: 4,
      successCount: 2,
      incorrectCount: 0,
      userOverridePrioritized: false,
    },
    0.9,
    1,
  );
  const mAfterPen = computeGroupPatternMemoryMetrics(
    {
      groupSignature: "pen_base",
      dominantCategory: "wrong",
      hitCount: 1,
      timestamp: 0,
      usageCount: 9,
      successCount: 2,
      incorrectCount: 5,
      userOverridePrioritized: false,
    },
    0.9,
    1,
  );
  assert("penalty: influence drops when incorrectCount rises", mAfterPen.memoryInfluenceScore < mBeforePen.memoryInfluenceScore);

  clearFeedbackStore();
  for (let i = 0; i < 6; i++) {
    recordFeedbackEntry({
      feedbackType: "override",
      lastFeedbackType: "override",
      incorrectCount: 0,
      originalLabels: ["x"],
      refinedCategory: "bad_ai_cat",
      userCorrectedCategory: `user_fix_${i}`,
      filename: `f_${i}.png`,
      semanticTokens: ["alpha", "beta"],
      labelThemes: ["gamma"],
      reasoningContext: { userOverride: true },
    });
  }
  const penSig = getOverrideFeedbackGroupSignatures({
    refinedCategory: "bad_ai_cat",
    userCorrectedCategory: "user_fix_0",
    semanticTokens: ["alpha", "beta"],
    labelThemes: ["gamma"],
  }).originalPenalty;
  const penEntry = getGroupPatternEntry(penSig);
  assert("penalty: store tracks incorrect overrides on original bucket", penEntry != null && (penEntry.incorrectCount ?? 0) >= 6);
  const mPenLive = computeGroupPatternMemoryMetrics(/** @type {*} */ (penEntry), 0.85, 1);
  assert("penalty: bounded", mPenLive.memoryInfluenceScore >= 0 && mPenLive.memoryInfluenceScore <= 1);

  // --- Test 3 — Determinism (same payload shape as recordReasoningOverrideFeedbackApi; avoid importing api graph) ---
  clearFeedbackStore();
  const seq = () => {
    recordFeedbackEntry({
      feedbackType: "override",
      incorrectCount: 0,
      lastFeedbackType: "override",
      originalLabels: ["noise"],
      refinedCategory: "noise",
      userCorrectedCategory: "sprite",
      filename: "a.png",
      semanticTokens: ["pixel"],
      labelThemes: ["game"],
      timestamp: 1_700_000_000_000,
      reasoningContext: {
        userOverride: true,
        originalCategory: "noise",
        correctedCategory: "sprite",
        feedbackType: "override",
        source: "det",
      },
    });
  };
  seq();
  seq();
  const snap1 = fs.readFileSync(storePath, "utf8");
  clearFeedbackStore();
  seq();
  seq();
  const snap2 = fs.readFileSync(storePath, "utf8");
  assert("determinism: identical store after replay", snap1 === snap2);

  // --- Test 4 — No over-amplification ---
  clearFeedbackStore();
  recordFeedbackEntry({
    feedbackType: "override",
    lastFeedbackType: "override",
    incorrectCount: 0,
    originalLabels: [],
    refinedCategory: "a",
    userCorrectedCategory: "b",
    filename: "z.png",
    semanticTokens: ["s"],
    labelThemes: ["t"],
    embeddingSignature: Array.from({ length: 24 }, (_, i) => (i + 1) * 0.01),
    reasoningContext: { userOverride: true },
  });
  const eHeavy = getGroupPatternEntry(
    getOverrideFeedbackGroupSignatures({
      refinedCategory: "a",
      userCorrectedCategory: "b",
      semanticTokens: ["s"],
      labelThemes: ["t"],
      embeddingSignature: Array.from({ length: 24 }, (_, i) => (i + 1) * 0.01),
    }).corrected,
  );
  assert("cap: entry exists", eHeavy != null);
  for (let k = 0; k < 40; k++) {
    recordFeedbackEntry({
      feedbackType: "override",
      lastFeedbackType: "override",
      incorrectCount: 0,
      originalLabels: [],
      refinedCategory: "a",
      userCorrectedCategory: "b",
      filename: `z_${k}.png`,
      semanticTokens: ["s"],
      labelThemes: ["t"],
      embeddingSignature: Array.from({ length: 24 }, (_, i) => (i + 1) * 0.01),
      reasoningContext: { userOverride: true },
    });
  }
  const eFinal = getGroupPatternEntry(
    getOverrideFeedbackGroupSignatures({
      refinedCategory: "a",
      userCorrectedCategory: "b",
      semanticTokens: ["s"],
      labelThemes: ["t"],
      embeddingSignature: Array.from({ length: 24 }, (_, i) => (i + 1) * 0.01),
    }).corrected,
  );
  const mCap = computeGroupPatternMemoryMetrics(/** @type {*} */ (eFinal), 1, 1);
  assert("cap: memoryInfluenceScore <= 1", mCap.memoryInfluenceScore <= 1 + 1e-9);

  console.log("\nPhase 18 override validation: all checks passed.");
} catch (e) {
  console.error(e);
  process.exit(1);
}

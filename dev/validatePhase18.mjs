/**
 * Phase 18 — deterministic memory reinforcement + weight tiers.
 * Run: node dev/validatePhase18.mjs
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  clearFeedbackStore,
  computeGroupPatternMemoryMetrics,
  getGroupPatternEntry,
  recordGroupPattern,
  registerGroupPatternOutcome,
  touchGroupPatternUsage,
} from "../workflow/feedback/feedbackStore.js";

/**
 * @param {string} name
 * @param {boolean} cond
 * @param {string} [detail]
 */
function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

/**
 * @param {string} storePath
 */
function readStoreText(storePath) {
  return fs.readFileSync(storePath, "utf8");
}

function replaySequence(storePath) {
  process.env.FEEDBACK_STORE_PATH = storePath;
  clearFeedbackStore();

  recordGroupPattern({
    groupSignature: "grp_alpha",
    dominantCategory: "logo",
    semanticTokens: ["icon", "brand"],
    labelThemes: ["ui"],
    groupType: "cluster",
    routeContext: {
      hierarchyHint: "Assets/UI",
      groupType: "cluster",
      finalCategory: "logo",
    },
  });

  touchGroupPatternUsage("grp_alpha");
  registerGroupPatternOutcome("grp_alpha", "logo");
  touchGroupPatternUsage("grp_alpha");
  registerGroupPatternOutcome("grp_alpha", "logo");
  touchGroupPatternUsage("grp_alpha");
  registerGroupPatternOutcome("grp_alpha", "wrong");

  recordGroupPattern({
    groupSignature: "grp_beta",
    dominantCategory: "sprite",
    semanticTokens: ["pixel", "game"],
    labelThemes: [],
    groupType: "batch",
  });
  touchGroupPatternUsage("grp_beta");
}

try {
  const feedbackDir = path.join(process.cwd(), "workflow", "feedback", "data");
  fs.mkdirSync(feedbackDir, { recursive: true });
  const storePath = path.join(feedbackDir, "phase18_validate_replay.json");

  // --- 1. REPLAY: identical operations → identical on-disk memory state ---
  replaySequence(storePath);
  const snap1 = readStoreText(storePath);
  clearFeedbackStore();
  replaySequence(storePath);
  const snap2 = readStoreText(storePath);
  assert("replay: disk snapshots byte-identical", snap1 === snap2);

  // --- 2. REINFORCEMENT: correct outcomes raise successRate and memoryInfluenceScore ---
  process.env.FEEDBACK_STORE_PATH = path.join(feedbackDir, "phase18_validate_reinforce.json");
  clearFeedbackStore();
  recordGroupPattern({
    groupSignature: "grp_r",
    dominantCategory: "logo",
    semanticTokens: ["a"],
    labelThemes: [],
  });
  const baseSem = 0.75;
  /** @type {number | null} */
  let prevMem = null;
  /** @type {number | null} */
  let prevSr = null;
  for (let i = 0; i < 6; i++) {
    touchGroupPatternUsage("grp_r");
    registerGroupPatternOutcome("grp_r", i < 2 ? "noise" : "logo");
    const e = getGroupPatternEntry("grp_r");
    assert(`reinforcement: entry exists (step ${i})`, e != null);
    const m = computeGroupPatternMemoryMetrics(e, baseSem, 1);
    if (i >= 2) {
      assert(`reinforcement: successRate in [0,1] step ${i}`, m.successRate >= 0 && m.successRate <= 1);
      assert(`reinforcement: memoryInfluenceScore in [0,1] step ${i}`, m.memoryInfluenceScore >= 0 && m.memoryInfluenceScore <= 1);
      if (prevMem != null && prevSr != null) {
        assert(
          `reinforcement: successRate non-decreasing after teaching (step ${i})`,
          m.successRate + 1e-9 >= prevSr,
        );
        assert(
          `reinforcement: memoryInfluenceScore trends up with success (step ${i})`,
          m.memoryInfluenceScore + 1e-9 >= prevMem,
        );
      }
      prevMem = m.memoryInfluenceScore;
      prevSr = m.successRate;
    }
  }
  assert("reinforcement: metrics increased vs early low-success phase", prevMem != null && prevMem > 0.45);

  // --- 3. DECAY: many mismatches lower successRate, tier, and influence ---
  process.env.FEEDBACK_STORE_PATH = path.join(feedbackDir, "phase18_validate_decay.json");
  clearFeedbackStore();
  recordGroupPattern({
    groupSignature: "grp_d",
    dominantCategory: "hero",
    semanticTokens: ["x"],
    labelThemes: [],
  });
  for (let i = 0; i < 8; i++) {
    touchGroupPatternUsage("grp_d");
    registerGroupPatternOutcome("grp_d", "hero");
  }
  const eHigh = getGroupPatternEntry("grp_d");
  assert("decay: entry after warm-up", eHigh != null);
  const mHigh = computeGroupPatternMemoryMetrics(eHigh, 0.9, 1);
  assert("decay: starts high tier", mHigh.weightTier === "high");

  for (let i = 0; i < 30; i++) {
    touchGroupPatternUsage("grp_d");
    registerGroupPatternOutcome("grp_d", "villain");
  }
  const eLow = getGroupPatternEntry("grp_d");
  assert("decay: entry after noise", eLow != null);
  const mLow = computeGroupPatternMemoryMetrics(eLow, 0.9, 1);
  assert("decay: successRate dropped", mLow.successRate < mHigh.successRate);
  assert("decay: weight tier dropped", mLow.weightTier === "low" || mLow.weightTier === "medium");
  assert("decay: memory influence decreased", mLow.memoryInfluenceScore < mHigh.memoryInfluenceScore);
  assert("decay: decay rule can apply (usage>5, sr<0.4)", (eLow.usageCount ?? 0) > 5 && mLow.successRate < 0.4);

  // --- 4. STABILITY: bounded metrics; read-only metric probes do not mutate store ---
  const stablePath = path.join(feedbackDir, "phase18_validate_stable.json");
  process.env.FEEDBACK_STORE_PATH = stablePath;
  clearFeedbackStore();
  recordGroupPattern({
    groupSignature: "grp_s",
    dominantCategory: "z",
    semanticTokens: [],
    labelThemes: [],
  });
  for (const base of [-1, 0, 0.33, 1, 99, NaN]) {
    const e = getGroupPatternEntry("grp_s");
    const m = computeGroupPatternMemoryMetrics(e, base, 1);
    assert(`stability: mem bounded base=${base}`, m.memoryInfluenceScore >= 0 && m.memoryInfluenceScore <= 1);
    assert(`stability: hist bounded base=${base}`, m.historicalConfidence >= 0 && m.historicalConfidence <= 1);
    assert(`stability: weightedMemory bounded base=${base}`, m.weightedMemoryScore >= 0 && m.weightedMemoryScore <= 1);
  }
  const stableSnap1 = readStoreText(stablePath);
  for (const base of [-1, 0, 0.33, 1, 99, NaN]) {
    const e = getGroupPatternEntry("grp_s");
    computeGroupPatternMemoryMetrics(e, base, 1);
  }
  const stableSnap2 = readStoreText(stablePath);
  assert("stability: identical store after repeated metric probes", stableSnap1 === stableSnap2);

  console.log("\nPhase 18 validation: all checks passed.");
} catch (e) {
  console.error(e);
  process.exit(1);
}

/**
 * User-override learning: stronger group reinforcement + deterministic tie-breaks.
 * Run: node dev/validateOverrideLearning.mjs
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  clearFeedbackStore,
  findGroupPatternMatch,
  findSemanticMemoryMatch,
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
  process.env.FEEDBACK_STORE_PATH = path.join(feedbackDir, "validate_override_learning.json");

  clearFeedbackStore();

  recordFeedbackEntry({
    originalLabels: ["misc"],
    refinedCategory: "misc",
    userCorrectedCategory: "sprite_sheet",
    filename: "hero_idle.png",
    semanticTokens: ["pixel", "idle", "hero"],
    labelThemes: ["game"],
    reasoningContext: { userOverride: true, source: "test" },
  });

  const gp = findGroupPatternMatch({
    semanticTokens: ["pixel", "idle", "hero"],
    labelThemes: ["game"],
    embedding: null,
    groupType: null,
  });
  assert("group match prefers user override category", gp != null && gp.dominantCategory === "sprite_sheet");

  clearFeedbackStore();
  recordFeedbackEntry({
    originalLabels: ["a"],
    refinedCategory: "a",
    userCorrectedCategory: "cat_a",
    filename: "f1.png",
    semanticTokens: ["tok"],
    reasoningContext: { userOverride: true },
  });
  recordFeedbackEntry({
    originalLabels: ["b"],
    refinedCategory: "b",
    userCorrectedCategory: "cat_b",
    filename: "f2.png",
    semanticTokens: ["tok"],
    reasoningContext: { userOverride: false },
  });

  const sem = findSemanticMemoryMatch({
    semanticTokens: ["tok"],
    labelThemes: [],
    embedding: null,
    cosineThreshold: 0.82,
  });
  assert("semantic tie prefers userOverride entry", sem != null && sem.userCorrectedCategory === "cat_a");
  assert("semantic override floor >= 0.6", sem != null && typeof sem.semanticMatchScore === "number" && sem.semanticMatchScore >= 0.6);

  clearFeedbackStore();
  recordFeedbackEntry({
    originalLabels: ["x"],
    refinedCategory: "wrong",
    userCorrectedCategory: "corrected",
    filename: "replay.png",
    semanticTokens: ["alpha", "beta"],
    labelThemes: ["gamma"],
    reasoningContext: { userOverride: true },
    timestamp: 1_700_000_000_000,
  });
  const snap1 = fs.readFileSync(process.env.FEEDBACK_STORE_PATH, "utf8");

  clearFeedbackStore();
  recordFeedbackEntry({
    originalLabels: ["x"],
    refinedCategory: "wrong",
    userCorrectedCategory: "corrected",
    filename: "replay.png",
    semanticTokens: ["alpha", "beta"],
    labelThemes: ["gamma"],
    reasoningContext: { userOverride: true },
    timestamp: 1_700_000_000_000,
  });
  const snap2 = fs.readFileSync(process.env.FEEDBACK_STORE_PATH, "utf8");
  assert("replay: identical store JSON", snap1 === snap2);

  console.log("\nOverride learning validation: all checks passed.");
} catch (e) {
  console.error(e);
  process.exit(1);
}

/**
 * Smoke checks for module clarification alignment (run: node dev/validateClarificationLogic.mjs).
 */
import { analyzeModuleCompositionForBuild } from "../workflow/moduleMapping/analyzeModuleCompositionForBuild.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

const incomplete = analyzeModuleCompositionForBuild("fitness tracker", "");
assert("incomplete fitness ok", incomplete.ok === true);
assert(
  "incomplete triggers clarification",
  incomplete.needsClarification === true &&
    incomplete.clarificationReason === "missing_expected_modules",
);
assert(
  "incomplete lists entity_tracking missing",
  Array.isArray(incomplete.clarificationDetail?.missingModules) &&
    incomplete.clarificationDetail.missingModules.includes("entity_tracking"),
);
assert(
  "incomplete does not auto-inject into detected",
  incomplete.detectedModules.join(",") === "event_log",
);

const full = analyzeModuleCompositionForBuild("fitness coaching client progress photos", "");
assert("full input ok", full.ok === true);
assert("full input skips clarification", full.needsClarification === false);
assert("full preserves keyword detection only in detected", full.detectedModules.length >= 2);

const gibberish = analyzeModuleCompositionForBuild("asdf qwerty zxcv", "");
assert("gibberish ok", gibberish.ok === true);
assert("gibberish no_signal", gibberish.clarificationReason === "no_signal");

const multi = analyzeModuleCompositionForBuild("fitness shop", "");
assert("multi-domain ok", multi.ok === true);
assert("multi-domain ambiguous", multi.clarificationReason === "ambiguous_input");

const vague = analyzeModuleCompositionForBuild("I want to track things", "");
assert("vague ok", vague.ok === true);
assert("vague triggers clarification", vague.needsClarification === true);
assert("vague ambiguous_input", vague.clarificationReason === "ambiguous_input");
assert("vague flags intent", vague.clarificationDetail?.vagueIntent === true);
assert("vague does not inject modules", vague.detectedModules.includes("entity_tracking") === false);

console.log("\nAll clarification validation checks passed.");

/**
 * Guided Build: compose is text-only; analyzer + clarification remain authoritative.
 * Run: node dev/validateGuidedBuild.mjs
 */
import { analyzeModuleCompositionForBuild } from "../workflow/moduleMapping/analyzeModuleCompositionForBuild.js";
import { guidedBuildComposeInput } from "../workflow/moduleMapping/guidedBuildComposeInput.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

const rich = guidedBuildComposeInput({
  shortLabel: "Studio",
  trackPeople: true,
  trackActivity: true,
  trackFiles: true,
  goal: "progress",
  systemType: "client_based",
  domainContext: "fitness",
});
assert("compose returns label + intent", rich.industryName === "Studio" && rich.buildIntent.length > 40);
assert("compose does not embed module ids as machine tokens", !/\bentity_tracking\b/.test(rich.buildIntent));

const analyzed = analyzeModuleCompositionForBuild(rich.industryName, rich.buildIntent);
assert("analyzer runs on guided output", analyzed.ok === true);
assert("guided output still subject to clarification rules", typeof analyzed.needsClarification === "boolean");

const thin = guidedBuildComposeInput({
  shortLabel: "x",
  trackPeople: false,
  trackActivity: true,
  trackFiles: false,
  goal: "",
  systemType: "",
  domainContext: "",
});
const partial = analyzeModuleCompositionForBuild("fitness tracker", thin.buildIntent);
assert("composed intent + category name still runs analyzer", partial.ok === true);
assert("analyzer may still require clarification (no guided bypass)", partial.needsClarification === true);
assert(
  "clarification reason is not skipped (e.g. partial domain or ambiguity)",
  partial.clarificationReason === "missing_expected_modules" || partial.clarificationReason === "ambiguous_input",
);

const minimal = guidedBuildComposeInput({
  shortLabel: "Z",
  trackPeople: false,
  trackActivity: false,
  trackFiles: false,
  goal: "",
  systemType: "",
  domainContext: "",
});
assert("minimal compose yields empty intent", minimal.buildIntent === "");
const ghost = analyzeModuleCompositionForBuild(minimal.industryName, minimal.buildIntent);
assert("minimal text still analyzed (may clarify)", ghost.ok === true);

console.log("\nAll Guided Build validation checks passed.");

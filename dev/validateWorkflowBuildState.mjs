/**
 * Workflow build state engine — transitions and merge behavior.
 * Run: node dev/validateWorkflowBuildState.mjs
 */
import { analyzeModuleCompositionForBuild } from "../workflow/moduleMapping/analyzeModuleCompositionForBuild.js";
import {
  applyAnalyzerToWorkflowBuildState,
  createInitialWorkflowBuildState,
  patchGuidedDraft,
  transitionBackToInput,
  transitionChooseEntryPath,
  transitionClarifyToSelect,
  transitionCompleteReset,
  transitionConfirmToBuild,
  transitionSelectToConfirm,
} from "../workflow/state/workflowBuildState.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

let s = createInitialWorkflowBuildState();
assert("initial step input", s.step === "input");
assert("history empty", s.history.length === 0);
assert("module runtime state present", s.moduleRuntimeState != null && typeof s.moduleRuntimeState === "object");

s = transitionChooseEntryPath(s, "guided");
assert("guided entry", s.step === "guided" && s.entryPath === "guided");
assert("history records transition", s.history.some((h) => h.action === "chooseEntryPath"));

s = patchGuidedDraft(s, { trackActivity: true });
assert("affirmed syncs from guided", s.affirmedModuleIds.join(",") === "event_log");

s = { ...s, industryName: "fitness tracker", buildIntent: "" };
const api = analyzeModuleCompositionForBuild(s.industryName, s.buildIntent, {
  guidedModuleSignals: { trackActivity: true },
});
const applied = applyAnalyzerToWorkflowBuildState(s, api);
assert("analyzer applies", applied.ok === true);
s = applied.state;
assert("routes to clarify", s.step === "clarify");
assert("history logs analyzed", s.history.some((h) => h.through === "analyzed"));
assert("missing only gap", JSON.stringify(s.missingModules) === JSON.stringify(["entity_tracking"]));
assert("known preserved in state", s.knownModuleIds.includes("event_log"));

s = { ...s, moduleSelectionById: { ...s.moduleSelectionById, entity_tracking: true } };
const toSel = transitionClarifyToSelect(s);
assert("clarify merge ok", toSel.ok === true);
s = toSel.state;
assert("select step", s.step === "select");
assert("userSelections merged", s.userSelections.includes("entity_tracking") && s.userSelections.includes("event_log"));

const toConf = transitionSelectToConfirm(s);
assert("confirm ok", toConf.ok === true);
s = toConf.state;
assert("confirmed flag", s.confirmed === true);

s = transitionConfirmToBuild(s);
assert("build step", s.step === "build");

s = transitionBackToInput(toConf.state);
assert(
  "back to input clears analysis",
  s.analysisSnapshot === null && s.analysisPresentation === null && s.step === "guided",
);

const reset = transitionCompleteReset();
assert("complete reset clears history", reset.history.length === 0);

console.log("\nAll workflow build state checks passed.");

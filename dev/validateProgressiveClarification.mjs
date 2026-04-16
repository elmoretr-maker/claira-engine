/**
 * Progressive clarification: known = detected ∪ guided; only modulesToResolve are asked.
 * Run: node dev/validateProgressiveClarification.mjs
 */
import { analyzeModuleCompositionForBuild } from "../workflow/moduleMapping/analyzeModuleCompositionForBuild.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

const guidedActivityOnly = analyzeModuleCompositionForBuild("fitness tracker", "", {
  guidedModuleSignals: { trackActivity: true },
});
assert("fitness + guided activity only still clarifies", guidedActivityOnly.needsClarification === true);
assert(
  "known carries event_log from detection ∪ guided",
  JSON.stringify(guidedActivityOnly.clarificationState?.knownModuleIds) === JSON.stringify(["event_log"]),
);
assert(
  "only entity_tracking remains to resolve",
  JSON.stringify(guidedActivityOnly.clarificationDetail?.modulesToResolve) ===
    JSON.stringify(["entity_tracking"]),
);
assert(
  "progressive options omit event_log",
  Array.isArray(guidedActivityOnly.clarificationOptionsProgressive) &&
    guidedActivityOnly.clarificationOptionsProgressive.length === 1 &&
    guidedActivityOnly.clarificationOptionsProgressive[0].moduleId === "entity_tracking",
);
assert(
  "continuation mentions activity",
  typeof guidedActivityOnly.clarificationDetail?.continuationSummary === "string" &&
    guidedActivityOnly.clarificationDetail.continuationSummary.includes("activity"),
);

const guidedFull = analyzeModuleCompositionForBuild("fitness tracker", "", {
  guidedModuleSignals: { trackPeople: true, trackActivity: true },
});
assert("guided people + activity satisfies domain expectation", guidedFull.needsClarification === false);
assert(
  "known is entity + event",
  JSON.stringify(guidedFull.clarificationState?.knownModuleIds) ===
    JSON.stringify(["entity_tracking", "event_log"]),
);

const noGuided = analyzeModuleCompositionForBuild("fitness tracker", "", {});
assert("without guided signals behavior unchanged (still clarify)", noGuided.needsClarification === true);
assert(
  "only gap modules are asked (not event_log again)",
  noGuided.clarificationDetail?.modulesToResolve?.length === 1 &&
    noGuided.clarificationDetail?.modulesToResolve?.[0] === "entity_tracking",
);
assert(
  "progressive options match gap only",
  noGuided.clarificationOptionsProgressive?.length === 1 &&
    noGuided.clarificationOptionsProgressive[0].moduleId === "entity_tracking",
);

console.log("\nAll progressive clarification checks passed.");

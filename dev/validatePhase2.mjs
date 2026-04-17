/**
 * Phase 2 — core pipeline layers: registry/execution alignment, artifact bookkeeping, entity continuity.
 * Run: node dev/validatePhase2.mjs
 */
import { executeWorkflow, EXECUTION_CONTEXT_VERSION } from "../workflow/execution/workflowExecutor.js";
import { validatePipelineConfiguration } from "../workflow/pipeline/validatePipelineConfiguration.js";
import {
  createInitialWorkflowBuildState,
  dispatchModuleRuntime,
} from "../workflow/state/workflowBuildState.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

async function main() {
assert("EXECUTION_CONTEXT_VERSION is 2", EXECUTION_CONTEXT_VERSION === 2);

// --- Valid flow: artifacts + entity id from entity_tracking → event_log ---
let s = dispatchModuleRuntime(createInitialWorkflowBuildState(), "entity_tracking", "add", {
  id: "e1",
  label: "E1",
});
s = { ...s, userSelections: ["entity_tracking", "event_log"] };
let out = await executeWorkflow(s);

assert("valid pipeline passes validation", out.pipelineValidation?.ok === true);
assert("pipelineContext returned after successful validation", out.pipelineContext != null);
const store = out.pipelineContext?.artifactStore;
assert("artifact store has declaration trace (2 steps)", store?.records?.length === 2);
assert(
  "records follow module order (entity then event)",
  store.records[0]?.kind === "entity" &&
    store.records[0]?.mode === "create" &&
    store.records[0]?.declaredByModuleId === "entity_tracking" &&
    store.records[1]?.kind === "event" &&
    store.records[1]?.mode === "create" &&
    store.records[1]?.declaredByModuleId === "event_log",
);
assert("entity id e1 observed from runtime slice", store.knownEntityIds.has("e1"));
assert("no ENTITY_ROW_MISSING_ID issues", (store.continuityIssues?.length ?? 0) === 0);

// --- Invalid flow: consume without producer ---
out = await executeWorkflow({ ...createInitialWorkflowBuildState(), userSelections: ["event_log"] });
assert("invalid pipeline rejected", out.pipelineValidation?.ok === false);
assert("no pipelineContext when validation fails", out.pipelineContext === undefined);
assert(
  "invalid exposes DATA_CONTRACT_MISSING",
  Array.isArray(out.pipelineValidation?.errors) &&
    out.pipelineValidation.errors.some((e) => e.code === "DATA_CONTRACT_MISSING"),
);
assert("no execution when invalid", Object.keys(out.results ?? {}).length === 0);

// --- Invalid: entity extend without prior entity (isolated registry) ---
const isolatedRegistry = {
  orphan_extend: {
    modulePipelineType: "tracking",
    consumes: [],
    produces: [{ kind: "entity", mode: "extend" }],
  },
};
const bad = validatePipelineConfiguration({
  orderedModuleIds: ["orphan_extend"],
  registry: isolatedRegistry,
});
assert("orphan entity extend rejected", bad.ok === false);
assert(
  "ENTITY_PRODUCE_REQUIRES_PRIOR_ENTITY",
  Array.isArray(bad.errors) && bad.errors.some((e) => e.code === "ENTITY_PRODUCE_REQUIRES_PRIOR_ENTITY"),
);

console.log("\nAll Phase 2 validation checks passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

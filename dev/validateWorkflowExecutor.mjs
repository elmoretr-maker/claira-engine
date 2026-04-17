/**
 * Deterministic checks for workflow execution engine.
 * Run: node dev/validateWorkflowExecutor.mjs
 */
import { executeWorkflow, EXECUTION_CONTEXT_VERSION } from "../workflow/execution/workflowExecutor.js";
import { MODULE_REGISTRY } from "../workflow/modules/moduleRegistry.js";
import {
  createInitialWorkflowBuildState,
  dispatchModuleRuntime,
} from "../workflow/state/workflowBuildState.js";
import { MODULE_SELECTION_ORDER } from "../workflow/contracts/workflowRules.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

async function main() {
assert("EXECUTION_CONTEXT_VERSION is 2", EXECUTION_CONTEXT_VERSION === 2);
for (const id of Object.keys(MODULE_REGISTRY)) {
  assert(
    `module ${id} expectedContextVersion matches engine`,
    MODULE_REGISTRY[id].expectedContextVersion === EXECUTION_CONTEXT_VERSION,
  );
}

let s = createInitialWorkflowBuildState();
let out = await executeWorkflow(s);
assert("empty selection yields no results", Object.keys(out.results).length === 0);
assert("empty selection yields empty trace", out.executionTrace.length === 0);
assert("empty selection pipeline validation ok", out.pipelineValidation?.ok === true);

s = { ...createInitialWorkflowBuildState(), userSelections: ["event_log"] };
out = await executeWorkflow(s);
assert("invalid pipeline rejected (event_log without entity producer)", out.pipelineValidation?.ok === false);
assert(
  "rejection exposes DATA_CONTRACT_MISSING",
  Array.isArray(out.pipelineValidation?.errors) &&
    /** @type {{ errors: { code: string }[] }} */ (out.pipelineValidation).errors.some((e) => e.code === "DATA_CONTRACT_MISSING"),
);
assert("no execution when invalid", Object.keys(out.results).length === 0 && out.executionTrace.length === 0);

s = { ...createInitialWorkflowBuildState(), userSelections: ["entity_tracking"] };
out = await executeWorkflow(s);
assert("single module pipeline validation ok", out.pipelineValidation?.ok === true);
assert("single module executes", out.results.entity_tracking?.status === "ok");
assert("trace length 1", out.executionTrace.length === 1);
assert("trace entity ok", out.executionTrace[0]?.moduleId === "entity_tracking" && out.executionTrace[0]?.status === "ok");

s = dispatchModuleRuntime(createInitialWorkflowBuildState(), "entity_tracking", "add", { id: "e1", label: "Test" });
s = { ...s, userSelections: ["entity_tracking"] };
out = await executeWorkflow(s);
assert("dispatch+execute pipeline validation ok", out.pipelineValidation?.ok === true);
assert("execute sees dispatched entity", out.results.entity_tracking?.data?.count === 1);

s = {
  ...createInitialWorkflowBuildState(),
  userSelections: ["event_log", "entity_tracking", "asset_registry"],
};
out = await executeWorkflow(s);
assert("three-module pipeline validation ok", out.pipelineValidation?.ok === true);
const expectedOrder = MODULE_SELECTION_ORDER.filter((id) => s.userSelections.includes(id));
assert(
  "execution order follows MODULE_SELECTION_ORDER",
  out.executionTrace.map((t) => t.moduleId).join(",") === expectedOrder.join(","),
);

s = { ...createInitialWorkflowBuildState(), userSelections: ["entity_tracking", "event_log"] };
out = await executeWorkflow(s);
assert("two-module pipeline validation ok", out.pipelineValidation?.ok === true);
assert("partial set runs two modules", Object.keys(out.results).length === 2);
assert("both ok", out.results.entity_tracking?.status === "ok" && out.results.event_log?.status === "ok");

console.log("\nAll workflow executor checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

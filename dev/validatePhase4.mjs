/**
 * Phase 4 — OUTPUT SWITCH (post-pipeline only; not a module).
 * Run: node dev/validatePhase4.mjs
 */
import { createInitialWorkflowBuildState } from "../workflow/state/workflowBuildState.js";
import { dispatchModuleRuntime } from "../workflow/state/workflowBuildState.js";
import { executeWorkflow } from "../workflow/execution/workflowExecutor.js";
import { applyOutputSwitch, runWorkflowWithOutputSwitch } from "../workflow/output/outputSwitch.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

async function main() {
let s = dispatchModuleRuntime(createInitialWorkflowBuildState(), "entity_tracking", "add", {
  id: "e1",
  label: "Demo",
});
s = { ...s, userSelections: ["entity_tracking", "event_log"] };

// One pipeline run — two output modes (routing only; same execution object)
const execution = await executeWorkflow(s);
assert("pipeline completed", execution.pipelineValidation?.ok === true);

const externalRoute = applyOutputSwitch(execution, { outputMode: "external" });
const internalRoute = applyOutputSwitch(execution, { outputMode: "internal" });

assert("external mode uses API output layer", externalRoute.destination === "external" && externalRoute.outputMode === "external");
assert("external payload is formatted JSON (version 1)", externalRoute.payload.version === 1 && "declaredArtifactTrace" in externalRoute.payload);
assert("internal mode targets presentation path", internalRoute.destination === "internal" && internalRoute.outputMode === "internal");
assert(
  "internal payload keeps execution reference (pass-through)",
  internalRoute.payload.execution === execution,
);
assert(
  "internal presentation lists modules and widget routes",
  Array.isArray(internalRoute.payload.presentation?.orderedModuleIds) &&
    internalRoute.payload.presentation.orderedModuleIds.includes("entity_tracking") &&
    internalRoute.payload.presentation.widgetsByModule.entity_tracking?.includes("entity_list"),
);

console.log("\n--- Same pipeline: external OUTPUT SWITCH payload (excerpt) ---");
console.log(
  JSON.stringify(
    {
      destination: externalRoute.destination,
      declaredArtifactTrace: externalRoute.payload.declaredArtifactTrace,
      knownEntityIds: externalRoute.payload.knownEntityIds,
    },
    null,
    2,
  ),
);

console.log("\n--- Same pipeline: internal OUTPUT SWITCH payload (excerpt) ---");
console.log(
  JSON.stringify(
    {
      destination: internalRoute.destination,
      presentation: internalRoute.payload.presentation,
    },
    null,
    2,
  ),
);

// Integrated helper: execution first, switch last
const integrated = await runWorkflowWithOutputSwitch(s, { outputMode: "external" });
assert("runWorkflowWithOutputSwitch returns execution + output", integrated.execution && integrated.output);
assert("integrated external output matches standalone", integrated.output.destination === "external");

const integratedUi = await runWorkflowWithOutputSwitch(s, { outputMode: "internal" });
assert("internal integrated has presentation", integratedUi.output.outputMode === "internal");

// Default mode is external when omitted
const defaultMode = applyOutputSwitch(execution, {});
assert("default outputMode is external", defaultMode.outputMode === "external");

console.log("\nAll Phase 4 OUTPUT SWITCH checks passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Phase 5 — First working MVP pipeline (image → classify → deliverable → ui_model).
 * Run: node dev/validatePhase5.mjs
 */
import { validatePipelineConfiguration } from "../workflow/pipeline/validatePipelineConfiguration.js";
import {
  createInitialWorkflowBuildState,
  dispatchModuleRuntime,
} from "../workflow/state/workflowBuildState.js";
import { runWorkflowWithOutputSwitch } from "../workflow/output/outputSwitch.js";

const MVP_PIPELINE = ["image_input", "basic_classifier", "structured_output", "simple_presentation"];

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

const pv = validatePipelineConfiguration({ orderedModuleIds: MVP_PIPELINE });
assert("MVP pipeline validates", pv.ok === true, JSON.stringify(pv.errors));

async function main() {
const sampleInput = {
  imagePath: "mock/assets/sample.png",
  entityLabel: "MVP subject",
};

console.log("\n--- Sample input (ingest payload) ---");
console.log(JSON.stringify(sampleInput, null, 2));

let state = createInitialWorkflowBuildState();
state = dispatchModuleRuntime(state, "image_input", "ingest", sampleInput);
state = { ...state, userSelections: MVP_PIPELINE };

const externalRun = await runWorkflowWithOutputSwitch(state, { outputMode: "external" });
assert("execution completes", externalRun.execution.pipelineValidation?.ok === true);
assert("all MVP modules ran ok", MVP_PIPELINE.every((id) => externalRun.execution.results?.[id]?.status === "ok"));

const extPayload = externalRun.output.payload;
assert("external: formatted output", extPayload.version === 1 && extPayload.ok === true);
const _ui = extPayload.moduleResults?.simple_presentation?.data?.uiModel;
assert(
  "external: presentation module in results",
  _ui != null && typeof _ui.schema === "string" && _ui.deliverable != null,
);

const internalRun = await runWorkflowWithOutputSwitch(state, { outputMode: "internal" });
assert("internal mode routes", internalRun.output.destination === "internal");
assert(
  "internal: execution pass-through",
  internalRun.output.payload.execution === internalRun.execution,
);
assert(
  "internal: ordered modules in trace order",
  internalRun.output.payload.presentation.orderedModuleIds.join(",") === MVP_PIPELINE.join(","),
);

console.log("\n--- Execution: module keys (status) ---");
console.log(
  JSON.stringify(
    Object.fromEntries(
      MVP_PIPELINE.map((id) => [id, externalRun.execution.results?.[id]?.status ?? "missing"]),
    ),
    null,
    2,
  ),
);

console.log("\n--- OUTPUT SWITCH: external (excerpt) ---");
console.log(
  JSON.stringify(
    {
      destination: externalRun.output.destination,
      declaredArtifactTrace: extPayload.declaredArtifactTrace,
      simple_presentation: extPayload.moduleResults?.simple_presentation?.data,
    },
    null,
    2,
  ),
);

console.log("\n--- OUTPUT SWITCH: internal (excerpt) ---");
console.log(
  JSON.stringify(
    {
      destination: internalRun.output.destination,
      presentation: internalRun.output.payload.presentation,
    },
    null,
    2,
  ),
);

console.log("\nAll Phase 5 MVP pipeline checks passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

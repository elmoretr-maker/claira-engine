/**
 * Phase 3 — API input/output boundaries (no Phase 1–2 edits required).
 * Run: node dev/validatePhase3.mjs
 */
import { createInitialWorkflowBuildState } from "../workflow/state/workflowBuildState.js";
import {
  buildWorkflowStateFromExternalInput,
  runWorkflowFromExternalInput,
  validatePipelineAtApiEntry,
} from "../workflow/api/workflowApiInput.js";
import { formatWorkflowExecutionForExternal } from "../workflow/api/workflowApiOutput.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

async function main() {
const base = createInitialWorkflowBuildState();

// --- API entry validation mirrors executor gate ---
const order = ["entity_tracking", "event_log"];
const entryPv = validatePipelineAtApiEntry(order);
assert("validatePipelineAtApiEntry matches valid pipeline", entryPv.ok === true);

// --- Example external input (JSON-shaped) ---
const exampleExternalInput = {
  userSelections: ["entity_tracking", "event_log"],
  data: {
    entities: [{ id: "e1", label: "Acme Corp" }],
    events: [{ id: "ev1", label: "Kickoff", entityId: "e1", at: 1_700_000_000_000 }],
  },
};

console.log("\n--- Example external input payload ---");
console.log(JSON.stringify(exampleExternalInput, null, 2));

const run = await runWorkflowFromExternalInput(base, exampleExternalInput);
assert("runWorkflowFromExternalInput succeeds", run.ok === true);
assert("execution pipeline validation ok", run.execution?.pipelineValidation?.ok === true);

const external = formatWorkflowExecutionForExternal(run.execution);
assert("external output version 1", external.version === 1);
assert("external output ok", external.ok === true);
assert("declared artifact trace length 2", external.declaredArtifactTrace.length === 2);
assert("knownEntityIds includes e1", external.knownEntityIds.includes("e1"));
assert("moduleResults entity_tracking ok", external.moduleResults.entity_tracking?.status === "ok");
assert("moduleResults event_log ok", external.moduleResults.event_log?.status === "ok");

console.log("\n--- Resulting external output payload (excerpt) ---");
console.log(
  JSON.stringify(
    {
      version: external.version,
      ok: external.ok,
      pipelineValidation: external.pipelineValidation,
      declaredArtifactTrace: external.declaredArtifactTrace,
      knownEntityIds: external.knownEntityIds,
      moduleResults: external.moduleResults,
      executionTrace: external.executionTrace,
    },
    null,
    2,
  ),
);

// --- Invalid: pipeline fails validation at API (event_log without entity producer) ---
const invalidPipeline = await runWorkflowFromExternalInput(base, {
  userSelections: ["event_log"],
  data: {},
});
assert("invalid pipeline rejected at API", invalidPipeline.ok === false);
assert(
  "invalid pipeline has validation errors",
  invalidPipeline.execution?.pipelineValidation?.ok === false &&
    (invalidPipeline.execution?.pipelineValidation?.errors?.length ?? 0) > 0,
);
const badOut = formatWorkflowExecutionForExternal(invalidPipeline.execution);
assert("external format reflects failed pipeline", badOut.ok === false);

// --- Invalid: injection references unknown entity ---
const badEntityRef = buildWorkflowStateFromExternalInput(base, {
  userSelections: ["entity_tracking", "event_log"],
  data: {
    entities: [{ id: "e1", label: "A" }],
    events: [{ id: "ev1", label: "x", entityId: "not_injected" }],
  },
});
assert("unknown event entityId rejected", badEntityRef.ok === false && badEntityRef.code === "API_EVENT_ENTITY_UNKNOWN");

// --- fileRefs → asset ref mapping (translation only) ---
const withFile = await runWorkflowFromExternalInput(createInitialWorkflowBuildState(), {
  userSelections: ["entity_tracking", "asset_registry"],
  data: {
    entities: [{ id: "e1", label: "E" }],
    fileRefs: [{ id: "a1", path: "s3://bucket/doc.pdf", name: "doc" }],
  },
});
assert("fileRefs pipeline run ok", withFile.ok === true);
const extFile = formatWorkflowExecutionForExternal(withFile.execution);
assert(
  "asset_registry sees file ref",
  extFile.moduleResults.asset_registry?.data &&
    JSON.stringify(extFile.moduleResults.asset_registry.data).includes("s3://bucket/doc.pdf"),
);

console.log("\nAll Phase 3 API boundary checks passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

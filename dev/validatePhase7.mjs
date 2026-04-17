/**
 * Phase 7 — Image intelligence preparation: provider layer + richer analysis (no external APIs).
 * Run: node dev/validatePhase7.mjs
 */
import { validatePipelineConfiguration } from "../workflow/pipeline/validatePipelineConfiguration.js";
import {
  createInitialWorkflowBuildState,
  dispatchModuleRuntime,
} from "../workflow/state/workflowBuildState.js";
import { runWorkflowWithOutputSwitch } from "../workflow/output/outputSwitch.js";
import {
  clearImageAnalysisProvider,
  mockImageAnalysisProvider,
  setImageAnalysisProvider,
} from "../workflow/integrations/imageAnalysisProvider.js";

const MVP_PIPELINE = ["image_input", "basic_classifier", "structured_output", "simple_presentation"];

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

const multiInput = {
  paths: ["mock/a.png", "mock/b.jpg"],
  entityLabel: "Intel test",
};

function runMvp() {
  let state = createInitialWorkflowBuildState();
  state = dispatchModuleRuntime(state, "image_input", "ingest", multiInput);
  return { ...state, userSelections: MVP_PIPELINE };
}

async function main() {
try {
  assert("pipeline validates", validatePipelineConfiguration({ orderedModuleIds: MVP_PIPELINE }).ok === true);

  // --- A: no provider → heuristic only ---
  clearImageAnalysisProvider();
  const fallback = await runWorkflowWithOutputSwitch(runMvp(), { outputMode: "external" });
  assert("fallback: execution ok", fallback.execution.pipelineValidation?.ok === true);
  const delA = fallback.output.payload.moduleResults?.simple_presentation?.data?.uiModel?.deliverable;
  assert("fallback: deliverable v2", delA?.schema === "claira.deliverable.v2");
  assert("fallback: no provider flag", delA?.intelligenceMeta?.providerWasActive === false);
  const itemA = delA?.items?.[0];
  assert("fallback: heuristic modelSource", itemA?.modelSource === "heuristic");
  assert("fallback: labels from category", Array.isArray(itemA?.labels) && itemA.labels.includes("raster_image"));

  // --- B: mock provider → richer analysis ---
  setImageAnalysisProvider(mockImageAnalysisProvider);
  const rich = await runWorkflowWithOutputSwitch(runMvp(), { outputMode: "external" });
  const delB = rich.output.payload.moduleResults?.simple_presentation?.data?.uiModel?.deliverable;
  assert("rich: provider active", delB?.intelligenceMeta?.providerWasActive === true);
  const itemB = delB?.items?.[0];
  assert("rich: mock labels", Array.isArray(itemB?.labels) && itemB.labels.some((/** @type {string} */ x) => x.includes("mock")));
  assert("rich: confidence set", typeof itemB?.confidence === "number");
  assert("rich: features object", itemB?.features && typeof itemB.features === "object");
  assert("rich: modelSource mock", itemB?.modelSource === "mock");

  const ui = rich.output.payload.moduleResults?.simple_presentation?.data?.uiModel;
  assert("ui_model v2.1", ui?.schema === "claira.ui_model.v2.1");
  assert(
    "presentationHints",
    Array.isArray(ui?.presentationHints?.assetSummaries) && ui.presentationHints.assetSummaries.length === 2,
  );

  const internal = await runWorkflowWithOutputSwitch(runMvp(), { outputMode: "internal" });
  assert("internal switch ok", internal.output.destination === "internal");

  console.log("\n--- Sample: richer deliverable item (first asset) ---");
  console.log(JSON.stringify(delB?.items?.[0], null, 2));

  console.log("\nAll Phase 7 checks passed.\n");
} finally {
  clearImageAnalysisProvider();
}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

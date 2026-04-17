/**
 * Phase 6 — Capability expansion: multi-asset ingest, batch analysis, aggregated deliverable, UI route meta.
 * Run: node dev/validatePhase6.mjs
 */
import { validatePipelineConfiguration } from "../workflow/pipeline/validatePipelineConfiguration.js";
import {
  createInitialWorkflowBuildState,
  dispatchModuleRuntime,
} from "../workflow/state/workflowBuildState.js";
import { runWorkflowWithOutputSwitch } from "../workflow/output/outputSwitch.js";
import { INTERNAL_UI_WIDGET_ORDER_BY_MODULE } from "../workflow/output/internalUiRouteMeta.js";

const MVP_PIPELINE = ["image_input", "basic_classifier", "structured_output", "simple_presentation"];

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

assert(
  "internal UI meta lists MVP modules",
  INTERNAL_UI_WIDGET_ORDER_BY_MODULE.image_input?.length &&
    INTERNAL_UI_WIDGET_ORDER_BY_MODULE.simple_presentation?.includes("ack_bar"),
);

const pv = validatePipelineConfiguration({ orderedModuleIds: MVP_PIPELINE });
assert("MVP pipeline still validates", pv.ok === true);

const multiInput = {
  paths: ["mock/a.png", "mock/b.jpg", "mock/c.svg"],
  entityLabel: "Batch subject",
};

console.log("\n--- Multi-asset ingest payload ---");
console.log(JSON.stringify(multiInput, null, 2));

async function main() {
let state = createInitialWorkflowBuildState();
state = dispatchModuleRuntime(state, "image_input", "ingest", multiInput);
state = { ...state, userSelections: MVP_PIPELINE };

const ext = await runWorkflowWithOutputSwitch(state, { outputMode: "external" });
assert("execution ok", ext.execution.pipelineValidation?.ok === true);
assert("four modules ok", MVP_PIPELINE.every((id) => ext.execution.results?.[id]?.status === "ok"));

const sp = ext.execution.results?.simple_presentation?.data;
const del = sp?.uiModel?.deliverable;
assert("deliverable v2", del?.schema === "claira.deliverable.v2");
assert("three analyses aggregated", Array.isArray(del.items) && del.items.length === 3);
assert("aggregate counts", del.aggregate?.assetCount === 3 && typeof del.aggregate?.byCategory === "object");

const cats = new Set(del.items.map((/** @type {{ category: string }} */ i) => i.category));
assert("mixed categories", cats.has("raster_image") && cats.has("vector_image"));

const internal = await runWorkflowWithOutputSwitch(state, { outputMode: "internal" });
const wm = internal.output.payload.presentation.widgetsByModule;
assert("widgetsByModule populated for MVP", wm.image_input?.length > 0 && wm.simple_presentation?.length > 0);
assert(
  "widget ids match meta",
  wm.image_input.join(",") === [...INTERNAL_UI_WIDGET_ORDER_BY_MODULE.image_input].join(","),
);

console.log("\n--- External OUTPUT (deliverable excerpt) ---");
console.log(
  JSON.stringify(
    {
      schema: del.schema,
      summary: del.summary,
      itemCount: del.items.length,
      aggregate: del.aggregate,
    },
    null,
    2,
  ),
);

console.log("\n--- Internal OUTPUT (presentation routing excerpt) ---");
console.log(JSON.stringify(internal.output.payload.presentation, null, 2));

console.log("\nAll Phase 6 checks passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

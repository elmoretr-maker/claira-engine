/**
 * Phase 9 — Automated routing & file organization (dry-run moves, config-driven destinations).
 * Run: node dev/validatePhase9.mjs
 */
import { validatePipelineConfiguration } from "../workflow/pipeline/validatePipelineConfiguration.js";
import {
  createInitialWorkflowBuildState,
  dispatchModuleRuntime,
} from "../workflow/state/workflowBuildState.js";
import { runWorkflowWithOutputSwitch } from "../workflow/output/outputSwitch.js";
import { clearImageAnalysisProvider, setImageAnalysisProvider } from "../workflow/integrations/imageAnalysisProvider.js";

const PHASE9_PIPELINE = [
  "image_input",
  "basic_classifier",
  "structured_output",
  "asset_validation",
  "claira_reasoning",
  "asset_router",
  "asset_mover",
  "simple_presentation",
];

/**
 * Test-only provider: drives categories from a synthetic ref scheme (routing itself uses only analysis output).
 * @type {import("../workflow/integrations/imageAnalysisProvider.js").ImageAnalysisProvider}
 */
const phase9FixtureProvider = {
  id: "phase9_fixture",
  analyzeImage(asset) {
    const ref = String(asset?.ref ?? "");
    if (ref.includes("phase9://dup/")) {
      return {
        category: "document",
        labels: ["document"],
        confidence: 0.9,
        features: { phase9Fixture: true, dupProbe: true },
        embeddings: null,
        modelSource: "mock",
        inferenceInput: {
          kind: "image_ref",
          assetId: String(asset?.id ?? ""),
          ref,
        },
      };
    }
    const m = /phase9:\/\/kind\/([\w-]+)/.exec(ref);
    const token = m ? m[1] : "";
    /** @type {Record<string, { category: string, labels: string[] }>} */
    const table = {
      document: { category: "document", labels: ["document"] },
      ui: { category: "ui element", labels: ["ui element"] },
      photo: { category: "photograph", labels: ["photograph", "photo"] },
      game: { category: "video game asset", labels: ["video game asset"] },
      other: { category: "misc", labels: ["unclassified"] },
    };
    const row = table[token] ?? table.other;
    return {
      category: row.category,
      labels: [...row.labels],
      confidence: 0.91,
      features: { phase9Fixture: true },
      embeddings: null,
      modelSource: "mock",
      inferenceInput: {
        kind: "image_ref",
        assetId: String(asset?.id ?? ""),
        ref,
      },
    };
  },
};

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

function runPhase9State() {
  let state = createInitialWorkflowBuildState();
  state = dispatchModuleRuntime(state, "image_input", "ingest", {
    paths: [
      "phase9://kind/document",
      "phase9://kind/ui",
      "phase9://kind/photo",
      "phase9://kind/game",
      "phase9://kind/other",
    ],
    entityLabel: "Phase 9 routing",
  });
  state = {
    ...state,
    userSelections: PHASE9_PIPELINE,
    runtimePipelineConfig: {
      asset_mover: {
        dryRun: true,
        destinationRoot: "Assets",
      },
    },
  };
  return state;
}

async function main() {
try {
  assert("pipeline validates", validatePipelineConfiguration({ orderedModuleIds: PHASE9_PIPELINE }).ok === true);

  setImageAnalysisProvider(phase9FixtureProvider);
  const { execution, output } = await runWorkflowWithOutputSwitch(runPhase9State(), { outputMode: "external" });
  assert("execution pipeline ok", execution.pipelineValidation?.ok === true);

  const routing = output.payload.moduleResults?.asset_router?.data?.routing;
  assert("routing schema", routing?.schema === "claira.routingDecision.v1");
  assert("routing item count", Array.isArray(routing?.items) && routing.items.length === 5);

  const dests = routing.items.map((/** @type {{ destinationRelPath?: string }} */ x) => x.destinationRelPath);
  assert("doc → Documents", dests[0] === "Documents");
  assert("ui → UI", dests[1] === "UI");
  assert("photo → Reference", dests[2] === "Reference");
  assert("game → Game", dests[3] === "Game");
  assert("fallback (unclassified) → Review via asset_validation", dests[4] === "Review");

  const mover = output.payload.moduleResults?.asset_mover?.data;
  assert("dry-run move log", Array.isArray(mover?.moveLog) && mover.moveLog.length === 5);
  assert("dryRun flag in log", mover?.moveLog?.every((/** @type {{ dryRun?: boolean }} */ x) => x.dryRun === true));

  const ui = output.payload.moduleResults?.simple_presentation?.data?.uiModel;
  assert("presentation routing hints", ui?.presentationHints?.routingPlan?.schema === "claira.routingDecision.v1");
  assert("presentation move hints", Array.isArray(ui?.presentationHints?.assetMoves?.moveLog));

  console.log("\n--- Sample routing items (analysis-driven destinations) ---");
  console.log(JSON.stringify(routing?.items?.slice(0, 3), null, 2));

  console.log("\n--- Dry-run move log (first three) ---");
  console.log(JSON.stringify(mover?.moveLog?.slice(0, 3), null, 2));

  // --- Duplicate basename → _1 suffix (same folder, dry-run) ---
  let dupState = createInitialWorkflowBuildState();
  dupState = dispatchModuleRuntime(dupState, "image_input", "ingest", {
    paths: ["phase9://dup/a/item.png", "phase9://dup/b/item.png"],
    entityLabel: "Dup probe",
  });
  dupState = {
    ...dupState,
    userSelections: PHASE9_PIPELINE,
    runtimePipelineConfig: { asset_mover: { dryRun: true, destinationRoot: "Assets" } },
  };
  const dupOut = await runWorkflowWithOutputSwitch(dupState, { outputMode: "external" });
  assert("dup: pipeline ok", dupOut.execution.pipelineValidation?.ok === true);
  const dupLog = dupOut.output.payload.moduleResults?.asset_mover?.data?.moveLog;
  assert("dup: two moves", Array.isArray(dupLog) && dupLog.length === 2);
  assert(
    "dup: second path resolves basename collision",
    typeof dupLog?.[1]?.destinationSimulated === "string" && dupLog[1].destinationSimulated.includes("item_1.png"),
  );

  console.log("\nAll Phase 9 checks passed.\n");
} finally {
  clearImageAnalysisProvider();
}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

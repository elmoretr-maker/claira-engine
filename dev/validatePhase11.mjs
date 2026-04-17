/**
 * Phase 11 — Asset validation (filename vs labels, Review routing, suggested names).
 * Run: node dev/validatePhase11.mjs
 */
import { validatePipelineConfiguration } from "../workflow/pipeline/validatePipelineConfiguration.js";
import { runPhase10Pipeline, PHASE10_PIPELINE } from "../workflow/watcher/runPhase10Pipeline.mjs";
import { clearImageAnalysisProvider, setImageAnalysisProvider } from "../workflow/integrations/imageAnalysisProvider.js";
import { extractFilenameTokens } from "../workflow/modules/mvp/assetValidationModule.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

const phase9FixtureProvider = {
  id: "phase11_fixture",
  analyzeImage(asset) {
    const ref = String(asset?.ref ?? "");
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
      features: { phase11: true },
      embeddings: null,
      modelSource: "mock",
      inferenceInput: { kind: "image_ref", assetId: String(asset?.id ?? ""), ref },
    };
  },
};

assert("token extract", extractFilenameTokens("example_game_sprite.png").join(",") === "example,game,sprite");

try {
  assert("pipeline validates", validatePipelineConfiguration({ orderedModuleIds: PHASE10_PIPELINE }).ok === true);
  assert("pipeline includes asset_validation", PHASE10_PIPELINE.includes("asset_validation"));

  setImageAnalysisProvider(phase9FixtureProvider);

  const { execution, output } = await runPhase10Pipeline({
    cwd: process.cwd(),
    imagePaths: ["phase9://kind/document"],
    destinationRoot: "Assets",
    dryRun: true,
  });

  assert("execution ok", execution.pipelineValidation?.ok === true);
  assert("asset_validation ran", execution.results?.asset_validation?.status === "ok");

  const valItems = output.payload.moduleResults?.asset_validation?.data?.items;
  assert("validation items", Array.isArray(valItems) && valItems.length === 1);
  const v0 = valItems[0];
  assert("has suggestedName", typeof v0?.suggestedName === "string" && /\.[a-z]+$/i.test(v0.suggestedName));
  assert("high/medium tier for document+filename", v0?.validationStatus === "high" || v0?.validationStatus === "medium");

  const route = output.payload.moduleResults?.asset_router?.data?.routing?.items?.[0];
  assert("routed to Documents", route?.destinationRelPath === "Documents");

  const out2 = await runPhase10Pipeline({
    cwd: process.cwd(),
    imagePaths: ["phase9://kind/other"],
    destinationRoot: "Assets",
    dryRun: true,
  });

  const mr = out2.output.payload.moduleResults;
  const v1 = mr?.asset_validation?.data?.items?.[0];
  assert("uncertain classification → low", v1?.validationStatus === "low" && v1?.finalCategory === "review");

  const r1 = mr?.asset_router?.data?.routing?.items?.[0];
  assert("low → Review folder", r1?.destinationRelPath === "Review");

  const hints = mr?.simple_presentation?.data?.uiModel?.presentationHints;
  assert("presentation hints include assetValidation", Array.isArray(hints?.assetValidation) && hints.assetValidation.length >= 1);

  console.log("\nAll Phase 11 checks passed.\n");
} finally {
  clearImageAnalysisProvider();
}

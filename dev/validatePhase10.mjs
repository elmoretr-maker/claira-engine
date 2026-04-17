/**
 * Phase 10 — Real file moves + folder watcher wiring.
 * Run: node dev/validatePhase10.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validatePipelineConfiguration } from "../workflow/pipeline/validatePipelineConfiguration.js";
import { runPhase10Pipeline, PHASE10_PIPELINE } from "../workflow/watcher/runPhase10Pipeline.mjs";
import { startFolderWatcher } from "../workflow/watcher/folderWatcher.js";
import { clearImageAnalysisProvider, setImageAnalysisProvider } from "../workflow/integrations/imageAnalysisProvider.js";

const samplePng = path.join(process.cwd(), "dev", "phase6_tiny.png");

/**
 * Filename token `phase9_kind_<token>.png` drives categories (mirrors Phase 9 fixture semantics for real paths).
 * @type {import("../workflow/integrations/imageAnalysisProvider.js").ImageAnalysisProvider}
 */
const phase10PathFixtureProvider = {
  id: "phase10_path_fixture",
  analyzeImage(asset) {
    const ref = String(asset?.ref ?? "").replace(/\\/g, "/");
    const m = /phase9_kind_([\w-]+)/i.exec(ref);
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
      confidence: 0.9,
      features: { phase10Fixture: true },
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

try {
  assert("pipeline list validates", validatePipelineConfiguration({ orderedModuleIds: PHASE10_PIPELINE }).ok === true);

  if (!fs.existsSync(samplePng)) {
    console.error(`FAIL: missing sample image at ${samplePng}`);
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claira-phase10-"));
  const nested = path.join(tmp, "New_Arrival", "incoming", "batch_a");
  fs.mkdirSync(nested, { recursive: true });
  const srcFile = path.join(nested, "phase9_kind_document.png");
  fs.copyFileSync(samplePng, srcFile);

  setImageAnalysisProvider(phase10PathFixtureProvider);

  const { execution, output } = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [srcFile],
    destinationRoot: "Assets",
    dryRun: false,
  });

  assert("execution pipeline ok", execution.pipelineValidation?.ok === true);

  const destRel = path.join("Assets", "Documents", "phase9_kind_document.png");
  const destAbs = path.join(tmp, destRel);
  assert("file moved to Assets/Documents", fs.existsSync(destAbs), destAbs);
  assert("source file no longer at drop location", !fs.existsSync(srcFile));

  const mover = output.payload.moduleResults?.asset_mover?.data;
  assert("fs operation log present", Array.isArray(mover?.fsOperationLog) && mover.fsOperationLog.length > 0);
  assert("dryRun false in snapshot", mover?.config?.dryRun === false);

  // --- Watcher: nested drop triggers batched paths ---
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "claira-phase10-watch-"));
  fs.mkdirSync(path.join(tmp2, "New_Arrival"), { recursive: true });

  /** @type {string[]} */
  const received = [];
  const { stop } = startFolderWatcher({
    cwd: tmp2,
    watchFolder: "New_Arrival",
    destinationRoot: "Assets",
    dryRun: true,
    debounceMs: 120,
    autoProcess: true,
    runPipeline: async (paths) => {
      received.push(...paths);
    },
  });

  await new Promise((r) => setTimeout(r, 150));
  const deep = path.join(tmp2, "New_Arrival", "vendor", "pack");
  fs.mkdirSync(deep, { recursive: true });
  fs.copyFileSync(samplePng, path.join(deep, "nested_probe.png"));
  await new Promise((r) => setTimeout(r, 900));
  await stop();

  const got = received.filter((p) => p.replace(/\\/g, "/").includes("nested_probe.png"));
  assert("watcher reported nested image path", got.length >= 1, JSON.stringify(received));

  console.log("\nAll Phase 10 checks passed.\n");
} finally {
  clearImageAnalysisProvider();
}

/**
 * Phase 10.5 — Engine isolation + orchestration wrapper (no pipeline behavior change).
 * Run: node dev/validatePhase10_5.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAssetOrchestrationWatchPipeline } from "../engines/asset-orchestration-engine/runtime/runWatchPipeline.mjs";
import { runPhase10Pipeline } from "../workflow/watcher/runPhase10Pipeline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

process.env.ASSET_ORCHESTRATION_LOG = "1";

const legacyEnv = { ...process.env };
delete legacyEnv.CLAIRA_LEGACY_WATCHER;
const r = spawnSync(process.execPath, [path.join(root, "server", "watcher.js")], {
  cwd: root,
  encoding: "utf8",
  env: legacyEnv,
});
assert("legacy watcher exits without watching when CLAIRA_LEGACY_WATCHER unset", r.status === 0);
assert(
  "legacy watcher announces inactive",
  typeof r.stdout === "string" && r.stdout.includes("Inactive"),
);

const out = await runAssetOrchestrationWatchPipeline({
  cwd: root,
  imagePaths: ["phase9://kind/document"],
  destinationRoot: "Assets",
  dryRun: true,
  entityLabel: "phase10.5 validation",
});

assert("orchestration wrapper returns execution", out?.execution != null);
const trace = out.execution?.executionTrace ?? [];
const ids = trace.map((/** @type {{ moduleId?: string }} */ t) => t.moduleId).join(",");
  assert(
    "execution order: perception before routing",
    ids.includes("basic_classifier") &&
      ids.includes("structured_output") &&
      ids.includes("asset_validation") &&
      ids.includes("claira_reasoning") &&
      ids.includes("asset_router") &&
      ids.indexOf("basic_classifier") < ids.indexOf("structured_output") &&
      ids.indexOf("structured_output") < ids.indexOf("asset_validation") &&
      ids.indexOf("asset_validation") < ids.indexOf("claira_reasoning") &&
      ids.indexOf("claira_reasoning") < ids.indexOf("asset_router"),
  );

const baseline = await runPhase10Pipeline({
  cwd: root,
  imagePaths: ["phase9://kind/document"],
  destinationRoot: "Assets",
  dryRun: true,
  entityLabel: "baseline compare",
});
assert(
  "wrapper does not change module result keys",
  JSON.stringify(Object.keys(out.execution?.results ?? {}).sort()) ===
    JSON.stringify(Object.keys(baseline.execution?.results ?? {}).sort()),
);

console.log("\nAll Phase 10.5 checks passed.\n");

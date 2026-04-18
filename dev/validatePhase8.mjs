import 'dotenv/config';
/**
 * Phase 8 — Hugging Face CLIP zero-shot provider (Inference API) + fallbacks.
 * Run: node dev/validatePhase8.mjs
 *
 * Real inference:
 *   HUGGINGFACE_API_TOKEN=xxx  (repo-root .env — see .env.example; never commit secrets)
 *   Endpoint: openai/clip-vit-base-patch32 (zero-shot classification)
 *
 * Fast CI / fallback:
 *   HF_DISABLE=1  — worker skips; heuristic used
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "../server/loadRootEnv.mjs";
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
import { huggingFaceProvider } from "../workflow/integrations/providers/huggingFaceProvider.js";

loadRootEnv();

/** Snapshot before tests mutate `process.env` (CI sets `HF_DISABLE=1`; section 2 deletes it). */
const rawHfAtStart =
  process.env.HUGGINGFACE_API_TOKEN || process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN;

/**
 * @param {string | undefined} t
 */
function looksLikeRealHuggingFaceToken(t) {
  if (t == null || typeof t !== "string") return false;
  const s = t.trim();
  if (s.length < 8) return false;
  const lower = s.toLowerCase();
  if (lower === "your_token_here" || lower.startsWith("your_")) return false;
  return true;
}

const hasHfTokenAtStart = looksLikeRealHuggingFaceToken(rawHfAtStart);
const hfDisableAtStart = process.env.HF_DISABLE === "1";
/** Live CLIP only when a real token exists and HF was not disabled for the whole process (e.g. CI). */
const allowLiveHuggingFaceClip = Boolean(hasHfTokenAtStart) && hfDisableAtStart !== true;

const MVP_PIPELINE = ["image_input", "basic_classifier", "structured_output", "simple_presentation"];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "fixtures", "phase8");
const SAMPLE_PNG = path.join(FIXTURE_DIR, "sample.png");

/** Minimal 1×1 PNG */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

fs.mkdirSync(FIXTURE_DIR, { recursive: true });
if (!fs.existsSync(SAMPLE_PNG)) fs.writeFileSync(SAMPLE_PNG, PNG_1x1);

const relImagePath = path.relative(process.cwd(), SAMPLE_PNG) || SAMPLE_PNG;

function runPipeline() {
  let state = createInitialWorkflowBuildState();
  state = dispatchModuleRuntime(state, "image_input", "ingest", {
    paths: [relImagePath],
    entityLabel: "HF fixture",
  });
  return { ...state, userSelections: MVP_PIPELINE };
}

async function main() {
assert("pipeline validates", validatePipelineConfiguration({ orderedModuleIds: MVP_PIPELINE }).ok === true);

// --- 1) No provider: heuristic ---
clearImageAnalysisProvider();
let out = await runWorkflowWithOutputSwitch(runPipeline(), { outputMode: "external" });
assert("no provider: ok", out.execution.pipelineValidation?.ok === true);
let del = out.output.payload.moduleResults?.simple_presentation?.data?.uiModel?.deliverable;
assert("no provider: heuristic", del?.intelligenceMeta?.providerWasActive === false);
assert("no provider: items", del?.items?.[0]?.modelSource === "heuristic");

// --- 2) HF provider + HF_DISABLE: worker skips → heuristic ---
process.env.HF_DISABLE = "1";
setImageAnalysisProvider(huggingFaceProvider);
out = await runWorkflowWithOutputSwitch(runPipeline(), { outputMode: "external" });
del = out.output.payload.moduleResults?.simple_presentation?.data?.uiModel?.deliverable;
assert("hf disabled: falls back", del?.intelligenceMeta?.providerWasActive === false);
clearImageAnalysisProvider();
delete process.env.HF_DISABLE;

// --- 3) Mock provider still works ---
setImageAnalysisProvider(mockImageAnalysisProvider);
out = await runWorkflowWithOutputSwitch(runPipeline(), { outputMode: "external" });
del = out.output.payload.moduleResults?.simple_presentation?.data?.uiModel?.deliverable;
assert("mock: provider active", del?.intelligenceMeta?.providerWasActive === true);
assert("mock: labels", del?.items?.[0]?.labels?.some((/** @type {string} */ x) => x.includes("mock")));
clearImageAnalysisProvider();

// --- 4) Multi-asset + mock ---
setImageAnalysisProvider(mockImageAnalysisProvider);
let state = createInitialWorkflowBuildState();
state = dispatchModuleRuntime(state, "image_input", "ingest", {
  paths: [relImagePath, "mock/other.jpg"],
  entityLabel: "multi",
});
state = { ...state, userSelections: MVP_PIPELINE };
out = await runWorkflowWithOutputSwitch(state, { outputMode: "external" });
del = out.output.payload.moduleResults?.simple_presentation?.data?.uiModel?.deliverable;
assert("multi-asset items", del?.items?.length === 2);
clearImageAnalysisProvider();

// --- 5) OUTPUT SWITCH internal ---
out = await runWorkflowWithOutputSwitch(runPipeline(), { outputMode: "internal" });
assert("internal switch", out.output.destination === "internal");

// --- 6) Optional real HF (CLIP via worker) — skipped when HF_DISABLE=1 or no usable token ---
if (allowLiveHuggingFaceClip) {
  console.log("\n--- HUGGINGFACE_API_TOKEN (or alias) present: attempting CLIP zero-shot ---");
  setImageAnalysisProvider(huggingFaceProvider);
  out = await runWorkflowWithOutputSwitch(runPipeline(), { outputMode: "external" });
  del = out.output.payload.moduleResults?.simple_presentation?.data?.uiModel?.deliverable;
  const row = del?.items?.[0];
  assert("real hf: provider active", del?.intelligenceMeta?.providerWasActive === true);
  assert("real hf: external source", row?.modelSource !== "heuristic");
  assert("real hf: features.provider", row?.features?.provider === "huggingface");
  assert("real hf: clip ranked", Array.isArray(row?.features?.ranked));
  clearImageAnalysisProvider();
} else if (hfDisableAtStart) {
  console.log("\n(skip) Live CLIP: HF_DISABLE=1 — expecting inactive provider / heuristic (CI mode).");
  process.env.HF_DISABLE = "1";
  setImageAnalysisProvider(huggingFaceProvider);
  out = await runWorkflowWithOutputSwitch(runPipeline(), { outputMode: "external" });
  del = out.output.payload.moduleResults?.simple_presentation?.data?.uiModel?.deliverable;
  assert("ci mode: provider inactive", del?.intelligenceMeta?.providerWasActive === false);
  assert("ci mode: heuristic source", del?.items?.[0]?.modelSource === "heuristic");
  clearImageAnalysisProvider();
  delete process.env.HF_DISABLE;
} else {
  console.log(
    "\n(skip) Live CLIP: set HUGGINGFACE_API_TOKEN in .env (see .env.example) and omit HF_DISABLE.",
  );
}

console.log("\nAll Phase 8 checks passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

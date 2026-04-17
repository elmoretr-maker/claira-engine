/**
 * Execution engine validation: determinism (runs 1–2) + failure isolation (runs 3–4).
 * Does not change engine behavior — observes executeWorkflow only.
 *
 * Run: node dev/validateExecutionDeterminism.mjs
 */
import { executeWorkflow } from "../workflow/execution/workflowExecutor.js";
import { createInitialWorkflowBuildState } from "../workflow/state/workflowBuildState.js";

/**
 * @param {unknown} v
 * @returns {unknown}
 */
function stabilize(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(stabilize);
  const o = /** @type {Record<string, unknown>} */ (v);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of Object.keys(o).sort()) {
    out[k] = stabilize(o[k]);
  }
  return out;
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function deepEqual(a, b) {
  return JSON.stringify(stabilize(a)) === JSON.stringify(stabilize(b));
}

/**
 * @param {unknown} t
 * @returns {Array<{ moduleId: string, status: string }>}
 */
function traceWithoutTime(t) {
  if (!Array.isArray(t)) return [];
  return t.map((e) =>
    e && typeof e === "object"
      ? {
          moduleId: String(/** @type {{ moduleId?: unknown }} */ (e).moduleId ?? ""),
          status: String(/** @type {{ status?: unknown }} */ (e).status ?? ""),
        }
      : { moduleId: "", status: "" },
  );
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function tracesLogicallyEqual(a, b) {
  return JSON.stringify(traceWithoutTime(a)) === JSON.stringify(traceWithoutTime(b));
}

function logSection(title) {
  console.log(`\n${"=".repeat(60)}\n${title}\n${"=".repeat(60)}`);
}

async function main() {
let failed = false;

function fail(msg) {
  console.error(`\nFAIL: ${msg}`);
  failed = true;
}

// --- Baseline state (identical inputs for paired runs) ---
const baseline = createInitialWorkflowBuildState();
const stateDeterminism = {
  ...baseline,
  userSelections: ["test_pass", "test_dispatch", "test_reader"],
};

logSection("STATE VALIDATION (determinism) — before any run");
console.log("userSelections:", JSON.stringify(stateDeterminism.userSelections));
console.log(
  "moduleRuntimeState.entity_tracking (before):",
  JSON.stringify(stateDeterminism.moduleRuntimeState?.["entity_tracking"] ?? null),
);

logSection("DETERMINISM TEST — run1 vs run2 (same state object twice)");
const run1 = await executeWorkflow(stateDeterminism);
const run2 = await executeWorkflow(stateDeterminism);

if (!run1.pipelineValidation?.ok || !run2.pipelineValidation?.ok) {
  fail(`pipeline validation failed: ${JSON.stringify(run1.pipelineValidation)} / ${JSON.stringify(run2.pipelineValidation)}`);
}

const resultsMatch = deepEqual(run1.results, run2.results);
const traceLogicalMatch = tracesLogicallyEqual(run1.executionTrace, run2.executionTrace);
const traceFullMatch = deepEqual(run1.executionTrace, run2.executionTrace);

console.log("results deep-equal:", resultsMatch);
console.log("executionTrace logical-equal (moduleId + status, timestamps ignored):", traceLogicalMatch);
console.log("executionTrace full deep-equal (includes timestamp):", traceFullMatch);
if (!traceFullMatch && traceLogicalMatch) {
  console.log(
    "(Note: timestamps differ between calls — logical trace equality is the determinism criterion for wall-clock fields.)",
  );
}

if (!resultsMatch) {
  fail("run1.results !== run2.results");
  console.error("run1.results:", JSON.stringify(run1.results, null, 2));
  console.error("run2.results:", JSON.stringify(run2.results, null, 2));
}
if (!traceLogicalMatch) {
  fail("run1.executionTrace (logical) !== run2.executionTrace (logical)");
  console.error("run1 trace:", JSON.stringify(run1.executionTrace, null, 2));
  console.error("run2 trace:", JSON.stringify(run2.executionTrace, null, 2));
}

console.log("\n--- run1.results ---");
console.log(JSON.stringify(run1.results, null, 2));
console.log("\n--- run1.executionTrace ---");
console.log(JSON.stringify(run1.executionTrace, null, 2));

logSection("STATE VALIDATION (determinism) — after run1 (input state must be unchanged)");
console.log(
  "moduleRuntimeState.entity_tracking (after run1, baseline object):",
  JSON.stringify(stateDeterminism.moduleRuntimeState?.["entity_tracking"] ?? null),
);
if (stateDeterminism.moduleRuntimeState?.["entity_tracking"] != null) {
  const et = /** @type {{ entities?: unknown[] }} */ (stateDeterminism.moduleRuntimeState["entity_tracking"]);
  if (Array.isArray(et.entities) && et.entities.length > 0) {
    fail("baseline state was mutated — entity_tracking should be unchanged on input object");
  }
}

// --- Failure isolation: same baseline shape, selection includes test_error ---
const stateFailure = {
  ...createInitialWorkflowBuildState(),
  userSelections: ["test_pass", "test_error", "test_reader"],
};

logSection("FAILURE TEST — run3 vs run4");
logSection("STATE VALIDATION (failure) — before");
console.log("userSelections:", JSON.stringify(stateFailure.userSelections));

const run3 = await executeWorkflow(stateFailure);
const run4 = await executeWorkflow(stateFailure);

if (!run3.pipelineValidation?.ok || !run4.pipelineValidation?.ok) {
  fail(`failure-run pipeline validation: ${JSON.stringify(run3.pipelineValidation)}`);
}

const failResultsMatch = deepEqual(run3.results, run4.results);
const failTraceLogical = tracesLogicallyEqual(run3.executionTrace, run4.executionTrace);

console.log("results deep-equal:", failResultsMatch);
console.log("executionTrace logical-equal:", failTraceLogical);

if (!failResultsMatch) {
  fail("run3.results !== run4.results");
  console.error("run3.results:", JSON.stringify(run3.results, null, 2));
  console.error("run4.results:", JSON.stringify(run4.results, null, 2));
}
if (!failTraceLogical) {
  fail("run3.executionTrace (logical) !== run4.executionTrace (logical)");
}

const errRes = run3.results?.["test_error"];
const passOk = run3.results?.["test_pass"]?.status === "ok";
const readerOk = run3.results?.["test_reader"]?.status === "ok";
const errorCaptured =
  errRes?.status === "error" &&
  Array.isArray(errRes?.errors) &&
  errRes.errors.some((e) => String(e).includes("intentional failure"));

if (!errorCaptured) {
  fail("test_error did not capture intentional failure in results");
}
if (!passOk || !readerOk) {
  fail("test_pass or test_reader should still complete with status ok");
}

console.log("\n--- run3.results (failure handling) ---");
console.log(JSON.stringify(run3.results, null, 2));
console.log("\n--- run3.executionTrace ---");
console.log(JSON.stringify(run3.executionTrace, null, 2));

const failOrder = traceWithoutTime(run3.executionTrace).map((x) => x.moduleId).join(",");
if (failOrder !== "test_pass,test_error,test_reader") {
  fail(`expected execution order test_pass → test_error → test_reader, got: ${failOrder}`);
}

logSection("FAILURE TEST — summary");
console.log("test_pass status:", run3.results?.["test_pass"]?.status);
console.log("test_error status:", run3.results?.["test_error"]?.status, "errors:", run3.results?.["test_error"]?.errors);
console.log("test_reader status:", run3.results?.["test_reader"]?.status, "data:", run3.results?.["test_reader"]?.data);

if (failed) {
  console.error("\nvalidateExecutionDeterminism: FAILED\n");
  process.exit(1);
}

console.log("\nvalidateExecutionDeterminism: ALL CHECKS PASSED\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

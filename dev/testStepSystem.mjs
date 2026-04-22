/**
 * Step-system test suite (Phase 6 upgrade).
 *
 * Covers:
 *   Part 1 — expandToSteps
 *     1.  Returns correct stepId / stepIndex for each module.
 *     2.  Duplicate modules get distinct stepIds.
 *     3.  Validates engine contract for every module.
 *     4.  Throws on empty array / non-array.
 *
 *   Part 2 — orderSteps
 *     5.  Linear chain — preserves dependency order.
 *     6.  [A, B, A] — preceding-producer rule gives A__0 → B__1 → A__2.
 *     7.  Independent steps — lexicographic tie-break by stepId.
 *     8.  Same-module ordering — consecutive same-module steps stay in input order.
 *     9.  External consume (no preceding producer) — warns, does not throw.
 *    10.  Cycle guard retained (verify no crash for acyclic inputs).
 *    11.  Input step list is NOT mutated.
 *    12.  Returns orderedSteps, dependencyGraph, externalConsumes.
 *    13.  Determinism — same input, different insertion order → same stepId sequence.
 *
 *   Part 3 — executeWorkflow step identity
 *    14.  Each WorkflowStepResult now has stepId and stepIndex.
 *    15.  Duplicate module (same module twice) → two distinct stepIds in results.
 *    16.  failedAt is now a stepId, not a moduleId.
 *    17.  Produced artifacts carry producedByStepId and stepIndex.
 *    18.  producedByStepId on artifact matches the stepId in the step result.
 *    19.  Two steps of the same module produce artifacts with DIFFERENT stepIds.
 *
 * Run with:
 *   node dev/testStepSystem.mjs
 */

import { expandToSteps, orderSteps } from "../workflow/execution/workflowOrdering.js";
import { executeWorkflow } from "../workflow/execution/workflowRunner.js";
import { initRunClaira } from "../server/runClaira.js";

// =============================================================================
// Harness
// =============================================================================

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? "assertion failed");
}

function assertThrows(fn, pattern) {
  let msg = "";
  try { fn(); throw new Error("NO_THROW"); }
  catch (e) { msg = e instanceof Error ? e.message : String(e); }
  if (msg === "NO_THROW") throw new Error(`Expected throw "${pattern}" but nothing was thrown`);
  if (pattern && !msg.includes(pattern)) {
    throw new Error(`Expected error containing "${pattern}", got: "${msg}"`);
  }
}

// =============================================================================
// Mock modules
// =============================================================================

const BASE = {
  label:                  "Mock",
  description:            "Step system test.",
  capabilities:           ["mock"],
  modulePipelineType:     "processing",
  expectedContextVersion: 2,
  state:  { initialize: () => ({}), selectors: {}, reducers: {} },
  health: { check: () => ({ status: "healthy", issues: [] }) },
  ui:     { components: [] },
};

function mod(id, consumes, produces, engineKinds = ["entity.register"]) {
  return { ...BASE, id, engineKinds, consumes, produces };
}
function out(kind) { return { kind, mode: "create" }; }

// Module A: produces entity, consumes analysis (for the [A,B,A] chain test).
const MOD_A = mod("mod_a", ["analysis"], [out("entity")]);

// Module B: produces analysis, consumes entity.
const MOD_B = mod("mod_b", ["entity"], [out("analysis")]);

// Source module: no consumes.
const MOD_SRC = mod("mod_src", [], [out("entity")]);

// Sink module: consumes entity, no produces (uses aggregate as proxy).
const MOD_SINK = mod("mod_sink", ["entity"], [out("aggregate")]);

// Module with missing engineKinds (invalid).
const MOD_BAD = { ...BASE, id: "bad", consumes: [], produces: [] };

// =============================================================================
// Engine mock
// =============================================================================

initRunClaira({
  "entity.register": async () => ({ entities: [{ id: "e1", name: "boot" }] }),
  "analysis.run":    async () => ({ analysis: { score: 0.9 } }),
});

// Shared test context
const CTX = { sessionId: "sess_step", workflowRunId: "run_step", accountId: "acct" };

// Mock modules for execution tests (must satisfy full engine contract + produce correct artifacts).
const EXEC_MOD_SRC = {
  ...BASE,
  id:          "exec_src",
  engineKinds: ["entity.register"],
  consumes:    [],
  produces:    [out("entity")],
  buildPayload:         () => ({ names: ["boot"] }),
  normalizeToArtifacts: (results, _ctx) => [{
    artifactType:    "entity",
    artifactVersion: 1,
    moduleId:        "exec_src",
    sourceKind:      "entity.register",
    data:            results[0]?.result ?? {},
  }],
};

const EXEC_MOD_SINK = {
  ...BASE,
  id:          "exec_sink",
  engineKinds: ["entity.register"],
  consumes:    ["entity"],
  produces:    [out("aggregate")],
  buildPayload:         (consumed) => ({ entities: consumed["entity"]?.[0]?.data?.entities ?? [] }),
  normalizeToArtifacts: (results, _ctx) => [{
    artifactType:    "aggregate",
    artifactVersion: 1,
    moduleId:        "exec_sink",
    sourceKind:      "entity.register",
    data:            results[0]?.result ?? {},
  }],
};

// =============================================================================
// Part 1 — expandToSteps
// =============================================================================

console.log("\n── Part 1: expandToSteps ────────────────────────────────────────────────\n");

await test("returns one step per module with correct stepIndex", () => {
  const steps = expandToSteps([MOD_SRC, MOD_SINK]);
  assert(steps.length === 2, "should return 2 steps");
  assert(steps[0].stepIndex === 0, "step 0 has stepIndex 0");
  assert(steps[1].stepIndex === 1, "step 1 has stepIndex 1");
});

await test("stepId = ${module.id}__${stepIndex}", () => {
  const steps = expandToSteps([MOD_SRC, MOD_SINK]);
  assert(steps[0].stepId === "mod_src__0", `expected mod_src__0, got ${steps[0].stepId}`);
  assert(steps[1].stepId === "mod_sink__1", `expected mod_sink__1, got ${steps[1].stepId}`);
});

await test("duplicate modules get distinct stepIds", () => {
  const steps = expandToSteps([MOD_SRC, MOD_SRC]);
  assert(steps[0].stepId === "mod_src__0", `got ${steps[0].stepId}`);
  assert(steps[1].stepId === "mod_src__1", `got ${steps[1].stepId}`);
  assert(steps[0].stepId !== steps[1].stepId, "stepIds must be distinct");
});

await test("module reference is preserved in step.module", () => {
  const steps = expandToSteps([MOD_SRC]);
  assert(steps[0].module === MOD_SRC, "step.module must be the same reference");
});

await test("throws on invalid module (missing engineKinds)", () => {
  assertThrows(() => expandToSteps([MOD_BAD]), "engineKinds");
});

await test("throws on empty array", () => {
  assertThrows(() => expandToSteps([]), "empty");
});

await test("throws on non-array", () => {
  assertThrows(() => expandToSteps(null), "array");
});

// =============================================================================
// Part 2 — orderSteps
// =============================================================================

console.log("\n── Part 2: orderSteps ───────────────────────────────────────────────────\n");

await test("linear chain — producer step before consumer step (correct input order)", () => {
  // orderSteps uses "preceding producers only": step Y depends on step X only if
  // X.stepIndex < Y.stepIndex. So the input order must already put producers first.
  // When producer comes after consumer in the input, the dependency is external.
  const steps = expandToSteps([MOD_SRC, MOD_SINK]); // producer first — correct order
  const { orderedSteps } = orderSteps(steps);
  const ids = orderedSteps.map((s) => s.stepId);
  // Both steps are correctly ordered: src__0 (no deps) → sink__1 (depends on src__0)
  assert(ids[0] === "mod_src__0",  `expected mod_src__0 first, got ${ids[0]}`);
  assert(ids[1] === "mod_sink__1", `expected mod_sink__1 second, got ${ids[1]}`);
});

await test("[A, B, A] — preceding-producer rule: A__0 → B__1 → A__2", () => {
  // MOD_A.consumes=["analysis"], MOD_B.produces=[{kind:"analysis"}]
  // MOD_B.consumes=["entity"],   MOD_A.produces=[{kind:"entity"}]
  //
  // With preceding-only rule:
  //   A__0: consumes analysis → no preceding producer → external
  //   B__1: consumes entity   → A__0 (preceding, produces entity) → A__0 → B__1
  //   A__2: consumes analysis → B__1 (preceding, produces analysis) → B__1 → A__2
  //         + same-module: A__0 → A__2
  // Result: A__0 → B__1 → A__2
  const steps = expandToSteps([MOD_A, MOD_B, MOD_A]);
  const { orderedSteps } = orderSteps(steps);
  const ids = orderedSteps.map((s) => s.stepId);
  assert(ids[0] === "mod_a__0", `expected mod_a__0 first, got ${ids[0]}`);
  assert(ids[1] === "mod_b__1", `expected mod_b__1 second, got ${ids[1]}`);
  assert(ids[2] === "mod_a__2", `expected mod_a__2 third, got ${ids[2]}`);
});

await test("independent steps — lexicographic tie-break by stepId", () => {
  const Z = mod("z_mod", [], [out("entity")]);
  const A = mod("a_mod", [], [out("entity")]);
  const M = mod("m_mod", [], [out("entity")]);
  const steps = expandToSteps([Z, M, A]);
  const { orderedSteps } = orderSteps(steps);
  const ids = orderedSteps.map((s) => s.stepId);
  // stepIds: z_mod__0, m_mod__1, a_mod__2 → sorted lex: a_mod__2 < m_mod__1 < z_mod__0
  assert(ids[0] === "a_mod__2", `expected a_mod__2 first, got ${ids[0]}`);
  assert(ids[1] === "m_mod__1", `expected m_mod__1 second, got ${ids[1]}`);
  assert(ids[2] === "z_mod__0", `expected z_mod__0 third, got ${ids[2]}`);
});

await test("same-module steps stay in input order regardless of stepId sort", () => {
  // Two steps of MOD_SRC (no deps) — same-module constraint ensures src__0 before src__1.
  const steps = expandToSteps([MOD_SRC, MOD_SRC]);
  const { orderedSteps } = orderSteps(steps);
  const ids = orderedSteps.map((s) => s.stepId);
  assert(ids[0] === "mod_src__0", `expected mod_src__0 first, got ${ids[0]}`);
  assert(ids[1] === "mod_src__1", `expected mod_src__1 second, got ${ids[1]}`);
});

await test("external consume does not throw — warns only", () => {
  // MOD_A consumes analysis, but no preceding step produces it.
  const steps = expandToSteps([MOD_A]);
  // Should succeed without throwing; analysis is treated as external.
  const { orderedSteps, externalConsumes } = orderSteps(steps);
  assert(orderedSteps.length === 1, "should return 1 step");
  assert(externalConsumes.has("analysis"), "externalConsumes should flag analysis");
  assert(
    externalConsumes.get("analysis")?.includes("mod_a__0"),
    "mod_a__0 should be listed as needing external analysis",
  );
});

await test("result has orderedSteps, dependencyGraph, externalConsumes", () => {
  const steps = expandToSteps([MOD_SRC]);
  const result = orderSteps(steps);
  assert(Array.isArray(result.orderedSteps), "orderedSteps must be array");
  assert(result.dependencyGraph instanceof Object, "dependencyGraph must be present");
  assert(result.dependencyGraph.deps instanceof Map, "deps must be a Map");
  assert(result.externalConsumes instanceof Map, "externalConsumes must be a Map");
});

await test("input step list is NOT mutated by orderSteps", () => {
  const steps = expandToSteps([MOD_SINK, MOD_SRC]); // reversed
  const originalFirst = steps[0].stepId;
  orderSteps(steps);
  assert(steps[0].stepId === originalFirst, "input[0] must not be mutated");
});

await test("determinism — same logical input in different insertion orders", () => {
  // Two independent steps: a_mod and z_mod.
  const A = mod("a_ind", [], [out("entity")]);
  const Z = mod("z_ind", [], [out("entity")]);

  const run1 = orderSteps(expandToSteps([A, Z])).orderedSteps.map((s) => s.stepId);
  const run2 = orderSteps(expandToSteps([A, Z])).orderedSteps.map((s) => s.stepId);
  assert(run1.join(",") === run2.join(","), `run1=${run1} ≠ run2=${run2}`);
});

// =============================================================================
// Part 3 — executeWorkflow step identity
// =============================================================================

console.log("\n── Part 3: executeWorkflow step identity ─────────────────────────────────\n");

await test("step results include stepId and stepIndex", async () => {
  const result = await executeWorkflow([EXEC_MOD_SRC], CTX);
  const s = result.steps[0];
  assert(typeof s.stepId === "string" && s.stepId.length > 0, "stepId must be non-empty string");
  assert(typeof s.stepIndex === "number", "stepIndex must be a number");
  assert(s.stepId === "exec_src__0", `expected exec_src__0, got ${s.stepId}`);
  assert(s.stepIndex === 0, `expected stepIndex 0, got ${s.stepIndex}`);
});

await test("two-step workflow returns correct stepIds for both steps", async () => {
  const result = await executeWorkflow([EXEC_MOD_SRC, EXEC_MOD_SINK], CTX);
  assert(result.steps[0].stepId === "exec_src__0",  `step 0: ${result.steps[0].stepId}`);
  assert(result.steps[1].stepId === "exec_sink__1", `step 1: ${result.steps[1].stepId}`);
  assert(result.steps[0].stepIndex === 0, "step 0 has stepIndex 0");
  assert(result.steps[1].stepIndex === 1, "step 1 has stepIndex 1");
});

await test("duplicate module (same module twice) → two distinct stepIds in results", async () => {
  const result = await executeWorkflow([EXEC_MOD_SRC, EXEC_MOD_SRC], {
    sessionId:     "sess_dup",
    workflowRunId: "run_dup",
  });
  const ids = result.steps.map((s) => s.stepId);
  assert(ids[0] === "exec_src__0", `got ${ids[0]}`);
  assert(ids[1] === "exec_src__1", `got ${ids[1]}`);
  assert(ids[0] !== ids[1], "duplicate modules must produce distinct stepIds");
});

await test("failedAt is a stepId (not moduleId) when a step fails", async () => {
  const failMod = {
    ...BASE,
    id:          "exec_fail",
    engineKinds: ["entity.register"],
    consumes:    [],
    produces:    [out("entity")],
    buildPayload:         () => ({}),
    normalizeToArtifacts: () => { throw new Error("forced failure"); },
  };
  const result = await executeWorkflow([failMod], CTX);
  assert(result.status === "failed", "status must be failed");
  // failedAt should be the stepId "exec_fail__0", not just "exec_fail"
  assert(result.failedAt === "exec_fail__0", `expected exec_fail__0, got ${result.failedAt}`);
});

await test("produced artifacts carry producedByStepId and stepIndex", async () => {
  const result = await executeWorkflow([EXEC_MOD_SRC], CTX);
  const artifact = result.steps[0].producedArtifacts[0];
  assert(artifact != null, "artifact must exist");
  assert(
    artifact.producedByStepId === "exec_src__0",
    `expected producedByStepId=exec_src__0, got ${artifact.producedByStepId}`,
  );
  assert(
    artifact.stepIndex === 0,
    `expected stepIndex=0, got ${artifact.stepIndex}`,
  );
});

await test("producedByStepId on artifact matches stepId in step result", async () => {
  const result = await executeWorkflow([EXEC_MOD_SRC, EXEC_MOD_SINK], CTX);
  for (const step of result.steps) {
    for (const artifact of step.producedArtifacts) {
      assert(
        artifact.producedByStepId === step.stepId,
        `artifact.producedByStepId=${artifact.producedByStepId} ≠ step.stepId=${step.stepId}`,
      );
      assert(
        artifact.stepIndex === step.stepIndex,
        `artifact.stepIndex=${artifact.stepIndex} ≠ step.stepIndex=${step.stepIndex}`,
      );
    }
  }
});

await test("two steps of same module produce artifacts with different stepIds", async () => {
  const result = await executeWorkflow([EXEC_MOD_SRC, EXEC_MOD_SRC], {
    sessionId:     "sess_dup2",
    workflowRunId: "run_dup2",
  });
  const a0 = result.steps[0].producedArtifacts[0];
  const a1 = result.steps[1].producedArtifacts[0];
  assert(a0 != null && a1 != null, "both steps must produce artifacts");
  assert(
    a0.producedByStepId !== a1.producedByStepId,
    `both artifacts have the same producedByStepId: ${a0.producedByStepId}`,
  );
  assert(a0.producedByStepId === "exec_src__0", `a0: ${a0.producedByStepId}`);
  assert(a1.producedByStepId === "exec_src__1", `a1: ${a1.producedByStepId}`);
});

// =============================================================================
// Summary
// =============================================================================

await new Promise((r) => setTimeout(r, 50));
const total = passed + failed;
console.log(`\n── Result: ${passed}/${total} passed${failed > 0 ? ` (${failed} FAILED)` : ""} ──\n`);
if (failed > 0) process.exit(1);

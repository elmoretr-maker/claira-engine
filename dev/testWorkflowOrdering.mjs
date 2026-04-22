/**
 * Phase 6 test suite — orderModules
 *
 * Validates that workflowOrdering correctly:
 *   1.  Linear chain: A→B ordered correctly.
 *   2.  Diamond dependency: shared predecessor before shared successor.
 *   3.  Independent modules: no deps → stable lexicographic order.
 *   4.  Mixed: some deps, some independent.
 *   5.  Cycle (A↔B): throws with both module IDs in message.
 *   6.  Longer cycle (A→B→C→A): throws.
 *   7.  Determinism: same input, different insertion order → same output.
 *   8.  Tie-break: among equally eligible modules → lexicographic by id.
 *   9.  External consumes: kind not produced in list → no throw, warning only.
 *  10.  Returns dependencyGraph and externalConsumes in result.
 *  11.  Duplicate module IDs → throws.
 *  12.  Invalid module (missing engineKinds) → throws.
 *  13.  Non-array input → throws.
 *  14.  Empty array → throws.
 *  15.  Single module → returns it unchanged.
 *  16.  Self-dependency (module produces and consumes same kind) → no cycle.
 *  17.  Input array is NOT modified.
 *
 * Run with:
 *   node dev/testWorkflowOrdering.mjs
 */

import { orderModules } from "../workflow/execution/workflowOrdering.js";

// =============================================================================
// Minimal test harness
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

function assert(condition, msg) {
  if (!condition) throw new Error(msg ?? "assertion failed");
}

function assertThrows(fn, pattern) {
  let threw = false;
  let msg = "";
  try { fn(); } catch (e) { threw = true; msg = e instanceof Error ? e.message : String(e); }
  if (!threw) throw new Error(`Expected throw containing "${pattern}" but nothing was thrown`);
  if (pattern && !msg.includes(pattern)) {
    throw new Error(`Expected error containing "${pattern}", got: "${msg}"`);
  }
}

// =============================================================================
// Module factory
// =============================================================================

// Shared base satisfying assertModuleFollowsContract.
const BASE = {
  label:                  "Mock",
  description:            "Ordering test module.",
  capabilities:           ["mock"],
  modulePipelineType:     "processing",
  expectedContextVersion: 2,
  state:  { initialize: () => ({}), selectors: {}, reducers: {} },
  health: { check: () => ({ status: "healthy", issues: [] }) },
  ui:     { components: [] },
};

/**
 * Make a minimal engine-contract module.
 *
 * @param {string} id
 * @param {string[]} consumes  Registered artifact kinds.
 * @param {Array<{ kind: string, mode: string }>} produces
 * @param {string[]} [engineKinds]
 */
function mod(id, consumes, produces, engineKinds = ["entity.register"]) {
  return { ...BASE, id, engineKinds, consumes, produces };
}

// Shorthand produce entry.
function out(kind) { return { kind, mode: "create" }; }

// =============================================================================
// Tests
// =============================================================================

console.log("\n── Phase 6: orderModules ────────────────────────────────────────────────\n");

// ── Group 1: basic ordering ───────────────────────────────────────────────

console.log("Group 1: basic ordering");

await test("linear chain — producer before consumer", () => {
  // A produces entity; B consumes entity. Expected: [A, B].
  const A = mod("mod_a", [],        [out("entity")]);
  const B = mod("mod_b", ["entity"], [out("analysis")]);

  const { orderedModules } = orderModules([B, A]); // intentionally reversed input
  assert(orderedModules[0] === A, "A should come first");
  assert(orderedModules[1] === B, "B should come second");
});

await test("three-step chain — preserves full order", () => {
  // A→entity→B→analysis→C
  const A = mod("mod_a", [],          [out("entity")]);
  const B = mod("mod_b", ["entity"],   [out("analysis")]);
  const C = mod("mod_c", ["analysis"], [out("aggregate")]);

  const { orderedModules } = orderModules([C, A, B]); // shuffled
  const ids = orderedModules.map((m) => /** @type {any} */ (m).id);
  assert(ids[0] === "mod_a", `expected mod_a first, got ${ids[0]}`);
  assert(ids[1] === "mod_b", `expected mod_b second, got ${ids[1]}`);
  assert(ids[2] === "mod_c", `expected mod_c third, got ${ids[2]}`);
});

await test("diamond — shared predecessor before both branches, both branches before sink", () => {
  // A → entity → B, C
  //           ↘       ↘
  //             D (consumes both entity and analysis, needs B after A)
  // A produces entity. B consumes entity, produces analysis.
  // C consumes entity (independent of B). D consumes entity + analysis.
  const A = mod("mod_a", [],                     [out("entity")]);
  const B = mod("mod_b", ["entity"],              [out("analysis")]);
  const C = mod("mod_c", ["entity"],              [out("aggregate")]);
  const D = mod("mod_d", ["entity", "analysis"],  [out("deliverable")]);

  const { orderedModules } = orderModules([D, C, B, A]);
  const ids = orderedModules.map((m) => /** @type {any} */ (m).id);

  // A must be first; D must be last.
  assert(ids[0] === "mod_a", `A must be first, got ${ids[0]}`);
  assert(ids[ids.length - 1] === "mod_d", `D must be last, got ${ids[ids.length - 1]}`);
  // B must come before D.
  assert(ids.indexOf("mod_b") < ids.indexOf("mod_d"), "B must precede D");
  // C must come before D (C produces aggregate, but D does not consume it — ok).
  // The constraint is: D consumes entity (produced by A) and analysis (produced by B).
  // C's relative position to B and D is determined by tie-break (both free after A).
});

// ── Group 2: independent modules (tie-break) ──────────────────────────────

console.log("\nGroup 2: independent modules and tie-break");

await test("no dependencies — output is lexicographic by id", () => {
  const Z = mod("z_mod", [], [out("entity")]);
  const A = mod("a_mod", [], [out("entity")]);
  const M = mod("m_mod", [], [out("entity")]);

  const { orderedModules } = orderModules([Z, M, A]);
  const ids = orderedModules.map((m) => /** @type {any} */ (m).id);
  assert(ids[0] === "a_mod", `expected a_mod first, got ${ids[0]}`);
  assert(ids[1] === "m_mod", `expected m_mod second, got ${ids[1]}`);
  assert(ids[2] === "z_mod", `expected z_mod third, got ${ids[2]}`);
});

await test("tie-break: among eligible siblings, lexicographic order wins", () => {
  // A produces entity. B and C both consume entity (no dep between B and C).
  // B and C are equally eligible after A — tie-break by id.
  const A = mod("alpha",   [],        [out("entity")]);
  const B = mod("charlie", ["entity"], [out("analysis")]);
  const C = mod("bravo",   ["entity"], [out("analysis")]);

  const { orderedModules } = orderModules([B, C, A]);
  const ids = orderedModules.map((m) => /** @type {any} */ (m).id);
  assert(ids[0] === "alpha",   `expected alpha first, got ${ids[0]}`);
  assert(ids[1] === "bravo",   `expected bravo second (tie-break), got ${ids[1]}`);
  assert(ids[2] === "charlie", `expected charlie third (tie-break), got ${ids[2]}`);
});

// ── Group 3: determinism ──────────────────────────────────────────────────

console.log("\nGroup 3: determinism");

await test("same logical graph in different insertion orders → identical output", () => {
  const A = mod("aa", [],      [out("entity")]);
  const B = mod("bb", ["entity"], [out("analysis")]);
  const C = mod("cc", [],      [out("entity")]);

  const run1 = orderModules([A, B, C]).orderedModules.map((m) => /** @type {any} */ (m).id);
  const run2 = orderModules([C, A, B]).orderedModules.map((m) => /** @type {any} */ (m).id);
  const run3 = orderModules([B, C, A]).orderedModules.map((m) => /** @type {any} */ (m).id);

  assert(run1.join(",") === run2.join(","), `run1=${run1} ≠ run2=${run2}`);
  assert(run2.join(",") === run3.join(","), `run2=${run2} ≠ run3=${run3}`);
});

// ── Group 4: cycle detection ──────────────────────────────────────────────

console.log("\nGroup 4: cycle detection");

await test("two-module cycle throws with both IDs in message", () => {
  // A consumes analysis (produced by B), B consumes entity (produced by A).
  const A = mod("cycle_a", ["analysis"], [out("entity")]);
  const B = mod("cycle_b", ["entity"],   [out("analysis")]);

  assertThrows(() => orderModules([A, B]), "cycle detected");
  assertThrows(() => orderModules([A, B]), "cycle_a");
  assertThrows(() => orderModules([A, B]), "cycle_b");
});

await test("three-module cycle throws", () => {
  const A = mod("ring_a", ["aggregate"], [out("entity")]);
  const B = mod("ring_b", ["entity"],    [out("analysis")]);
  const C = mod("ring_c", ["analysis"],  [out("aggregate")]);

  assertThrows(() => orderModules([A, B, C]), "cycle detected");
  assertThrows(() => orderModules([A, B, C]), "ring_a");
});

await test("valid modules plus a separate cycle sub-graph → throws", () => {
  // D is valid (no deps). A↔B form a cycle.
  const D = mod("independent", [], [out("deliverable")]);
  const A = mod("cyc_a", ["analysis"], [out("entity")]);
  const B = mod("cyc_b", ["entity"],   [out("analysis")]);

  assertThrows(() => orderModules([D, A, B]), "cycle detected");
});

// ── Group 5: external consumes ────────────────────────────────────────────

console.log("\nGroup 5: external consumes (no-throw)");

await test("consuming unproduced kind does NOT throw", () => {
  // B consumes 'event' — no module in list produces it.
  const A = mod("mod_x", [],       [out("entity")]);
  const B = mod("mod_y", ["event"], [out("analysis")]);

  // Should succeed — external consume is informational only.
  const { orderedModules, externalConsumes } = orderModules([A, B]);
  assert(orderedModules.length === 2, "should still return both modules");
  assert(externalConsumes.has("event"), "externalConsumes should flag 'event'");
  assert(
    externalConsumes.get("event")?.includes("mod_y"),
    "externalConsumes['event'] should include mod_y",
  );
});

await test("external consume does not create a spurious dependency", () => {
  // B consumes 'event' (external) and is otherwise independent of A.
  // Expected order: a_mod, b_mod (lexicographic — no dependency between them).
  const A = mod("a_mod", [],       [out("entity")]);
  const B = mod("b_mod", ["event"], [out("analysis")]);

  const { orderedModules } = orderModules([B, A]);
  const ids = orderedModules.map((m) => /** @type {any} */ (m).id);
  // Lexicographic tie-break: a_mod before b_mod.
  assert(ids[0] === "a_mod", `expected a_mod first, got ${ids[0]}`);
  assert(ids[1] === "b_mod", `expected b_mod second, got ${ids[1]}`);
});

// ── Group 6: result shape ─────────────────────────────────────────────────

console.log("\nGroup 6: result shape");

await test("result has orderedModules, dependencyGraph, externalConsumes", () => {
  const A = mod("m_a", [], [out("entity")]);
  const result = orderModules([A]);
  assert(Array.isArray(result.orderedModules), "orderedModules must be array");
  assert(result.dependencyGraph != null, "dependencyGraph must be present");
  assert(result.dependencyGraph.deps instanceof Map, "deps must be a Map");
  assert(result.dependencyGraph.successors instanceof Map, "successors must be a Map");
  assert(result.dependencyGraph.producersByKind instanceof Map, "producersByKind must be a Map");
  assert(result.externalConsumes instanceof Map, "externalConsumes must be a Map");
});

await test("orderedModules contains same object references as input", () => {
  const A = mod("ref_a", [], [out("entity")]);
  const B = mod("ref_b", ["entity"], [out("analysis")]);
  const { orderedModules } = orderModules([A, B]);
  assert(orderedModules[0] === A || orderedModules[0] === B, "should be same reference");
  assert(orderedModules.some((m) => m === A), "A reference must be present");
  assert(orderedModules.some((m) => m === B), "B reference must be present");
});

// ── Group 7: input validation ─────────────────────────────────────────────

console.log("\nGroup 7: input validation");

await test("non-array input throws", () => {
  assertThrows(() => orderModules(null), "moduleList");
  assertThrows(() => orderModules("oops"), "moduleList");
});

await test("empty array throws", () => {
  assertThrows(() => orderModules([]), "empty");
});

await test("duplicate module IDs throw", () => {
  const A = mod("dup_id", [], [out("entity")]);
  const B = mod("dup_id", [], [out("analysis")]);
  assertThrows(() => orderModules([A, B]), "dup_id");
});

await test("module missing engineKinds throws", () => {
  const bad = { ...BASE, id: "no_kinds", consumes: [], produces: [] };
  assertThrows(() => orderModules([bad]), "engineKinds");
});

await test("single module returns it in a one-element array", () => {
  const A = mod("solo", [], [out("entity")]);
  const { orderedModules } = orderModules([A]);
  assert(orderedModules.length === 1, "should have 1 module");
  assert(orderedModules[0] === A, "should be the same reference");
});

// ── Group 8: input immutability ───────────────────────────────────────────

console.log("\nGroup 8: input immutability");

await test("input array is not modified by ordering", () => {
  const A = mod("z_first", [],       [out("entity")]);
  const B = mod("a_last",  ["entity"], [out("analysis")]);
  const input = [A, B]; // A before B in input

  orderModules(input);

  // Input should be unchanged: A is still at index 0.
  assert(input[0] === A, "input[0] must remain A (not mutated)");
  assert(input[1] === B, "input[1] must remain B (not mutated)");
});

// ── Group 9: self-dependency ──────────────────────────────────────────────

console.log("\nGroup 9: self-dependency (produces and consumes same kind)");

await test("module that produces and consumes same kind is NOT a cycle", () => {
  // This is unusual but valid — a module may both read and write the same kind
  // (e.g. an aggregate that accumulates). The self-edge is skipped.
  const A = mod("self_dep", ["entity"], [out("entity")]);
  const { orderedModules } = orderModules([A]);
  assert(orderedModules.length === 1, "should succeed with 1 module");
  assert(orderedModules[0] === A, "should return the module");
});

// =============================================================================
// Summary
// =============================================================================

await new Promise((r) => setTimeout(r, 50));
const total = passed + failed;
console.log(`\n── Result: ${passed}/${total} passed${failed > 0 ? ` (${failed} FAILED)` : ""} ──\n`);
if (failed > 0) process.exit(1);

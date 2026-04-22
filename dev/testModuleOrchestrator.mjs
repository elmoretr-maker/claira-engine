/**
 * Phase 4 test — module orchestrator (standalone, no server required).
 *
 * Validates that executeModuleStep:
 *   1. Rejects modules missing engineKinds (engine contract guard)
 *   2. Calls runClaira() — not a handler or pipeline directly
 *   3. Writes a fully-valid artifact to the store
 *   4. Returns producedArtifacts and engineResults with correct shape
 *
 * Run: node dev/testModuleOrchestrator.mjs
 */

import { initRunClaira, _resetRunClairaForTesting } from "../server/runClaira.js";
import { createRuntimeArtifactStore } from "../workflow/pipeline/runtimeArtifactStore.js";
import { executeModuleStep } from "../workflow/execution/moduleOrchestrator.js";
import { assertEngineContract } from "../workflow/modules/moduleContract.js";

// =============================================================================
// Test infrastructure
// =============================================================================

let passed = 0;
let failed = 0;

/**
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 */
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

/**
 * @param {unknown} value
 * @param {string} message
 */
function assert(value, message) {
  if (!value) throw new Error(`Assertion failed: ${message}`);
}

/**
 * @param {() => unknown} fn
 * @param {string} expectedSubstring
 */
function assertThrows(fn, expectedSubstring) {
  let threw = false;
  let msg = "";
  try { fn(); } catch (e) { threw = true; msg = e instanceof Error ? e.message : String(e); }
  if (!threw) throw new Error(`Expected a throw containing "${expectedSubstring}" but nothing was thrown`);
  if (!msg.includes(expectedSubstring)) {
    throw new Error(`Expected error containing "${expectedSubstring}", got: "${msg}"`);
  }
}

/**
 * @param {() => Promise<unknown>} fn
 * @param {string} expectedSubstring
 */
async function assertThrowsAsync(fn, expectedSubstring) {
  let threw = false;
  let msg = "";
  try { await fn(); } catch (e) { threw = true; msg = e instanceof Error ? e.message : String(e); }
  if (!threw) throw new Error(`Expected a throw containing "${expectedSubstring}" but nothing was thrown`);
  if (!msg.includes(expectedSubstring)) {
    throw new Error(`Expected error containing "${expectedSubstring}", got: "${msg}"`);
  }
}

// =============================================================================
// Mock handler — replaces CLAIRA_RUN_HANDLERS for this test
// =============================================================================

/** Track which kinds were actually called by runClaira. */
const calledKinds = [];

/**
 * Mock implementation of the "createTrackingEntity" engine handler.
 * Returns a minimal entity object that the mock module's normalizeToArtifacts
 * will wrap into an EntitySet artifact.
 *
 * @param {Record<string, any>} body
 */
async function mockCreateTrackingEntity(body) {
  calledKinds.push("createTrackingEntity");
  return {
    entityId:    `entity_${Date.now()}`,
    displayName: body.displayName ?? "Unnamed Entity",
    createdAt:   new Date().toISOString(),
  };
}

// =============================================================================
// Mock module — satisfies full assertEngineContract
// =============================================================================

/**
 * A minimal new-architecture module for testing Phase 4.
 *
 * This is what a real module will look like:
 *   - Declares engineKinds (the runClaira kinds it calls).
 *   - buildPayload:          consumes → runClaira payload.
 *   - normalizeToArtifacts:  engine results → partial artifact fields.
 *   - All base contract fields (id, label, state, health, ui, …) are present.
 *
 * NOTE: consumes: [] because this is a source module (no prior artifacts needed).
 * produces uses ARTIFACT_KINDS vocabulary ("entity") for base contract validation.
 */
const mockEntityRegistryModule = {
  // ── Base contract fields ──────────────────────────────────────────────────
  id:                    "entity_registry_mock",
  label:                 "Entity Registry (mock)",
  description:           "Registers a single entity — mock for Phase 4 testing.",
  capabilities:          ["entity_tracking"],
  modulePipelineType:    "input",
  consumes:              [],
  produces:              [{ kind: "entity", mode: "create" }],
  expectedContextVersion: 2,
  state: {
    initialize: () => ({}),
    selectors:  {},
    reducers:   {},
  },
  health: {
    check: () => ({ status: "healthy", issues: [] }),
  },
  ui: {
    components: [],
  },

  // ── Engine contract fields ────────────────────────────────────────────────
  engineKinds: ["createTrackingEntity"],

  /**
   * Build the runClaira payload from consumed artifacts.
   * This module is a source — artifacts is empty. It uses a hardcoded
   * display name for the test; a real module would derive it from inputs.
   *
   * @param {Record<string, any>} _artifacts  empty for source modules
   * @param {{ sessionId: string }} _ctx
   * @returns {Record<string, unknown>}
   */
  buildPayload(_artifacts, _ctx) {
    return {
      displayName: "Test Entity Alpha",
      category:    "test",
    };
  },

  /**
   * Normalize raw engine results into partial artifact fields.
   * The orchestrator merges in sessionId, workflowRunId, rid, and calls
   * buildArtifact() — this function only provides the domain-specific fields.
   *
   * @param {Array<{ kind: string, result: unknown }>} engineResults
   * @param {{ sessionId: string, workflowRunId: string }} _ctx
   * @returns {Array<import("../workflow/pipeline/runtimeArtifactStore.js").PartialArtifactFields>}
   */
  normalizeToArtifacts(engineResults, _ctx) {
    const entityResult = engineResults[0]?.result ?? null;
    return [
      {
        artifactType:    "EntitySet",
        artifactVersion: 1,
        moduleId:        "entity_registry_mock",
        sourceKind:      "createTrackingEntity",
        data:            { entities: entityResult ? [entityResult] : [] },
      },
    ];
  },
};

// =============================================================================
// Tests
// =============================================================================

console.log("\n── Phase 4: Module Orchestrator ───────────────────────────────\n");

// ── Setup: initialise runClaira with the mock handler map ─────────────────
// _resetRunClairaForTesting() clears any previous initialisation so this test
// is isolated and can call initRunClaira() fresh.
_resetRunClairaForTesting();
initRunClaira({ createTrackingEntity: mockCreateTrackingEntity });

// ── Suite 1: Contract guard ───────────────────────────────────────────────
console.log("Suite 1 — Contract guard");

await test("assertEngineContract passes on the mock module", () => {
  assertEngineContract(mockEntityRegistryModule, "mockEntityRegistryModule");
});

await test("assertEngineContract rejects a module without engineKinds", () => {
  const badModule = { ...mockEntityRegistryModule, id: "bad_module" };
  delete /** @type {any} */ (badModule).engineKinds;
  assertThrows(
    () => assertEngineContract(badModule, "badModule"),
    "engineKinds is required",
  );
});

await test("executeModuleStep rejects a module without engineKinds", async () => {
  const store = createRuntimeArtifactStore();
  const badModule = { ...mockEntityRegistryModule, id: "bad_module_2" };
  delete /** @type {any} */ (badModule).engineKinds;
  await assertThrowsAsync(
    () => executeModuleStep(badModule, store, {
      sessionId: "sess_test", workflowRunId: "run_test",
    }),
    "engineKinds is required",
  );
});

await test("executeModuleStep rejects missing sessionId", async () => {
  const store = createRuntimeArtifactStore();
  await assertThrowsAsync(
    () => executeModuleStep(mockEntityRegistryModule, store, {
      workflowRunId: "run_test",
    }),
    "context.sessionId must be a non-empty string",
  );
});

await test("executeModuleStep rejects missing workflowRunId", async () => {
  const store = createRuntimeArtifactStore();
  await assertThrowsAsync(
    () => executeModuleStep(mockEntityRegistryModule, store, {
      sessionId: "sess_test",
    }),
    "context.workflowRunId must be a non-empty string",
  );
});

// ── Suite 2: Engine call ──────────────────────────────────────────────────
console.log("\nSuite 2 — Engine call");

/** @type {import("../workflow/execution/moduleOrchestrator.js").ModuleStepResult | null} */
let stepResult = null;

await test("executeModuleStep completes without throwing", async () => {
  const store = createRuntimeArtifactStore();
  stepResult = await executeModuleStep(mockEntityRegistryModule, store, {
    sessionId:     "sess_001",
    workflowRunId: "run_001",
    accountId:     "account_test",
    rid:           "rid_phase4_test",
  });
});

await test("runClaira was called with the correct kind", () => {
  assert(
    calledKinds.includes("createTrackingEntity"),
    `expected "createTrackingEntity" in calledKinds, got [${calledKinds.join(", ")}]`,
  );
});

await test("engineResults contains one entry with the correct kind", () => {
  assert(stepResult !== null, "stepResult must not be null");
  assert(stepResult.engineResults.length === 1, "expected 1 engine result");
  assert(
    stepResult.engineResults[0].kind === "createTrackingEntity",
    `expected kind "createTrackingEntity", got "${stepResult.engineResults[0].kind}"`,
  );
});

await test("engineResults[0].result is the mock handler output", () => {
  const result = /** @type {Record<string, any>} */ (stepResult?.engineResults[0].result);
  assert(
    typeof result?.entityId === "string" && result.entityId.startsWith("entity_"),
    `expected entityId string, got ${JSON.stringify(result?.entityId)}`,
  );
  assert(
    result?.displayName === "Test Entity Alpha",
    `expected displayName "Test Entity Alpha", got "${result?.displayName}"`,
  );
});

// ── Suite 3: Artifact production ──────────────────────────────────────────
console.log("\nSuite 3 — Artifact production");

await test("producedArtifacts has exactly one artifact", () => {
  assert(stepResult !== null, "stepResult must not be null");
  assert(
    stepResult.producedArtifacts.length === 1,
    `expected 1 produced artifact, got ${stepResult.producedArtifacts.length}`,
  );
});

await test("produced artifact has correct artifactType", () => {
  const art = stepResult?.producedArtifacts[0];
  assert(art?.artifactType === "EntitySet", `expected "EntitySet", got "${art?.artifactType}"`);
});

await test("produced artifact has correct moduleId", () => {
  const art = stepResult?.producedArtifacts[0];
  assert(
    art?.moduleId === "entity_registry_mock",
    `expected "entity_registry_mock", got "${art?.moduleId}"`,
  );
});

await test("produced artifact has correct sourceKind", () => {
  const art = stepResult?.producedArtifacts[0];
  assert(
    art?.sourceKind === "createTrackingEntity",
    `expected "createTrackingEntity", got "${art?.sourceKind}"`,
  );
});

await test("produced artifact carries sessionId and workflowRunId from context", () => {
  const art = stepResult?.producedArtifacts[0];
  assert(art?.sessionId === "sess_001", `expected sessionId "sess_001", got "${art?.sessionId}"`);
  assert(art?.workflowRunId === "run_001", `expected workflowRunId "run_001", got "${art?.workflowRunId}"`);
});

await test("produced artifact has auto-generated artifactId (non-empty string)", () => {
  const art = stepResult?.producedArtifacts[0];
  assert(
    typeof art?.artifactId === "string" && art.artifactId.length > 0,
    `expected non-empty artifactId string, got ${JSON.stringify(art?.artifactId)}`,
  );
});

await test("produced artifact has a valid createdAt ISO timestamp", () => {
  const art = stepResult?.producedArtifacts[0];
  assert(
    typeof art?.createdAt === "string" && !Number.isNaN(Date.parse(art.createdAt)),
    `expected valid ISO createdAt, got ${JSON.stringify(art?.createdAt)}`,
  );
});

await test("produced artifact data contains the entity from the engine", () => {
  const data = /** @type {Record<string, any>} */ (stepResult?.producedArtifacts[0]?.data);
  assert(Array.isArray(data?.entities), "data.entities must be an array");
  assert(data.entities.length === 1, `expected 1 entity in data.entities, got ${data.entities.length}`);
  assert(
    typeof data.entities[0]?.entityId === "string",
    "data.entities[0].entityId must be a string",
  );
});

// ── Suite 4: Store persistence ────────────────────────────────────────────
console.log("\nSuite 4 — Store persistence");

await test("artifact is readable from the store after the step completes", async () => {
  // Re-run against a fresh store and verify the store independently.
  calledKinds.length = 0;
  const store2 = createRuntimeArtifactStore();

  await executeModuleStep(mockEntityRegistryModule, store2, {
    sessionId:     "sess_002",
    workflowRunId: "run_002",
  });

  const found = store2.readArtifactsByType("sess_002", "run_002", "EntitySet");
  assert(found.length === 1, `expected 1 artifact in store, got ${found.length}`);
  assert(found[0].moduleId === "entity_registry_mock", "artifact moduleId mismatch");
});

await test("artifact is NOT readable under a different sessionId", async () => {
  const store3 = createRuntimeArtifactStore();
  await executeModuleStep(mockEntityRegistryModule, store3, {
    sessionId:     "sess_isolated",
    workflowRunId: "run_isolated",
  });
  const wrong = store3.readArtifactsByType("sess_OTHER", "run_isolated", "EntitySet");
  assert(wrong.length === 0, `expected 0 artifacts for wrong sessionId, got ${wrong.length}`);
});

await test("assertArtifactsAvailable succeeds after the step writes EntitySet", async () => {
  const store4 = createRuntimeArtifactStore();
  await executeModuleStep(mockEntityRegistryModule, store4, {
    sessionId: "sess_avail", workflowRunId: "run_avail",
  });
  // Should not throw — artifact was written by the step.
  store4.assertArtifactsAvailable("sess_avail", "run_avail", ["EntitySet"]);
});

await test("assertArtifactsAvailable throws for a type that was NOT written", async () => {
  const store5 = createRuntimeArtifactStore();
  await executeModuleStep(mockEntityRegistryModule, store5, {
    sessionId: "sess_miss", workflowRunId: "run_miss",
  });
  assertThrows(
    () => store5.assertArtifactsAvailable("sess_miss", "run_miss", ["FilteredImageSet"]),
    "missing required artifact type(s)",
  );
});

// ── Suite 5: No direct pipeline access ───────────────────────────────────
console.log("\nSuite 5 — No direct pipeline access");

await test("CLAIRA_RUN_HANDLERS is not imported or referenced in moduleOrchestrator.js", async () => {
  // Read the orchestrator source and confirm it never mentions CLAIRA_RUN_HANDLERS.
  const { readFile } = await import("fs/promises");
  const src = await readFile(
    new URL("../workflow/execution/moduleOrchestrator.js", import.meta.url),
    "utf8",
  );
  assert(
    !src.includes("CLAIRA_RUN_HANDLERS"),
    "moduleOrchestrator.js must not reference CLAIRA_RUN_HANDLERS",
  );
  assert(
    !src.includes("interfaces/api"),
    "moduleOrchestrator.js must not import interfaces/api directly",
  );
  assert(
    !src.includes("photoAnalyzer"),
    "moduleOrchestrator.js must not reference photoAnalyzer",
  );
});

// =============================================================================
// Summary
// =============================================================================

console.log(`\n── Result ──────────────────────────────────────────────────────`);
console.log(`   passed: ${passed}`);
console.log(`   failed: ${failed}`);

if (failed > 0) {
  console.error(`\n   ${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log(`\n   All tests passed.`);
}

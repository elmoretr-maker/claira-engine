/**
 * Phase 5 test suite — executeWorkflow
 *
 * Validates that workflowRunner correctly:
 *   1. Executes modules in provided order.
 *   2. Shares artifact store across all steps.
 *   3. Produces a correct per-step result record.
 *   4. Stops immediately on failure (fail-fast).
 *   5. Records skipped modules after a failure.
 *   6. Returns status "ok" for a fully successful run.
 *   7. Returns status "failed" and failedAt when a module errors.
 *   8. Auto-generates workflowRunId when absent.
 *   9. Rejects empty moduleList.
 *  10. Rejects missing sessionId.
 *
 * Run with:
 *   node dev/testWorkflowRunner.mjs
 *
 * Only imports the Phase 5 runner and the mocks below — no other test
 * runner, no existing pipelines, no external HTTP.
 */

import { executeWorkflow } from "../workflow/execution/workflowRunner.js";
import { initRunClaira, _resetRunClairaForTesting } from "../server/runClaira.js";

// =============================================================================
// Minimal test harness
// =============================================================================

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      result
        .then(() => { console.log(`  ✓ ${name}`); passed++; })
        .catch((e) => { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; });
      return result;
    }
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg ?? "assertion failed");
}

async function assertThrowsAsync(fn, pattern) {
  try {
    await fn();
    throw new Error("Expected an error but none was thrown");
  } catch (e) {
    if (e.message === "Expected an error but none was thrown") throw e;
    if (pattern && !e.message.includes(pattern)) {
      throw new Error(`Expected error containing "${pattern}" but got: ${e.message}`);
    }
  }
}

// =============================================================================
// Mock engine setup
// =============================================================================

// Two kinds simulating the engine:
//   "entity.register"  — creates an EntitySet from a list of names
//   "snapshot.create"  — creates a SnapshotSet from an EntitySet artifact

const MOCK_HANDLER_MAP = {
  "entity.register": async (payload) => ({
    entities: (payload.names ?? []).map((n) => ({ id: `eid_${n}`, name: n })),
  }),
  "snapshot.create": async (payload) => ({
    snapshot: {
      entityIds: (payload.entitySet?.entities ?? []).map((e) => e.id),
      takenAt:   new Date().toISOString(),
    },
  }),
};

// =============================================================================
// Mock modules
// =============================================================================

// Shared base fields required by assertModuleFollowsContract.
// All mock modules spread this to satisfy the full contract shape without
// duplicating boilerplate. Real modules would define each field meaningfully.
const BASE_MODULE_FIELDS = {
  label:                  "Mock module",
  description:            "Test-only mock — not for production use.",
  capabilities:           ["mock_capability"],
  modulePipelineType:     "processing",
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
};

/**
 * Module A: no consumes → produces entity artifacts.
 *
 * consumes/produces must use the registered ARTIFACT_KINDS vocabulary
 * ("entity", "event", "asset", "analysis", "aggregate", "deliverable", "ui_model").
 * produces is an array of { kind, mode } objects.
 */
const mockEntityModule = {
  ...BASE_MODULE_FIELDS,
  id:          "mock.entity_registry",
  engineKinds: ["entity.register"],
  consumes:    [],
  produces:    [{ kind: "entity", mode: "create" }],

  buildPayload(_consumedArtifacts, _ctx) {
    return { names: ["boots", "sneakers", "loafers"] };
  },

  normalizeToArtifacts(engineResults, _ctx) {
    const entities = engineResults[0]?.result?.entities ?? [];
    return [
      {
        artifactType:    "entity",
        artifactVersion: 1,
        moduleId:        "mock.entity_registry",
        sourceKind:      "entity.register",
        data:            { entities },
      },
    ];
  },
};

/**
 * Module B: consumes entity → produces analysis artifact.
 *
 * Reads the entity artifact written by Module A to build its snapshot payload.
 */
const mockSnapshotModule = {
  ...BASE_MODULE_FIELDS,
  id:          "mock.snapshot_creator",
  engineKinds: ["snapshot.create"],
  consumes:    ["entity"],
  produces:    [{ kind: "analysis", mode: "create" }],

  buildPayload(consumedArtifacts, _ctx) {
    const entitySet = consumedArtifacts["entity"]?.[0]?.data ?? { entities: [] };
    return { entitySet };
  },

  normalizeToArtifacts(engineResults, _ctx) {
    const snapshot = engineResults[0]?.result?.snapshot ?? {};
    return [
      {
        artifactType:    "analysis",
        artifactVersion: 1,
        moduleId:        "mock.snapshot_creator",
        sourceKind:      "snapshot.create",
        data:            { snapshot },
      },
    ];
  },
};

/**
 * Module that always throws — simulates a normalizeToArtifacts failure.
 */
const mockFailingModule = {
  ...BASE_MODULE_FIELDS,
  id:          "mock.always_fails",
  engineKinds: ["entity.register"],
  consumes:    [],
  produces:    [{ kind: "entity", mode: "create" }],

  buildPayload() {
    return {};
  },

  normalizeToArtifacts() {
    throw new Error("intentional failure in normalizeToArtifacts");
  },
};

/**
 * Module with no engineKinds — invalid, caught by assertEngineContract.
 */
const mockBadModule = {
  ...BASE_MODULE_FIELDS,
  id:       "mock.no_engine_kinds",
  consumes: [],
  produces: [],
  buildPayload:         () => ({}),
  normalizeToArtifacts: () => [],
  // engineKinds intentionally absent
};

// =============================================================================
// Tests
// =============================================================================

const BASE_CTX = {
  sessionId:     "sess_test_01",
  workflowRunId: "wrun_test_01",
  accountId:     "acct_demo",
};

console.log("\n── Phase 5: executeWorkflow ─────────────────────────────────────────────\n");

// Init engine
initRunClaira(MOCK_HANDLER_MAP);

// ── Group 1: happy path — two-step chain ──────────────────────────────────

console.log("Group 1: two-step chain (entity.register → snapshot.create)");

await test("returns status ok for two successful modules", async () => {
  const result = await executeWorkflow([mockEntityModule, mockSnapshotModule], BASE_CTX);
  assert(result.status === "ok", `expected status=ok, got ${result.status}`);
  return result;
});

await test("returns exactly 2 step records", async () => {
  const result = await executeWorkflow([mockEntityModule, mockSnapshotModule], BASE_CTX);
  assert(result.steps.length === 2, `expected 2 steps, got ${result.steps.length}`);
});

await test("step 1 status is ok and produced entity artifact", async () => {
  const result = await executeWorkflow([mockEntityModule, mockSnapshotModule], BASE_CTX);
  const s1 = result.steps[0];
  assert(s1.status === "ok", `step 1 status=${s1.status}`);
  assert(s1.producedArtifacts.length === 1, "step 1 should produce 1 artifact");
  assert(s1.producedArtifacts[0].artifactType === "entity", "step 1 artifact should be entity");
});

await test("step 2 status is ok and produced analysis artifact", async () => {
  const result = await executeWorkflow([mockEntityModule, mockSnapshotModule], BASE_CTX);
  const s2 = result.steps[1];
  assert(s2.status === "ok", `step 2 status=${s2.status}`);
  assert(s2.producedArtifacts.length === 1, "step 2 should produce 1 artifact");
  assert(s2.producedArtifacts[0].artifactType === "analysis", "step 2 artifact should be analysis");
});

await test("step 2 snapshot contains entity IDs from step 1", async () => {
  const result = await executeWorkflow([mockEntityModule, mockSnapshotModule], BASE_CTX);
  const snapshot = result.steps[1].producedArtifacts[0].data.snapshot;
  assert(
    Array.isArray(snapshot.entityIds) && snapshot.entityIds.length === 3,
    `expected 3 entityIds, got ${JSON.stringify(snapshot.entityIds)}`,
  );
  assert(snapshot.entityIds.includes("eid_boots"), "snapshot should contain eid_boots");
});

await test("artifact store contains both artifact types after run", async () => {
  const result = await executeWorkflow([mockEntityModule, mockSnapshotModule], BASE_CTX);
  const { sessionId, workflowRunId, artifactStore } = result;
  const entitySets  = artifactStore.readArtifactsByType(sessionId, workflowRunId, "entity");
  const snapshots   = artifactStore.readArtifactsByType(sessionId, workflowRunId, "analysis");
  assert(entitySets.length === 1, "store should have 1 entity artifact");
  assert(snapshots.length === 1,  "store should have 1 analysis artifact");
});

await test("failedAt is null for a successful run", async () => {
  const result = await executeWorkflow([mockEntityModule, mockSnapshotModule], BASE_CTX);
  assert(result.failedAt === null, `expected failedAt=null, got ${result.failedAt}`);
});

await test("durationMs is a non-negative number for each step", async () => {
  const result = await executeWorkflow([mockEntityModule, mockSnapshotModule], BASE_CTX);
  for (const step of result.steps) {
    assert(
      typeof step.durationMs === "number" && step.durationMs >= 0,
      `step ${step.moduleId} durationMs=${step.durationMs}`,
    );
  }
});

// ── Group 2: fail-fast behaviour ──────────────────────────────────────────

console.log("\nGroup 2: fail-fast behaviour");

await test("status is failed when first module throws", async () => {
  const result = await executeWorkflow([mockFailingModule, mockSnapshotModule], BASE_CTX);
  assert(result.status === "failed", `expected status=failed, got ${result.status}`);
});

await test("failedAt is set to the failing step ID (moduleId__stepIndex)", async () => {
  const result = await executeWorkflow([mockFailingModule, mockSnapshotModule], BASE_CTX);
  // failedAt is now a stepId ("mock.always_fails__0"), not just the moduleId.
  assert(
    result.failedAt === "mock.always_fails__0",
    `expected failedAt=mock.always_fails__0, got ${result.failedAt}`,
  );
});

await test("failed step records error message", async () => {
  const result = await executeWorkflow([mockFailingModule, mockSnapshotModule], BASE_CTX);
  const failedStep = result.steps.find((s) => s.status === "failed");
  assert(failedStep !== undefined, "no failed step found");
  assert(
    typeof failedStep.error === "string" && failedStep.error.length > 0,
    "failed step should have a non-empty error string",
  );
});

await test("module after failed module is marked skipped", async () => {
  const result = await executeWorkflow([mockFailingModule, mockSnapshotModule], BASE_CTX);
  const skipped = result.steps.find((s) => s.status === "skipped");
  assert(skipped !== undefined, "expected a skipped step after failure");
  assert(skipped.moduleId === "mock.snapshot_creator", `expected skipped=mock.snapshot_creator, got ${skipped?.moduleId}`);
});

await test("skipped step has empty producedArtifacts and engineResults", async () => {
  const result = await executeWorkflow([mockFailingModule, mockSnapshotModule], BASE_CTX);
  const skipped = result.steps.find((s) => s.status === "skipped");
  assert(skipped !== undefined, "no skipped step");
  assert(skipped.producedArtifacts.length === 0, "skipped step should have no artifacts");
  assert(skipped.engineResults.length === 0, "skipped step should have no engine results");
});

await test("all three modules recorded when middle one fails", async () => {
  const result = await executeWorkflow(
    [mockEntityModule, mockFailingModule, mockSnapshotModule],
    BASE_CTX,
  );
  assert(result.steps.length === 3, `expected 3 steps, got ${result.steps.length}`);
  assert(result.steps[0].status === "ok",      "step 0 should be ok");
  assert(result.steps[1].status === "failed",  "step 1 should be failed");
  assert(result.steps[2].status === "skipped", "step 2 should be skipped");
});

// ── Group 3: contract guard inside executeWorkflow ─────────────────────────
//
// executeWorkflow does not throw for invalid modules — it catches the error
// from assertEngineContract inside executeModuleStep, records a failed step,
// and returns status "failed". Callers decide whether to re-throw.

console.log("\nGroup 3: contract guard (invalid module in list)");

await test("status is failed when module is missing engineKinds", async () => {
  const result = await executeWorkflow([mockBadModule], BASE_CTX);
  assert(result.status === "failed", `expected status=failed, got ${result.status}`);
  // expandToSteps catches this before any steps run; failedAt is null (no stepId assigned yet).
  assert(result.failedAt === null, `expected failedAt=null (pre-expansion failure), got ${result.failedAt}`);
  assert(result.steps.length === 0, "no steps should have been recorded");
});

// ── Group 4: context validation ───────────────────────────────────────────

console.log("\nGroup 4: context validation");

await test("throws when sessionId is missing", async () => {
  await assertThrowsAsync(
    () => executeWorkflow([mockEntityModule], { workflowRunId: "wrun_x" }),
    "sessionId",
  );
});

await test("throws when moduleList is not an array", async () => {
  await assertThrowsAsync(
    () => executeWorkflow(null, BASE_CTX),
    "moduleList",
  );
});

await test("throws when moduleList is empty", async () => {
  await assertThrowsAsync(
    () => executeWorkflow([], BASE_CTX),
    "empty",
  );
});

// ── Group 5: workflowRunId auto-generation ────────────────────────────────

console.log("\nGroup 5: workflowRunId auto-generation");

await test("auto-generates workflowRunId when absent", async () => {
  const result = await executeWorkflow(
    [mockEntityModule],
    { sessionId: "sess_autoid", accountId: "acct_demo" },
  );
  assert(result.status === "ok", `expected ok, got ${result.status}`);
  assert(
    typeof result.workflowRunId === "string" && result.workflowRunId.startsWith("run_"),
    `expected auto-generated runId starting with run_, got ${result.workflowRunId}`,
  );
});

await test("auto-generated runId is used in produced artifact metadata", async () => {
  const result = await executeWorkflow(
    [mockEntityModule],
    { sessionId: "sess_autoid2", accountId: "acct_demo" },
  );
  const artifact = result.steps[0].producedArtifacts[0];
  assert(
    artifact.workflowRunId === result.workflowRunId,
    `artifact.workflowRunId=${artifact.workflowRunId} !== result.workflowRunId=${result.workflowRunId}`,
  );
});

// ── Group 6: isolation — no shared state across runs ──────────────────────

console.log("\nGroup 6: run isolation (separate artifact stores)");

await test("two concurrent runs do not share artifact stores", async () => {
  const [r1, r2] = await Promise.all([
    executeWorkflow([mockEntityModule], { sessionId: "sess_iso_1", workflowRunId: "iso_run_1" }),
    executeWorkflow([mockEntityModule], { sessionId: "sess_iso_2", workflowRunId: "iso_run_2" }),
  ]);
  // Each store must only hold its own run's artifacts.
  const r1InStore2 = r2.artifactStore.readArtifactsByType("sess_iso_1", "iso_run_1", "EntitySet");
  const r2InStore1 = r1.artifactStore.readArtifactsByType("sess_iso_2", "iso_run_2", "EntitySet");
  assert(r1InStore2.length === 0, "store 2 must not contain store 1 artifacts");
  assert(r2InStore1.length === 0, "store 1 must not contain store 2 artifacts");
});

// =============================================================================
// Summary
// =============================================================================

// Give async tests a tick to settle
await new Promise((r) => setTimeout(r, 50));

const total = passed + failed;
console.log(`\n── Result: ${passed}/${total} passed${failed > 0 ? ` (${failed} FAILED)` : ""} ──\n`);

if (failed > 0) process.exit(1);

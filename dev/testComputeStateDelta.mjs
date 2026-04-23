/**
 * Tests for the computeStateDelta engine capability.
 *
 * Calls the pure function from server/handlers/computeStateDelta.js directly —
 * no server initialization required. This is the correct test pattern for pure
 * engine handler functions that do not require the `api` parameter.
 *
 * The same function is registered in CLAIRA_RUN_HANDLERS as:
 *   computeStateDelta: (body) => computeStateDeltaHandler(body)
 *
 * Run: node dev/testComputeStateDelta.mjs
 */

import { computeStateDelta } from "../server/handlers/computeStateDelta.js";
import { normalizeRunRequestBody, operationArgsFromRunBody } from "../server/runClaira.js";

let passed = 0;
let failed = 0;

/**
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 */
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

/** @param {boolean} cond @param {string} [msg] */
function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? "assertion failed");
}

/** @param {number} a @param {number} b @param {string} [msg] */
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg ?? "assertEqual"}: expected ${b}, got ${a}`);
}

console.log("\n── computeStateDelta — Engine Handler Tests ──────────────────────────────\n");

// ── Test 1: Multiple entities, correct deltas ────────────────────────────────

await test("multiple entities — computes correct deltas for each", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "shoe-A", value: 100, timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "shoe-A", value: 85,  timestamp: "2024-01-31T00:00:00Z" },
      { entityId: "shoe-B", value: 50,  timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "shoe-B", value: 60,  timestamp: "2024-01-31T00:00:00Z" },
    ],
    deliveryEvents: [
      { entityId: "shoe-A", quantity: 20, timestamp: "2024-01-10T00:00:00Z", eventType: "delivery" },
      { entityId: "shoe-B", quantity: 15, timestamp: "2024-01-12T00:00:00Z", eventType: "delivery" },
    ],
    saleEvents: [
      { entityId: "shoe-A", quantity: 35, timestamp: "2024-01-15T00:00:00Z", eventType: "sale" },
      { entityId: "shoe-B", quantity: 5,  timestamp: "2024-01-20T00:00:00Z", eventType: "sale" },
    ],
  });

  assert(Array.isArray(result.deltas), "deltas must be an array");
  assertEqual(result.deltas.length, 2, "deltas.length");

  const a = result.deltas.find(d => d.entityId === "shoe-A");
  const b = result.deltas.find(d => d.entityId === "shoe-B");

  assert(a != null, "delta for shoe-A must exist");
  assertEqual(a.startValue,    100, "shoe-A startValue");
  assertEqual(a.endValue,      85,  "shoe-A endValue");
  assertEqual(a.netDelta,      -15, "shoe-A netDelta");
  assertEqual(a.deliveryTotal, 20,  "shoe-A deliveryTotal");
  assertEqual(a.salesTotal,    35,  "shoe-A salesTotal");

  assert(b != null, "delta for shoe-B must exist");
  assertEqual(b.startValue,    50,  "shoe-B startValue");
  assertEqual(b.endValue,      60,  "shoe-B endValue");
  assertEqual(b.netDelta,      10,  "shoe-B netDelta");
  assertEqual(b.deliveryTotal, 15,  "shoe-B deliveryTotal");
  assertEqual(b.salesTotal,    5,   "shoe-B salesTotal");
});

// ── Test 2: No events — defaults to 0 ───────────────────────────────────────

await test("no events — deliveryTotal and salesTotal default to 0", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "boot-X", value: 200, timestamp: "2024-02-01T00:00:00Z" },
      { entityId: "boot-X", value: 180, timestamp: "2024-02-28T00:00:00Z" },
    ],
    deliveryEvents: [],
    saleEvents: [],
  });

  assert(Array.isArray(result.deltas), "deltas is array");
  assertEqual(result.deltas.length, 1, "one delta");

  const d = result.deltas[0];
  assertEqual(d.entityId,      "boot-X", "entityId");
  assertEqual(d.startValue,    200,      "startValue");
  assertEqual(d.endValue,      180,      "endValue");
  assertEqual(d.netDelta,      -20,      "netDelta");
  assertEqual(d.deliveryTotal, 0,        "deliveryTotal");
  assertEqual(d.salesTotal,    0,        "salesTotal");
});

await test("missing event arrays — treated as empty gracefully", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "sandal-1", value: 30, timestamp: "2024-03-01T00:00:00Z" },
      { entityId: "sandal-1", value: 25, timestamp: "2024-03-15T00:00:00Z" },
    ],
    // deliveryEvents and saleEvents intentionally omitted
  });

  assert(Array.isArray(result.deltas), "deltas is array");
  assertEqual(result.deltas.length, 1, "one delta");
  assertEqual(result.deltas[0].deliveryTotal, 0, "deliveryTotal defaults to 0");
  assertEqual(result.deltas[0].salesTotal,    0, "salesTotal defaults to 0");
});

// ── Test 3: Mixed delivery and sales — totals summed correctly ───────────────

await test("mixed delivery and sales — totals summed correctly per entity", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "sneaker-Z", value: 50, timestamp: "2024-04-01T00:00:00Z" },
      { entityId: "sneaker-Z", value: 40, timestamp: "2024-04-30T00:00:00Z" },
    ],
    deliveryEvents: [
      { entityId: "sneaker-Z", quantity: 10, timestamp: "2024-04-05T00:00:00Z", eventType: "delivery" },
      { entityId: "sneaker-Z", quantity: 5,  timestamp: "2024-04-20T00:00:00Z", eventType: "delivery" },
    ],
    saleEvents: [
      { entityId: "sneaker-Z", quantity: 8,  timestamp: "2024-04-10T00:00:00Z", eventType: "sale" },
      { entityId: "sneaker-Z", quantity: 17, timestamp: "2024-04-25T00:00:00Z", eventType: "sale" },
    ],
  });

  const d = result.deltas[0];
  assertEqual(d.deliveryTotal, 15,  "deliveryTotal = 10 + 5");
  assertEqual(d.salesTotal,    25,  "salesTotal = 8 + 17");
  assertEqual(d.netDelta,      -10, "netDelta = 40 - 50");
});

// ── Test 4: Unordered timestamps — sorted correctly ──────────────────────────

await test("unordered snapshots — sorted by timestamp before computing", async () => {
  const result = computeStateDelta({
    snapshots: [
      // Deliberately out of order: latest snapshot first
      { entityId: "loafer-Q", value: 70, timestamp: "2024-05-31T00:00:00Z" },
      { entityId: "loafer-Q", value: 90, timestamp: "2024-05-01T00:00:00Z" },
      { entityId: "loafer-Q", value: 80, timestamp: "2024-05-15T00:00:00Z" },
    ],
    deliveryEvents: [],
    saleEvents: [],
  });

  const d = result.deltas[0];
  // After sort: 90 @ May 01 → 80 @ May 15 → 70 @ May 31
  assertEqual(d.startValue, 90,  "startValue is earliest (90)");
  assertEqual(d.endValue,   70,  "endValue is latest (70)");
  assertEqual(d.netDelta,   -20, "netDelta = 70 - 90");
});

// ── Test 5: Missing snapshot edge case — entity skipped ───────────────────────

await test("entity with only 1 snapshot — skipped (insufficient baseline)", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "flip-flop-1", value: 100, timestamp: "2024-06-01T00:00:00Z" },
    ],
    deliveryEvents: [
      { entityId: "flip-flop-1", quantity: 20, timestamp: "2024-06-10T00:00:00Z", eventType: "delivery" },
    ],
    saleEvents: [],
  });

  assert(Array.isArray(result.deltas), "deltas is array");
  assertEqual(result.deltas.length, 0, "entity with 1 snapshot produces no delta");
  assert(
    result.insufficientSnapshotEntities.includes("flip-flop-1"),
    "flip-flop-1 listed as insufficient snapshots",
  );
});

await test("empty snapshots array — returns empty deltas", async () => {
  const result = computeStateDelta({
    snapshots: [],
    deliveryEvents: [],
    saleEvents: [],
  });

  assert(Array.isArray(result.deltas), "deltas is array");
  assertEqual(result.deltas.length, 0, "no snapshots → no deltas");
});

await test("mixed: some entities have 1 snapshot, some have 2+ — only 2+ included", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "include-me", value: 10, timestamp: "2024-06-01T00:00:00Z" },
      { entityId: "include-me", value: 20, timestamp: "2024-06-30T00:00:00Z" },
      { entityId: "skip-me",    value: 50, timestamp: "2024-06-01T00:00:00Z" }, // only 1 snapshot
    ],
    deliveryEvents: [],
    saleEvents: [],
  });

  assertEqual(result.deltas.length, 1, "only entity with 2+ snapshots appears");
  assertEqual(result.deltas[0].entityId, "include-me", "correct entity in result");
  assert(
    result.insufficientSnapshotEntities.includes("skip-me"),
    "skip-me listed when only one snapshot",
  );
});

// ── Test 6: Input immutability ────────────────────────────────────────────────

await test("input snapshots array is not mutated", async () => {
  const snapshots = [
    { entityId: "clog-P", value: 40, timestamp: "2024-07-15T00:00:00Z" }, // out of order
    { entityId: "clog-P", value: 20, timestamp: "2024-07-01T00:00:00Z" },
  ];
  const before = snapshots.map(s => s.timestamp);

  computeStateDelta({ snapshots, deliveryEvents: [], saleEvents: [] });

  const after = snapshots.map(s => s.timestamp);
  assert(
    before[0] === after[0] && before[1] === after[1],
    "input snapshots array was mutated in place",
  );
});

// ── Test 7: Validation — invalid snapshots ────────────────────────────────────

await test("non-array snapshots coerces to empty deltas (no throw)", async () => {
  const result = computeStateDelta({
    snapshots: "not-an-array",
    deliveryEvents: [],
    saleEvents: [],
  });
  assert(Array.isArray(result.deltas), "deltas is array");
  assertEqual(result.deltas.length, 0, "no deltas");
  assert(Array.isArray(result.insufficientSnapshotEntities), "insufficientSnapshotEntities present");
});

await test("null snapshots coerces to empty deltas (no throw)", async () => {
  const result = computeStateDelta({ snapshots: null });
  assertEqual(result.deltas.length, 0, "no deltas");
});

// ── Test 8: Events isolated per entity ───────────────────────────────────────

await test("events for other entities do not contaminate entity totals", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "mule-A", value: 60, timestamp: "2024-08-01T00:00:00Z" },
      { entityId: "mule-A", value: 55, timestamp: "2024-08-31T00:00:00Z" },
      { entityId: "mule-B", value: 30, timestamp: "2024-08-01T00:00:00Z" },
      { entityId: "mule-B", value: 35, timestamp: "2024-08-31T00:00:00Z" },
    ],
    deliveryEvents: [
      { entityId: "mule-A", quantity: 5,  timestamp: "2024-08-10T00:00:00Z", eventType: "delivery" },
      { entityId: "mule-B", quantity: 10, timestamp: "2024-08-12T00:00:00Z", eventType: "delivery" },
    ],
    saleEvents: [
      { entityId: "mule-A", quantity: 10, timestamp: "2024-08-20T00:00:00Z", eventType: "sale" },
      { entityId: "mule-B", quantity: 5,  timestamp: "2024-08-22T00:00:00Z", eventType: "sale" },
    ],
  });

  const a = result.deltas.find(d => d.entityId === "mule-A");
  const b = result.deltas.find(d => d.entityId === "mule-B");

  assertEqual(a.deliveryTotal, 5,  "mule-A deliveryTotal excludes mule-B events");
  assertEqual(a.salesTotal,    10, "mule-A salesTotal excludes mule-B events");
  assertEqual(b.deliveryTotal, 10, "mule-B deliveryTotal excludes mule-A events");
  assertEqual(b.salesTotal,    5,  "mule-B salesTotal excludes mule-A events");
});

// ── Test 9: Positive netDelta (restocking scenario) ───────────────────────────

await test("positive netDelta — restocking scenario", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "oxford-1", value: 10, timestamp: "2024-09-01T00:00:00Z" },
      { entityId: "oxford-1", value: 50, timestamp: "2024-09-30T00:00:00Z" },
    ],
    deliveryEvents: [
      { entityId: "oxford-1", quantity: 45, timestamp: "2024-09-15T00:00:00Z", eventType: "delivery" },
    ],
    saleEvents: [
      { entityId: "oxford-1", quantity: 5, timestamp: "2024-09-20T00:00:00Z", eventType: "sale" },
    ],
  });

  const d = result.deltas[0];
  assertEqual(d.startValue,    10, "startValue");
  assertEqual(d.endValue,      50, "endValue");
  assertEqual(d.netDelta,      40, "netDelta = 50 - 10 = 40 (positive)");
  assertEqual(d.deliveryTotal, 45, "deliveryTotal");
  assertEqual(d.salesTotal,    5,  "salesTotal");
});

// ── Test 10: Zero netDelta (stable) ──────────────────────────────────────────

await test("zero netDelta — stable entity", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "heel-S", value: 75, timestamp: "2024-10-01T00:00:00Z" },
      { entityId: "heel-S", value: 75, timestamp: "2024-10-31T00:00:00Z" },
    ],
    deliveryEvents: [],
    saleEvents: [],
  });

  assertEqual(result.deltas[0].netDelta, 0, "netDelta = 0 for stable entity");
});

// ── Test 11: Entities with no events in arrays still compute ──────────────────

await test("events arrays present but no entries for an entity — defaults to 0 totals", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "pump-C", value: 55, timestamp: "2024-11-01T00:00:00Z" },
      { entityId: "pump-C", value: 45, timestamp: "2024-11-30T00:00:00Z" },
    ],
    // Non-empty arrays, but no entries for pump-C
    deliveryEvents: [{ entityId: "other-entity", quantity: 99, timestamp: "2024-11-10T00:00:00Z", eventType: "delivery" }],
    saleEvents:     [{ entityId: "other-entity", quantity: 50, timestamp: "2024-11-20T00:00:00Z", eventType: "sale" }],
  });

  const d = result.deltas[0];
  assertEqual(d.entityId,      "pump-C", "entityId");
  assertEqual(d.deliveryTotal, 0,        "deliveryTotal = 0 (no events for this entity)");
  assertEqual(d.salesTotal,    0,        "salesTotal = 0 (no events for this entity)");
});

// ── runClaira request normalization (used by POST /__claira/run) ───────────────

await test("normalizeRunRequestBody unwraps nested payload", async () => {
  const n = normalizeRunRequestBody({
    kind: "computeStateDelta",
    accountId: "a1",
    payload: {
      snapshots: [{ entityId: "x", value: 1, timestamp: "2024-01-01" }],
      saleEvents: [],
    },
  });
  assertEqual(n.kind, "computeStateDelta");
  assertEqual(n.accountId, "a1");
  assert(Array.isArray(n.snapshots));
  assertEqual(n.snapshots.length, 1);
  assert(n.payload === undefined, "nested payload flattened");
});

await test("operationArgsFromRunBody strips transport keys for ingest-style handlers", async () => {
  const o = operationArgsFromRunBody({
    kind: "ingestData",
    cwd: "/tmp",
    source: "file",
    input: "/data",
  });
  assertEqual(o.source, "file");
  assertEqual(o.input, "/data");
  assert(o.kind === undefined);
  assert(o.cwd === undefined);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────────────────────────────────────────────────`);
console.log(`  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);

if (failed > 0) {
  console.error("\nSome assertions failed — review implementation above.");
  process.exit(1);
} else {
  console.log("\nAll computeStateDelta tests pass. ✅");
}

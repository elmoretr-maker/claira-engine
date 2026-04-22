/**
 * Tests for the interpretTrends engine capability.
 *
 * Calls the pure function from server/handlers/interpretTrends.js directly —
 * no server initialization required. Same pattern as testComputeStateDelta.mjs.
 *
 * The same function is registered in CLAIRA_RUN_HANDLERS as:
 *   interpretTrends: (body) => interpretTrendsHandler(body)
 *
 * Run: node dev/testInterpretTrends.mjs
 */

import { interpretTrends } from "../server/handlers/interpretTrends.js";

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

/** @param {unknown} a @param {unknown} b @param {string} [msg] */
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg ?? "assertEqual"}: expected ${String(b)}, got ${String(a)}`);
}

console.log("\n── interpretTrends — Engine Handler Tests ────────────────────────────────\n");

// ── Test 1: Positive netDelta → "up" ─────────────────────────────────────────

await test('positive netDelta → direction "up"', async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "shoe-A", startValue: 10, endValue: 50, netDelta: 40, deliveryTotal: 45, salesTotal: 5 }],
  });

  assert(Array.isArray(result.trends), "trends must be array");
  assertEqual(result.trends.length, 1, "trends.length");

  const t = result.trends[0];
  assertEqual(t.entityId,  "shoe-A", "entityId");
  assertEqual(t.direction, "up",     "direction");
  assertEqual(t.velocity,  40,       "velocity = abs(40)");
  assert(typeof t.periodCount === "number" && t.periodCount >= 2, "periodCount is a number >= 2");
});

// ── Test 2: Negative netDelta → "down" ──────────────────────────────────────

await test('negative netDelta → direction "down"', async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "boot-X", startValue: 100, endValue: 70, netDelta: -30, deliveryTotal: 0, salesTotal: 30 }],
  });

  const t = result.trends[0];
  assertEqual(t.direction, "down", "direction");
  assertEqual(t.velocity,  30,    "velocity = abs(-30)");
});

// ── Test 3: Zero netDelta → "flat" ──────────────────────────────────────────

await test('zero netDelta → direction "flat"', async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "sandal-Z", startValue: 75, endValue: 75, netDelta: 0, deliveryTotal: 5, salesTotal: 5 }],
  });

  const t = result.trends[0];
  assertEqual(t.direction, "flat", "direction");
  assertEqual(t.velocity,  0,     "velocity = abs(0) = 0");
});

// ── Test 4: Multiple entities — all processed independently ─────────────────

await test("multiple entities — each interpreted independently", async () => {
  const result = interpretTrends({
    deltas: [
      { entityId: "A", startValue: 10, endValue: 20, netDelta: 10,  deliveryTotal: 10, salesTotal: 0 },
      { entityId: "B", startValue: 20, endValue: 15, netDelta: -5,  deliveryTotal: 0,  salesTotal: 5 },
      { entityId: "C", startValue: 30, endValue: 30, netDelta: 0,   deliveryTotal: 5,  salesTotal: 5 },
    ],
  });

  assertEqual(result.trends.length, 3, "three trends produced");

  const a = result.trends.find((t) => t.entityId === "A");
  const b = result.trends.find((t) => t.entityId === "B");
  const c = result.trends.find((t) => t.entityId === "C");

  assertEqual(a?.direction, "up",   "A → up");
  assertEqual(b?.direction, "down", "B → down");
  assertEqual(c?.direction, "flat", "C → flat");

  assertEqual(a?.velocity, 10, "A velocity = 10");
  assertEqual(b?.velocity, 5,  "B velocity = 5");
  assertEqual(c?.velocity, 0,  "C velocity = 0");
});

// ── Test 5: Empty deltas array → empty trends ────────────────────────────────

await test("empty deltas → returns empty trends", async () => {
  const result = interpretTrends({ deltas: [] });

  assert(Array.isArray(result.trends), "trends is array");
  assertEqual(result.trends.length, 0, "no trends for empty deltas");
});

// ── Test 6: periodCount pass-through ────────────────────────────────────────

await test("periodCount passed through from delta when present", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "loafer-Q", netDelta: 5, periodCount: 7, deliveryTotal: 0, salesTotal: 0 }],
  });

  const t = result.trends[0];
  assertEqual(t.periodCount, 7, "periodCount passed through from delta");
});

await test("periodCount defaults to 2 when absent from delta", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "mule-P", netDelta: -3, deliveryTotal: 0, salesTotal: 0 }],
  });

  const t = result.trends[0];
  assertEqual(t.periodCount, 2, "periodCount defaults to 2 when not provided");
});

// ── Test 7: Malformed individual entries — skipped gracefully ────────────────

await test("null entry in deltas array — skipped, others processed", async () => {
  const result = interpretTrends({
    deltas: [
      null,
      { entityId: "valid-1", netDelta: 10, deliveryTotal: 0, salesTotal: 0 },
      undefined,
    ],
  });

  assertEqual(result.trends.length, 1, "only valid entry produces a trend");
  assertEqual(result.trends[0].entityId, "valid-1", "valid entry processed correctly");
});

await test("entry with empty entityId — skipped", async () => {
  const result = interpretTrends({
    deltas: [
      { entityId: "",    netDelta: 10, deliveryTotal: 0, salesTotal: 0 },
      { entityId: "   ", netDelta: -5, deliveryTotal: 0, salesTotal: 0 },
      { entityId: "ok",  netDelta: 3,  deliveryTotal: 0, salesTotal: 0 },
    ],
  });

  assertEqual(result.trends.length, 1, "only entity with non-empty id processed");
  assertEqual(result.trends[0].entityId, "ok", "valid entity retained");
});

await test("entry with non-finite netDelta — skipped", async () => {
  const result = interpretTrends({
    deltas: [
      { entityId: "bad-delta",   netDelta: NaN,      deliveryTotal: 0, salesTotal: 0 },
      { entityId: "inf-delta",   netDelta: Infinity,  deliveryTotal: 0, salesTotal: 0 },
      { entityId: "good-delta",  netDelta: 5,         deliveryTotal: 0, salesTotal: 0 },
    ],
  });

  assertEqual(result.trends.length, 1, "only finite netDelta entry processed");
  assertEqual(result.trends[0].entityId, "good-delta", "good entity retained");
});

// ── Test 8: Malformed body — throws clearly ──────────────────────────────────

await test("throws when deltas is not an array", async () => {
  try {
    interpretTrends({ deltas: "not-an-array" });
    throw new Error("should have thrown");
  } catch (e) {
    assert(
      String(e).includes("deltas must be an array"),
      `expected clear error, got: ${e}`,
    );
  }
});

await test("throws when deltas is null", async () => {
  try {
    interpretTrends({ deltas: null });
    throw new Error("should have thrown");
  } catch (e) {
    assert(
      String(e).includes("deltas must be an array"),
      `expected clear error, got: ${e}`,
    );
  }
});

await test("throws when body is not an object", async () => {
  try {
    interpretTrends(null);
    throw new Error("should have thrown");
  } catch (e) {
    assert(
      String(e).includes("body must be an object"),
      `expected clear error, got: ${e}`,
    );
  }
});

// ── Test 9: Large velocity — not clamped ─────────────────────────────────────

await test("large magnitude netDelta — velocity is exact abs value", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "mega-item", netDelta: -9999, deliveryTotal: 0, salesTotal: 0 }],
  });

  const t = result.trends[0];
  assertEqual(t.direction, "down", "direction");
  assertEqual(t.velocity, 9999,    "velocity = abs(-9999)");
});

// ── Test 10: Output immutability — input not mutated ─────────────────────────

await test("input deltas array is not mutated", async () => {
  const deltas = [
    { entityId: "pump-C", netDelta: -10, deliveryTotal: 0, salesTotal: 0 },
    { entityId: "pump-D", netDelta: 5,   deliveryTotal: 0, salesTotal: 0 },
  ];
  const originalIds = deltas.map((d) => d.entityId);

  interpretTrends({ deltas });

  const afterIds = deltas.map((d) => d.entityId);
  assert(
    originalIds[0] === afterIds[0] && originalIds[1] === afterIds[1],
    "input deltas array was mutated",
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────────────────────────────────────────────────`);
console.log(`  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);

if (failed > 0) {
  console.error("\nSome assertions failed — review implementation above.");
  process.exit(1);
} else {
  console.log("\nAll interpretTrends tests pass. ✅");
}

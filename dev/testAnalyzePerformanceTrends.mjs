/**
 * Tests for the analyzePerformanceTrends engine capability.
 *
 * Calls the pure function from server/handlers/analyzePerformanceTrends.js directly —
 * no server initialization required. Same pattern as testInterpretTrends.mjs.
 *
 * The same function is registered in CLAIRA_RUN_HANDLERS as:
 *   analyzePerformanceTrends: (body) => analyzePerformanceTrendsHandler(body)
 *
 * Run: node dev/testAnalyzePerformanceTrends.mjs
 */

import { analyzePerformanceTrends } from "../server/handlers/analyzePerformanceTrends.js";

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

const SAMPLE_TRENDS = [
  { entityId: "shoe-A", direction: "down", velocity: 15, periodCount: 2, netDelta: -15, salesTotal: 35 },
  { entityId: "shoe-B", direction: "up",   velocity: 10, periodCount: 2, netDelta: 10,  salesTotal: 5  },
  { entityId: "boot-C", direction: "up",   velocity: 40, periodCount: 2, netDelta: 40,  salesTotal: 20 },
];

console.log("\n── analyzePerformanceTrends — Engine Handler Tests ──────────────────────\n");

// ── Test 1: rankBy velocity — default ────────────────────────────────────────

await test('rankBy "velocity" — orders by velocity descending', async () => {
  const result = analyzePerformanceTrends({ trends: SAMPLE_TRENDS, rankBy: "velocity" });

  assert(Array.isArray(result.entities), "entities is array");
  assertEqual(result.entities.length, 3, "three entities");

  // boot-C velocity=40, shoe-A velocity=15, shoe-B velocity=10
  assertEqual(result.entities[0].entityId, "boot-C", "rank 1 = boot-C");
  assertEqual(result.entities[1].entityId, "shoe-A", "rank 2 = shoe-A");
  assertEqual(result.entities[2].entityId, "shoe-B", "rank 3 = shoe-B");

  assertEqual(result.entities[0].rank, 1, "boot-C rank = 1");
  assertEqual(result.entities[1].rank, 2, "shoe-A rank = 2");
  assertEqual(result.entities[2].rank, 3, "shoe-B rank = 3");

  assertEqual(result.entities[0].score, 40, "boot-C score = velocity");
  assertEqual(result.entities[1].score, 15, "shoe-A score = velocity");
  assertEqual(result.entities[2].score, 10, "shoe-B score = velocity");
});

// ── Test 2: default rankBy when omitted ─────────────────────────────────────

await test("default rankBy (omitted) — uses velocity", async () => {
  const result = analyzePerformanceTrends({ trends: SAMPLE_TRENDS });
  // Same order as velocity test above
  assertEqual(result.entities[0].entityId, "boot-C", "first is highest velocity");
  assertEqual(result.entities[0].score, 40, "score matches velocity");
});

// ── Test 3: rankBy netDelta ──────────────────────────────────────────────────

await test('rankBy "netDelta" — orders by netDelta descending', async () => {
  const result = analyzePerformanceTrends({ trends: SAMPLE_TRENDS, rankBy: "netDelta" });

  // boot-C netDelta=40, shoe-B netDelta=10, shoe-A netDelta=-15
  assertEqual(result.entities[0].entityId, "boot-C", "rank 1 = boot-C (netDelta 40)");
  assertEqual(result.entities[1].entityId, "shoe-B", "rank 2 = shoe-B (netDelta 10)");
  assertEqual(result.entities[2].entityId, "shoe-A", "rank 3 = shoe-A (netDelta -15)");

  assertEqual(result.entities[2].score, -15, "shoe-A score = -15 (negative allowed)");
});

// ── Test 4: rankBy salesTotal ────────────────────────────────────────────────

await test('rankBy "salesTotal" — orders by salesTotal descending', async () => {
  const result = analyzePerformanceTrends({ trends: SAMPLE_TRENDS, rankBy: "salesTotal" });

  // shoe-A salesTotal=35, boot-C salesTotal=20, shoe-B salesTotal=5
  assertEqual(result.entities[0].entityId, "shoe-A", "rank 1 = shoe-A (salesTotal 35)");
  assertEqual(result.entities[1].entityId, "boot-C", "rank 2 = boot-C (salesTotal 20)");
  assertEqual(result.entities[2].entityId, "shoe-B", "rank 3 = shoe-B (salesTotal 5)");
});

// ── Test 5: Equal primary score — tie broken by direction, then entityId ─────
// Old behavior: competition ranking (1, 1, 3).
// New behavior: deterministic tie-breaking — strictly sequential ranks (1, 2, 3).

await test("equal score + same direction — tie broken by entityId (alphabetical)", async () => {
  // alpha and beta: same velocity (20), same direction ("up"), no salesTotal.
  // Tie-breaker falls to entityId: "alpha" < "beta" → alpha rank 1, beta rank 2.
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "alpha", velocity: 20, direction: "up",   periodCount: 2 },
      { entityId: "beta",  velocity: 20, direction: "up",   periodCount: 2 },
      { entityId: "gamma", velocity: 10, direction: "down", periodCount: 2 },
    ],
    rankBy: "velocity",
  });

  const alpha = result.entities.find((e) => e.entityId === "alpha");
  const beta  = result.entities.find((e) => e.entityId === "beta");
  const gamma = result.entities.find((e) => e.entityId === "gamma");

  // Sequential ranks — no duplicates
  assertEqual(alpha?.rank, 1, "alpha rank = 1 (entityId 'alpha' < 'beta')");
  assertEqual(beta?.rank,  2, "beta rank = 2 (entityId 'beta' > 'alpha')");
  assertEqual(gamma?.rank, 3, "gamma rank = 3");

  // Verify no duplicate ranks in the full result
  const ranks = result.entities.map((e) => e.rank);
  const unique = new Set(ranks);
  assertEqual(unique.size, ranks.length, "no duplicate ranks");
});

// ── Test 6: All criteria tied — fully resolved by direction then entityId ────

await test("score tied — direction breaks tie first, then entityId", async () => {
  // X(up), Y(flat), Z(up): score tied.
  // Level 2 (direction): up(2) > flat(1) → X and Z ranked before Y.
  // Between X and Z: same direction, so Level 5 (entityId): "X" < "Z" → X rank 1, Z rank 2.
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "X", velocity: 5, direction: "up",   periodCount: 2 },
      { entityId: "Y", velocity: 5, direction: "flat",  periodCount: 2 },
      { entityId: "Z", velocity: 5, direction: "up",   periodCount: 2 },
    ],
    rankBy: "velocity",
  });

  const x = result.entities.find((e) => e.entityId === "X");
  const y = result.entities.find((e) => e.entityId === "Y");
  const z = result.entities.find((e) => e.entityId === "Z");

  assertEqual(x?.rank, 1, "X rank = 1 (up direction, entityId 'X' < 'Z')");
  assertEqual(z?.rank, 2, "Z rank = 2 (up direction, entityId 'Z' > 'X')");
  assertEqual(y?.rank, 3, "Y rank = 3 (flat direction, lower priority than up)");

  // Strictly sequential — no shared ranks
  assert([x?.rank, z?.rank, y?.rank].every((r) => r != null), "all ranks assigned");
  const allRanks = [x?.rank, z?.rank, y?.rank];
  assertEqual(new Set(allRanks).size, 3, "all three ranks are unique");
});

// ── Test 7: Empty input → empty entities ─────────────────────────────────────

await test("empty trends → returns empty entities", async () => {
  const result = analyzePerformanceTrends({ trends: [], rankBy: "velocity" });

  assert(Array.isArray(result.entities), "entities is array");
  assertEqual(result.entities.length, 0, "no entities for empty input");
});

// ── Test 8: Single entity ────────────────────────────────────────────────────

await test("single entity — receives rank 1 with empty tieBreakReason", async () => {
  const result = analyzePerformanceTrends({
    trends: [{ entityId: "solo", velocity: 7, direction: "up", periodCount: 2 }],
    rankBy: "velocity",
  });

  assertEqual(result.entities.length, 1, "one entity");
  assertEqual(result.entities[0].rank,  1,    "rank = 1");
  assertEqual(result.entities[0].score, 7,    "score = 7");
  assertEqual(result.entities[0].label, "solo", "label = entityId");
  assert(Array.isArray(result.entities[0].tieBreakReason), "tieBreakReason is array");
  assertEqual(result.entities[0].tieBreakReason.length, 0, "tieBreakReason empty for rank-1 entity");
});

// ── Test 9: Invalid rankBy — throws clearly ──────────────────────────────────

await test("throws for invalid rankBy value", async () => {
  try {
    analyzePerformanceTrends({ trends: SAMPLE_TRENDS, rankBy: "unknownMetric" });
    throw new Error("should have thrown");
  } catch (e) {
    assert(
      String(e).includes("rankBy must be one of"),
      `expected clear error about rankBy, got: ${e}`,
    );
  }
});

// ── Test 10: Malformed body — throws clearly ─────────────────────────────────

await test("throws when trends is not an array", async () => {
  try {
    analyzePerformanceTrends({ trends: "not-an-array", rankBy: "velocity" });
    throw new Error("should have thrown");
  } catch (e) {
    assert(String(e).includes("trends must be an array"), `expected clear error, got: ${e}`);
  }
});

await test("throws when body is null", async () => {
  try {
    analyzePerformanceTrends(null);
    throw new Error("should have thrown");
  } catch (e) {
    assert(String(e).includes("body must be an object"), `expected clear error, got: ${e}`);
  }
});

// ── Test 11: Malformed trend entries — skipped gracefully ───────────────────

await test("null entries in trends — skipped, valid entries ranked", async () => {
  const result = analyzePerformanceTrends({
    trends: [
      null,
      { entityId: "good-1", velocity: 5, direction: "up", periodCount: 2 },
      undefined,
      { entityId: "good-2", velocity: 9, direction: "up", periodCount: 2 },
    ],
    rankBy: "velocity",
  });

  assertEqual(result.entities.length, 2, "two valid entities");
  assertEqual(result.entities[0].entityId, "good-2", "higher velocity ranked first");
  assertEqual(result.entities[0].rank, 1, "rank 1");
  assertEqual(result.entities[1].rank, 2, "rank 2");
});

await test("entry with empty entityId — skipped", async () => {
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "",    velocity: 20, direction: "up", periodCount: 2 },
      { entityId: "ok",  velocity: 5,  direction: "up", periodCount: 2 },
    ],
    rankBy: "velocity",
  });

  assertEqual(result.entities.length, 1, "only non-empty entityId entry ranked");
  assertEqual(result.entities[0].entityId, "ok", "valid entity retained");
});

// ── Test 12: Input not mutated ───────────────────────────────────────────────

await test("input trends array is not mutated", async () => {
  const trends = [
    { entityId: "A", velocity: 5, direction: "up",  periodCount: 2 },
    { entityId: "B", velocity: 9, direction: "down", periodCount: 2 },
  ];
  const originalOrder = trends.map((t) => t.entityId);

  analyzePerformanceTrends({ trends, rankBy: "velocity" });

  const afterOrder = trends.map((t) => t.entityId);
  assert(
    originalOrder[0] === afterOrder[0] && originalOrder[1] === afterOrder[1],
    "input trends array was mutated",
  );
});

// ── Test 13: Missing metric field — defaults to 0 ────────────────────────────

await test("missing salesTotal in trend — treated as 0 for scoring", async () => {
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "no-sales",  velocity: 5, direction: "flat", periodCount: 2 }, // no salesTotal
      { entityId: "has-sales", velocity: 5, direction: "up",   periodCount: 2, salesTotal: 20 },
    ],
    rankBy: "salesTotal",
  });

  // has-sales score=20, no-sales score=0
  assertEqual(result.entities[0].entityId, "has-sales", "has-sales ranked first");
  assertEqual(result.entities[0].score, 20, "score = 20");
  assertEqual(result.entities[1].score, 0,  "no-sales defaults to score 0");
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────────────────────────────────────────────────`);
console.log(`  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);

if (failed > 0) {
  console.error("\nSome assertions failed — review implementation above.");
  process.exit(1);
} else {
  console.log("\nAll analyzePerformanceTrends tests pass. ✅");
}

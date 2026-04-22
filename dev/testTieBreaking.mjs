/**
 * Tie-Breaking Tests — deterministic ranking with multi-field comparator.
 *
 * Tests the 5-level tie-breaking strategy in analyzePerformanceTrends:
 *   Level 1 — score (descending)
 *   Level 2 — direction priority: "up"(2) > "flat"(1) > "down"/"unknown"(0)
 *   Level 3 — velocity (descending)
 *   Level 4 — salesTotal (descending)
 *   Level 5 — entityId (ascending, alphabetical)
 *
 * All ties are resolved → strictly sequential ranks (1, 2, 3 …, no duplicates).
 * tieBreakReason explains the criteria chain that determined each position.
 *
 * Run: node dev/testTieBreaking.mjs
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

/** Verify all ranks in entities are strictly sequential with no duplicates. */
function assertSequentialRanks(entities, label = "") {
  const ranks = entities.map((e) => e.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) {
      throw new Error(`${label}: expected sequential rank ${i + 1}, got ${ranks[i]}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL 1 — Score (no ties expected here)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Level 1: Primary score ──────────────────────────────────────────────\n");

await test("distinct scores — ranked by score descending", async () => {
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "C", direction: "up", velocity: 5,  netDelta: 5,  salesTotal: 5  },
      { entityId: "A", direction: "up", velocity: 30, netDelta: 30, salesTotal: 30 },
      { entityId: "B", direction: "up", velocity: 15, netDelta: 15, salesTotal: 15 },
    ],
    rankBy: "velocity",
  });

  assertEqual(result.entities[0].entityId, "A", "rank 1 = A (vel 30)");
  assertEqual(result.entities[1].entityId, "B", "rank 2 = B (vel 15)");
  assertEqual(result.entities[2].entityId, "C", "rank 3 = C (vel 5)");
  assertSequentialRanks(result.entities, "distinct scores");

  // tieBreakReason for rank 1 is empty (no prior entity)
  assertEqual(result.entities[0].tieBreakReason.length, 0, "rank 1 tieBreakReason is empty");
  // tieBreakReason for ranks 2+ is ["score"] (scores differ)
  assertEqual(result.entities[1].tieBreakReason[0], "score", "rank 2 reason starts with 'score'");
  assertEqual(result.entities[2].tieBreakReason[0], "score", "rank 3 reason starts with 'score'");
});

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL 2 — Direction priority (when score ties)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Level 2: Direction priority ─────────────────────────────────────────\n");

await test("equal score — 'up' ranks before 'flat' ranks before 'down'", async () => {
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "down-entity", velocity: 10, direction: "down" },
      { entityId: "up-entity",   velocity: 10, direction: "up"   },
      { entityId: "flat-entity", velocity: 10, direction: "flat"  },
    ],
    rankBy: "velocity",
  });

  assertEqual(result.entities[0].entityId, "up-entity",   "up entity ranked first");
  assertEqual(result.entities[1].entityId, "flat-entity", "flat entity ranked second");
  assertEqual(result.entities[2].entityId, "down-entity", "down entity ranked last");

  assertSequentialRanks(result.entities, "direction priority");

  // tieBreakReason for rank 2 (flat): tied score, then direction broke it
  const flatReason = result.entities[1].tieBreakReason;
  assertEqual(flatReason[0], "tied score",       "flat: first criterion was tied score");
  assertEqual(flatReason[1], "direction priority", "flat: direction broke the tie");

  // tieBreakReason for rank 3 (down): same chain
  const downReason = result.entities[2].tieBreakReason;
  assertEqual(downReason[0], "tied score",        "down: first criterion was tied score");
  assertEqual(downReason[1], "direction priority", "down: direction broke the tie");
});

await test("'down' and 'unknown' treated equally in direction priority", async () => {
  // Both have lowest direction priority (0) — tie falls to Level 5 (entityId)
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "beta",  velocity: 10 },              // direction "unknown"
      { entityId: "alpha", velocity: 10, direction: "down" },
    ],
    rankBy: "velocity",
  });

  // Scores equal, directions both priority 0 → entityId decides: "alpha" < "beta"
  assertEqual(result.entities[0].entityId, "alpha", "alpha before beta (entityId fallback)");
  assertEqual(result.entities[1].entityId, "beta",  "beta after alpha");
  assertSequentialRanks(result.entities, "down vs unknown");
});

await test("direction breaks score tie across multiple groups", async () => {
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "A", velocity: 20, direction: "down" },
      { entityId: "B", velocity: 20, direction: "up"   },
      { entityId: "C", velocity: 10, direction: "up"   },
      { entityId: "D", velocity: 10, direction: "down" },
    ],
    rankBy: "velocity",
  });

  // Within score=20 group: B(up) before A(down)
  // Within score=10 group: C(up) before D(down)
  assertEqual(result.entities[0].entityId, "B", "rank 1 = B (vel 20, up)");
  assertEqual(result.entities[1].entityId, "A", "rank 2 = A (vel 20, down)");
  assertEqual(result.entities[2].entityId, "C", "rank 3 = C (vel 10, up)");
  assertEqual(result.entities[3].entityId, "D", "rank 4 = D (vel 10, down)");

  assertSequentialRanks(result.entities, "multi-group direction tie-break");
});

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL 3 — Velocity (when score AND direction tie)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Level 3: Velocity tie-breaker ───────────────────────────────────────\n");

await test("same score + same direction — higher velocity ranks first", async () => {
  // rankBy "netDelta" so velocity is a tie-breaker, not the primary score
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "slow", netDelta: 10, direction: "up", velocity: 3,  salesTotal: 5 },
      { entityId: "fast", netDelta: 10, direction: "up", velocity: 15, salesTotal: 5 },
    ],
    rankBy: "netDelta",
  });

  assertEqual(result.entities[0].entityId, "fast", "fast ranked first (velocity 15 > 3)");
  assertEqual(result.entities[1].entityId, "slow", "slow ranked second");

  const slowReason = result.entities[1].tieBreakReason;
  assertEqual(slowReason[0], "tied score",    "slow: tied score");
  assertEqual(slowReason[1], "tied direction", "slow: tied direction");
  assertEqual(slowReason[2], "velocity",       "slow: velocity broke the tie");
});

await test("velocity tie-break respects descending order across three entities", async () => {
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "mid",  netDelta: 5, direction: "flat", velocity: 10, salesTotal: 0 },
      { entityId: "high", netDelta: 5, direction: "flat", velocity: 25, salesTotal: 0 },
      { entityId: "low",  netDelta: 5, direction: "flat", velocity: 2,  salesTotal: 0 },
    ],
    rankBy: "netDelta",
  });

  assertEqual(result.entities[0].entityId, "high", "high velocity → rank 1");
  assertEqual(result.entities[1].entityId, "mid",  "mid velocity → rank 2");
  assertEqual(result.entities[2].entityId, "low",  "low velocity → rank 3");

  assertSequentialRanks(result.entities, "velocity tie-break three entities");
});

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL 4 — salesTotal (when score, direction, AND velocity all tie)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Level 4: salesTotal tie-breaker ─────────────────────────────────────\n");

await test("same score + direction + velocity — higher salesTotal ranks first", async () => {
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "less-sold", netDelta: 10, direction: "up", velocity: 10, salesTotal: 3  },
      { entityId: "more-sold", netDelta: 10, direction: "up", velocity: 10, salesTotal: 50 },
    ],
    rankBy: "netDelta",
  });

  assertEqual(result.entities[0].entityId, "more-sold", "more-sold first (salesTotal 50 > 3)");
  assertEqual(result.entities[1].entityId, "less-sold", "less-sold second");

  const lsReason = result.entities[1].tieBreakReason;
  assertEqual(lsReason[0], "tied score",    "tied score");
  assertEqual(lsReason[1], "tied direction", "tied direction");
  assertEqual(lsReason[2], "tied velocity",  "tied velocity");
  assertEqual(lsReason[3], "salesTotal",     "salesTotal broke the tie");
});

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL 5 — entityId (final alphabetical fallback)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Level 5: entityId alphabetical fallback ─────────────────────────────\n");

await test("full tie on all metrics — entityId alphabetical resolves it", async () => {
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "zebra",  velocity: 10, direction: "up", salesTotal: 5 },
      { entityId: "apple",  velocity: 10, direction: "up", salesTotal: 5 },
      { entityId: "mango",  velocity: 10, direction: "up", salesTotal: 5 },
    ],
    rankBy: "velocity",
  });

  assertEqual(result.entities[0].entityId, "apple", "apple first (alphabetically)");
  assertEqual(result.entities[1].entityId, "mango", "mango second");
  assertEqual(result.entities[2].entityId, "zebra", "zebra last");

  assertSequentialRanks(result.entities, "entityId fallback");

  // tieBreakReason for rank 3 (zebra): all levels tied, entityId decided
  const zebraReason = result.entities[2].tieBreakReason;
  assertEqual(zebraReason[0], "tied score",      "zebra: tied score");
  assertEqual(zebraReason[1], "tied direction",   "zebra: tied direction");
  assertEqual(zebraReason[2], "tied velocity",    "zebra: tied velocity");
  assertEqual(zebraReason[3], "tied salesTotal",  "zebra: tied salesTotal");
  assertEqual(zebraReason[4], "entityId",         "zebra: entityId broke the tie");
});

await test("entityId is case-sensitive and ASCII-ordered", async () => {
  // Upper-case letters come before lower-case in ASCII
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "beta",  velocity: 5, direction: "up", salesTotal: 0 },
      { entityId: "Alpha", velocity: 5, direction: "up", salesTotal: 0 },
    ],
    rankBy: "velocity",
  });

  // "Alpha" < "beta" in ASCII (uppercase A = 65, lowercase b = 98)
  assertEqual(result.entities[0].entityId, "Alpha", "Alpha before beta (ASCII order)");
  assertSequentialRanks(result.entities, "case-sensitive entityId");
});

// ─────────────────────────────────────────────────────────────────────────────
// NO DUPLICATE RANKS
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── No duplicate ranks ──────────────────────────────────────────────────\n");

await test("no duplicate ranks — any combination of equal scores", async () => {
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "e1", velocity: 10, direction: "up",   salesTotal: 0 },
      { entityId: "e2", velocity: 10, direction: "up",   salesTotal: 0 },
      { entityId: "e3", velocity: 10, direction: "flat",  salesTotal: 0 },
      { entityId: "e4", velocity: 10, direction: "down",  salesTotal: 0 },
      { entityId: "e5", velocity: 5,  direction: "up",   salesTotal: 0 },
    ],
    rankBy: "velocity",
  });

  assertSequentialRanks(result.entities, "no duplicates in 5-entity list");
  assertEqual(result.entities.length, 5, "all five entities ranked");
});

await test("single entity — rank 1, tieBreakReason is empty", async () => {
  const result = analyzePerformanceTrends({
    trends: [{ entityId: "only", velocity: 7, direction: "up", salesTotal: 0 }],
    rankBy: "velocity",
  });

  assertEqual(result.entities[0].rank, 1, "rank = 1");
  assertEqual(result.entities[0].tieBreakReason.length, 0, "no tieBreakReason for rank 1");
});

await test("large set — all ranks unique and sequential", async () => {
  // 10 entities all with same score — breaks purely by direction then entityId
  const trends = Array.from({ length: 10 }, (_, i) => ({
    entityId:   `entity-${String(i).padStart(2, "0")}`,
    velocity:   20,
    direction:  i % 3 === 0 ? "up" : i % 3 === 1 ? "flat" : "down",
    salesTotal: 0,
  }));

  const result = analyzePerformanceTrends({ trends, rankBy: "velocity" });

  assertEqual(result.entities.length, 10, "all 10 entities ranked");
  assertSequentialRanks(result.entities, "10 tied entities");
});

// ─────────────────────────────────────────────────────────────────────────────
// STABLE ORDERING — same input → same output
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Stable ordering ─────────────────────────────────────────────────────\n");

await test("identical inputs always produce identical rank order", async () => {
  const input = {
    trends: [
      { entityId: "omega", velocity: 20, direction: "up",   salesTotal: 10, netDelta: 20 },
      { entityId: "alpha", velocity: 20, direction: "up",   salesTotal: 10, netDelta: 20 },
      { entityId: "delta", velocity: 20, direction: "flat",  salesTotal: 5,  netDelta: 5  },
      { entityId: "gamma", velocity: 10, direction: "down",  salesTotal: 2,  netDelta: -5 },
    ],
    rankBy: "velocity",
  };

  const run1 = analyzePerformanceTrends(input);
  const run2 = analyzePerformanceTrends(input);
  const run3 = analyzePerformanceTrends(input);

  for (let i = 0; i < run1.entities.length; i++) {
    assertEqual(run1.entities[i].entityId, run2.entities[i].entityId, `run2 entity[${i}]`);
    assertEqual(run1.entities[i].entityId, run3.entities[i].entityId, `run3 entity[${i}]`);
    assertEqual(run1.entities[i].rank,     run2.entities[i].rank,     `run2 rank[${i}]`);
    assertEqual(run1.entities[i].rank,     run3.entities[i].rank,     `run3 rank[${i}]`);
  }
});

await test("input array order does not affect output order", async () => {
  const makeInput = (/** @type {string[]} */ order) => ({
    trends: order.map((id) => ({
      entityId: id,
      velocity: 15,
      direction: "up",
      salesTotal: 0,
    })),
    rankBy: "velocity",
  });

  // Same entities in two different input orders
  const r1 = analyzePerformanceTrends(makeInput(["C", "A", "B"]));
  const r2 = analyzePerformanceTrends(makeInput(["B", "C", "A"]));

  // Both should produce A(1), B(2), C(3) since all metrics are equal and entityId decides
  assertEqual(r1.entities[0].entityId, "A", "r1: A first");
  assertEqual(r2.entities[0].entityId, "A", "r2: A first regardless of input order");
  assertEqual(r1.entities[1].entityId, r2.entities[1].entityId, "r1 and r2 agree on rank 2");
  assertEqual(r1.entities[2].entityId, r2.entities[2].entityId, "r1 and r2 agree on rank 3");
});

// ─────────────────────────────────────────────────────────────────────────────
// tieBreakReason STRUCTURE
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── tieBreakReason content ──────────────────────────────────────────────\n");

await test("tieBreakReason is always an array in every entity", async () => {
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "A", velocity: 20, direction: "up",   salesTotal: 0 },
      { entityId: "B", velocity: 15, direction: "down", salesTotal: 5 },
      { entityId: "C", velocity: 10, direction: "flat",  salesTotal: 10 },
    ],
    rankBy: "velocity",
  });

  for (const entity of result.entities) {
    assert(Array.isArray(entity.tieBreakReason), `${entity.entityId}: tieBreakReason is array`);
  }
});

await test("tieBreakReason ends at the first criterion that differed", async () => {
  // Direction breaks the tie between two same-score entities
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "A", velocity: 10, direction: "up",  salesTotal: 100 },
      { entityId: "B", velocity: 10, direction: "down", salesTotal: 200 },
    ],
    rankBy: "velocity",
  });

  // B has lower direction priority despite higher salesTotal → B ranked second
  const bReason = result.entities[1].tieBreakReason;
  // Reason stops at "direction priority" — does NOT include salesTotal info
  assert(bReason.includes("direction priority"), "reason includes 'direction priority'");
  assert(!bReason.includes("salesTotal"), "reason does NOT include salesTotal (stopped earlier)");
});

await test("tieBreakReason contains all tied criteria before the deciding one", async () => {
  // score tied, direction tied, velocity breaks it
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "A", netDelta: 5, direction: "flat", velocity: 20, salesTotal: 10 },
      { entityId: "B", netDelta: 5, direction: "flat", velocity: 8,  salesTotal: 99 },
    ],
    rankBy: "netDelta",
  });

  // A has higher velocity → rank 1; B has higher salesTotal but velocity broke it
  assertEqual(result.entities[0].entityId, "A", "A ranked first (velocity 20 > 8)");
  assertEqual(result.entities[1].entityId, "B", "B ranked second");

  const bReason = result.entities[1].tieBreakReason;
  // Chain: tied score → tied direction → velocity decided
  assertEqual(bReason[0], "tied score",    "starts with tied score");
  assertEqual(bReason[1], "tied direction", "then tied direction");
  assertEqual(bReason[2], "velocity",       "velocity is deciding criterion");
  assertEqual(bReason.length, 3, "reason has exactly 3 elements");
});

// ─────────────────────────────────────────────────────────────────────────────
// BEFORE vs AFTER — illustrative comparison
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Before vs After — tie resolution ───────────────────────────────────\n");

await test("before/after: 3 equal-score entities receive unique sequential ranks", async () => {
  // OLD behavior would produce ranks [1, 1, 1] (competition ranking).
  // NEW behavior produces [1, 2, 3] with deterministic tie-breaking.
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "oxford",  velocity: 0, direction: "flat",  salesTotal: 10 },
      { entityId: "sneaker", velocity: 0, direction: "flat",  salesTotal: 10 },
      { entityId: "boot",    velocity: 0, direction: "flat",  salesTotal: 10 },
    ],
    rankBy: "velocity",
  });

  const ranks = result.entities.map((e) => e.rank).sort((a, b) => a - b);
  assert(ranks[0] === 1 && ranks[1] === 2 && ranks[2] === 3, "ranks are 1, 2, 3 — no ties");

  // Alphabetical order determines final ranking
  const order = result.entities.map((e) => e.entityId);
  assertEqual(order[0], "boot",    "boot first (b < o < s)");
  assertEqual(order[1], "oxford",  "oxford second");
  assertEqual(order[2], "sneaker", "sneaker third");

  console.log("\n  Tie resolution (fully equal entities):");
  for (const e of result.entities) {
    console.log(`    ${e.entityId}: rank ${e.rank} — reason: [${e.tieBreakReason.join(", ")}]`);
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────────────────────────────────────────────────`);
console.log(`  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);

if (failed > 0) {
  console.error("\nSome tie-breaking assertions failed — review output above.");
  process.exit(1);
} else {
  console.log("\nAll tie-breaking tests pass. ✅");
}

/**
 * Pipeline Refinement Tests — field propagation, snapshotCount, and end-to-end run.
 *
 * Validates all stabilization fixes applied in the comprehensive refinement pass:
 *   FIX 1 — computeStateDelta emits snapshotCount
 *   FIX 2 — interpretTrends forwards netDelta, salesTotal; uses snapshotCount for periodCount
 *   FIX 3 — analyzePerformanceTrends forwards direction
 *   FIX 4 — pipeline is self-contained (no external merging required)
 *   FIX 5 — consistent validation across all handlers
 *
 * Run: node dev/testPipelineRefinements.mjs
 */

import { computeStateDelta }         from "../server/handlers/computeStateDelta.js";
import { interpretTrends }           from "../server/handlers/interpretTrends.js";
import { analyzePerformanceTrends }  from "../server/handlers/analyzePerformanceTrends.js";
import { generateRecommendations }   from "../server/handlers/generateRecommendations.js";

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

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1 TESTS — snapshotCount in computeStateDelta
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── FIX 1: computeStateDelta — snapshotCount ─────────────────────────────\n");

await test("snapshotCount equals number of valid snapshots for each entity", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "A", value: 10, timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "A", value: 20, timestamp: "2024-01-15T00:00:00Z" },
      { entityId: "A", value: 30, timestamp: "2024-01-31T00:00:00Z" }, // 3 snapshots
      { entityId: "B", value: 50, timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "B", value: 40, timestamp: "2024-01-31T00:00:00Z" }, // 2 snapshots
    ],
    deliveryEvents: [],
    saleEvents: [],
  });

  const a = result.deltas.find((d) => d.entityId === "A");
  const b = result.deltas.find((d) => d.entityId === "B");

  assertEqual(a?.snapshotCount, 3, "A has 3 snapshots");
  assertEqual(b?.snapshotCount, 2, "B has 2 snapshots");
});

await test("snapshotCount is an integer", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "C", value: 10, timestamp: "2024-02-01T00:00:00Z" },
      { entityId: "C", value: 20, timestamp: "2024-02-28T00:00:00Z" },
    ],
    deliveryEvents: [],
    saleEvents: [],
  });

  const c = result.deltas[0];
  assert(Number.isInteger(c.snapshotCount), "snapshotCount must be an integer");
  assert(c.snapshotCount >= 2, "snapshotCount must be >= 2 (validation rule)");
});

await test("snapshotCount reflects actual sorted count — not input order count", async () => {
  // 4 snapshots but one is a duplicate entity — the count should be 4 for entity A
  const result = computeStateDelta({
    snapshots: [
      { entityId: "A", value: 40, timestamp: "2024-01-31T00:00:00Z" }, // out of order
      { entityId: "A", value: 10, timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "A", value: 25, timestamp: "2024-01-15T00:00:00Z" },
      { entityId: "A", value: 35, timestamp: "2024-01-20T00:00:00Z" },
    ],
    deliveryEvents: [],
    saleEvents: [],
  });

  assertEqual(result.deltas[0].snapshotCount, 4, "all 4 snapshots counted after sort");
});

await test("entity with only 1 snapshot — skipped, no snapshotCount", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "skip-me", value: 100, timestamp: "2024-03-01T00:00:00Z" },
      { entityId: "keep-me", value: 10,  timestamp: "2024-03-01T00:00:00Z" },
      { entityId: "keep-me", value: 20,  timestamp: "2024-03-31T00:00:00Z" },
    ],
    deliveryEvents: [],
    saleEvents: [],
  });

  assertEqual(result.deltas.length, 1, "only entity with 2+ snapshots in output");
  assertEqual(result.deltas[0].entityId, "keep-me", "correct entity");
  assertEqual(result.deltas[0].snapshotCount, 2, "snapshotCount = 2");
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2 TESTS — interpretTrends forwards netDelta, salesTotal, uses snapshotCount
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── FIX 2: interpretTrends — field forwarding ────────────────────────────\n");

await test("netDelta forwarded unchanged — positive value", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "X", netDelta: 25, salesTotal: 10, snapshotCount: 3 }],
  });

  assertEqual(result.trends[0].netDelta, 25, "netDelta = 25 forwarded");
});

await test("netDelta forwarded unchanged — negative value", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "X", netDelta: -18, salesTotal: 0, snapshotCount: 2 }],
  });

  assertEqual(result.trends[0].netDelta, -18, "netDelta = -18 forwarded");
});

await test("salesTotal forwarded unchanged", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "Y", netDelta: 5, salesTotal: 42, snapshotCount: 4 }],
  });

  assertEqual(result.trends[0].salesTotal, 42, "salesTotal = 42 forwarded");
});

await test("salesTotal defaults to 0 when absent", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "Z", netDelta: 3, snapshotCount: 2 }],
  });

  assertEqual(result.trends[0].salesTotal, 0, "salesTotal defaults to 0 when absent");
});

await test("snapshotCount used as periodCount (preferred over periodCount field)", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "A", netDelta: 10, snapshotCount: 7, periodCount: 2 }],
  });

  // snapshotCount (7) should win over periodCount (2)
  assertEqual(result.trends[0].periodCount, 7, "snapshotCount wins over periodCount");
});

await test("periodCount used as fallback when snapshotCount absent", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "B", netDelta: 5, periodCount: 5 }],
  });

  assertEqual(result.trends[0].periodCount, 5, "periodCount used when snapshotCount absent");
});

await test("periodCount defaults to 2 when both snapshotCount and periodCount absent", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "C", netDelta: -3 }],
  });

  assertEqual(result.trends[0].periodCount, 2, "defaults to 2 when both absent");
});

await test("complete pipeline connector: all fields present in trend output", async () => {
  const result = interpretTrends({
    deltas: [
      { entityId: "full", netDelta: 8, salesTotal: 15, snapshotCount: 4 },
    ],
  });

  const t = result.trends[0];
  assert("entityId"    in t, "entityId present");
  assert("direction"   in t, "direction present");
  assert("velocity"    in t, "velocity present");
  assert("periodCount" in t, "periodCount present");
  assert("netDelta"    in t, "netDelta present");
  assert("salesTotal"  in t, "salesTotal present");
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3 TESTS — analyzePerformanceTrends forwards direction
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── FIX 3: analyzePerformanceTrends — direction forwarding ───────────────\n");

await test("direction forwarded unchanged to ranked entities", async () => {
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "A", direction: "up",   velocity: 10, periodCount: 2, netDelta: 10,  salesTotal: 5 },
      { entityId: "B", direction: "down", velocity: 5,  periodCount: 2, netDelta: -5,  salesTotal: 8 },
      { entityId: "C", direction: "flat", velocity: 0,  periodCount: 2, netDelta: 0,   salesTotal: 0 },
    ],
    rankBy: "velocity",
  });

  const a = result.entities.find((e) => e.entityId === "A");
  const b = result.entities.find((e) => e.entityId === "B");
  const c = result.entities.find((e) => e.entityId === "C");

  assertEqual(a?.direction, "up",   "A direction = up");
  assertEqual(b?.direction, "down", "B direction = down");
  assertEqual(c?.direction, "flat", "C direction = flat");
});

await test("direction defaults to 'unknown' when absent from trend", async () => {
  const result = analyzePerformanceTrends({
    trends: [{ entityId: "no-dir", velocity: 5, periodCount: 2 }],
    rankBy: "velocity",
  });

  assertEqual(result.entities[0].direction, "unknown", "missing direction → 'unknown'");
});

await test("all required fields present in ranked entity output", async () => {
  const result = analyzePerformanceTrends({
    trends: [{ entityId: "full-check", direction: "up", velocity: 8, periodCount: 3, netDelta: 8, salesTotal: 2 }],
    rankBy: "velocity",
  });

  const e = result.entities[0];
  assert("entityId"  in e, "entityId present");
  assert("label"     in e, "label present");
  assert("rank"      in e, "rank present");
  assert("score"     in e, "score present");
  assert("direction" in e, "direction present");
  assert(Number.isInteger(e.rank) && e.rank >= 1, "rank is integer >= 1");
});

await test("deterministic ranking — same input always produces same output", async () => {
  const input = {
    trends: [
      { entityId: "Z", direction: "up",   velocity: 15, periodCount: 2, netDelta: 15, salesTotal: 5 },
      { entityId: "Y", direction: "flat", velocity: 15, periodCount: 2, netDelta: 0,  salesTotal: 10 },
      { entityId: "X", direction: "down", velocity: 5,  periodCount: 2, netDelta: -5, salesTotal: 3 },
    ],
    rankBy: "velocity",
  };

  const run1 = analyzePerformanceTrends(input);
  const run2 = analyzePerformanceTrends(input);

  // Same order and values for both runs
  for (let i = 0; i < run1.entities.length; i++) {
    assertEqual(run1.entities[i].entityId, run2.entities[i].entityId, `entity[${i}] same`);
    assertEqual(run1.entities[i].rank,     run2.entities[i].rank,     `rank[${i}] same`);
    assertEqual(run1.entities[i].score,    run2.entities[i].score,    `score[${i}] same`);
  }
});

await test("direction preserved across ranking — not affected by sort", async () => {
  // boot-C is highest velocity but direction "down"
  const result = analyzePerformanceTrends({
    trends: [
      { entityId: "boot-C", direction: "down", velocity: 40, periodCount: 2, netDelta: -40, salesTotal: 40 },
      { entityId: "shoe-A", direction: "up",   velocity: 15, periodCount: 2, netDelta:  15, salesTotal: 10 },
    ],
    rankBy: "velocity",
  });

  const top = result.entities.find((e) => e.entityId === "boot-C");
  assertEqual(top?.rank, 1, "boot-C still rank 1");
  assertEqual(top?.direction, "down", "direction still 'down' despite rank 1");
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 4 TESTS — pipeline contract consistency (no external merging)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── FIX 4: Pipeline contract — no manual merging required ────────────────\n");

await test("computeStateDelta → interpretTrends: snapshotCount becomes periodCount", async () => {
  // Stage 1
  const delta = computeStateDelta({
    snapshots: [
      { entityId: "shoe", value: 100, timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "shoe", value: 80,  timestamp: "2024-01-15T00:00:00Z" },
      { entityId: "shoe", value: 70,  timestamp: "2024-01-31T00:00:00Z" },
    ],
    deliveryEvents: [],
    saleEvents: [{ entityId: "shoe", quantity: 30, timestamp: "2024-01-20T00:00:00Z", eventType: "sale" }],
  });

  assertEqual(delta.deltas[0].snapshotCount, 3, "delta has snapshotCount=3");

  // Stage 2 — feed directly from stage 1 output
  const trends = interpretTrends({ deltas: delta.deltas });

  assertEqual(trends.trends[0].periodCount, 3, "periodCount correctly from snapshotCount");
  assertEqual(trends.trends[0].salesTotal,  30, "salesTotal forwarded");
  assertEqual(trends.trends[0].netDelta,    -30, "netDelta forwarded");
});

await test("interpretTrends → analyzePerformanceTrends: direction available without merging", async () => {
  // Simulate a full stage 1→2→3 chain
  const delta = computeStateDelta({
    snapshots: [
      { entityId: "A", value: 10, timestamp: "2024-02-01T00:00:00Z" },
      { entityId: "A", value: 20, timestamp: "2024-02-28T00:00:00Z" },
    ],
    deliveryEvents: [],
    saleEvents: [],
  });

  const trends = interpretTrends({ deltas: delta.deltas });
  assertEqual(trends.trends[0].direction, "up", "interpretTrends produces direction");

  const ranked = analyzePerformanceTrends({ trends: trends.trends, rankBy: "velocity" });
  assertEqual(ranked.entities[0].direction, "up", "direction available in ranked without merging");
});

await test("all 4 stages chained — no external merging, no undefined fields", async () => {
  const delta = computeStateDelta({
    snapshots: [
      { entityId: "boot", value: 100, timestamp: "2024-03-01T00:00:00Z" },
      { entityId: "boot", value: 70,  timestamp: "2024-03-31T00:00:00Z" },
    ],
    deliveryEvents: [],
    saleEvents: [{ entityId: "boot", quantity: 30, timestamp: "2024-03-15T00:00:00Z", eventType: "sale" }],
  });

  const trends = interpretTrends({ deltas: delta.deltas });
  const ranked = analyzePerformanceTrends({ trends: trends.trends, rankBy: "velocity" });

  // generateRecommendations gets direction from ranked.entities — no extra step
  const recs = generateRecommendations({
    alerts: [{ entityId: "boot", severity: "high", message: "Low stock" }],
    rankedEntities: ranked.entities,
  });

  assert(recs.recommendations.length === 1, "one recommendation");
  const rec = recs.recommendations[0];
  assert(rec.action !== undefined, "action is defined");
  assert(rec.urgency !== undefined, "urgency is defined");
  assert(rec.reason.length > 0, "reason is non-empty");
  // direction now flows natively — recommendation can use it without merging
  assert(rec.action === "reorder" || rec.action === "investigate", "alert + down → reorder/investigate");
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 5 TESTS — validation standardization across all handlers
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── FIX 5: Validation standardization ───────────────────────────────────\n");

await test("invalid rows in deltas skipped — valid rows still processed", async () => {
  const result = interpretTrends({
    deltas: [
      null,
      { entityId: "valid", netDelta: 5, salesTotal: 3, snapshotCount: 2 },
      "bad-string",
      { entityId: "also-valid", netDelta: -2, salesTotal: 1, snapshotCount: 3 },
    ],
  });

  assertEqual(result.trends.length, 2, "two valid trends produced");
  assertEqual(result.trends[0].entityId, "valid",      "first valid entity");
  assertEqual(result.trends[1].entityId, "also-valid", "second valid entity");
});

await test("invalid rows in trends skipped — valid rows still ranked", async () => {
  const result = analyzePerformanceTrends({
    trends: [
      null,
      { entityId: "good", direction: "up", velocity: 10, periodCount: 2, netDelta: 10, salesTotal: 5 },
      42,
    ],
    rankBy: "velocity",
  });

  assertEqual(result.entities.length, 1, "one valid entity ranked");
  assertEqual(result.entities[0].entityId, "good", "valid entity in output");
});

await test("invalid rows in alerts skipped — valid alerts still indexed", async () => {
  // Two entities so "A" is rank 1 (not last) — isolates alert urgency from
  // the "last-rank + down = critical" rule, which needs rank === totalEntities.
  const result = generateRecommendations({
    alerts: [
      null,
      { entityId: "A", severity: "high", message: "Low stock" },
      undefined,
    ],
    rankedEntities: [
      { entityId: "A", label: "A", rank: 1, score: 20, direction: "down" },
      { entityId: "B", label: "B", rank: 2, score: 5,  direction: "up"   },
    ],
  });

  assertEqual(result.recommendations.length, 2, "two recommendations produced");
  const recA = result.recommendations.find((r) => r.entityId === "A");
  assertEqual(recA?.urgency, "high", "A: alert.severity=high → urgency=high (not last rank)");
});

await test("handlers never return undefined for arrays — always empty array on empty input", async () => {
  const d = computeStateDelta({ snapshots: [], deliveryEvents: [], saleEvents: [] });
  const t = interpretTrends({ deltas: [] });
  const r = analyzePerformanceTrends({ trends: [], rankBy: "velocity" });
  const g = generateRecommendations({ alerts: [], rankedEntities: [] });

  assert(Array.isArray(d.deltas),               "computeStateDelta returns array");
  assert(Array.isArray(t.trends),               "interpretTrends returns array");
  assert(Array.isArray(r.entities),             "analyzePerformanceTrends returns array");
  assert(Array.isArray(g.recommendations),      "generateRecommendations returns array");
  assertEqual(d.deltas.length, 0,               "deltas empty");
  assertEqual(t.trends.length, 0,               "trends empty");
  assertEqual(r.entities.length, 0,             "entities empty");
  assertEqual(g.recommendations.length, 0,      "recommendations empty");
});

// ─────────────────────────────────────────────────────────────────────────────
// FULL PIPELINE EXECUTION TEST
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Full Pipeline: computeStateDelta → interpretTrends → analyzePerformanceTrends → generateRecommendations ──\n");

await test("full pipeline — shoe store scenario — no manual merging", async () => {
  // Realistic 3-product shoe store dataset
  const SNAPSHOTS = [
    // Product A: Oxford — declining (100 → 65)
    { entityId: "oxford",  value: 100, timestamp: "2024-01-01T00:00:00Z" },
    { entityId: "oxford",  value: 82,  timestamp: "2024-01-15T00:00:00Z" },
    { entityId: "oxford",  value: 65,  timestamp: "2024-01-31T00:00:00Z" },
    // Product B: Sneaker — growing (30 → 55)
    { entityId: "sneaker", value: 30,  timestamp: "2024-01-01T00:00:00Z" },
    { entityId: "sneaker", value: 42,  timestamp: "2024-01-15T00:00:00Z" },
    { entityId: "sneaker", value: 55,  timestamp: "2024-01-31T00:00:00Z" },
    // Product C: Boot — stable (50 → 50)
    { entityId: "boot",    value: 50,  timestamp: "2024-01-01T00:00:00Z" },
    { entityId: "boot",    value: 52,  timestamp: "2024-01-15T00:00:00Z" },
    { entityId: "boot",    value: 50,  timestamp: "2024-01-31T00:00:00Z" },
  ];

  const DELIVERY_EVENTS = [
    { entityId: "oxford",  quantity: 20, timestamp: "2024-01-10T00:00:00Z", eventType: "delivery" },
    { entityId: "sneaker", quantity: 30, timestamp: "2024-01-10T00:00:00Z", eventType: "delivery" },
    { entityId: "boot",    quantity: 10, timestamp: "2024-01-10T00:00:00Z", eventType: "delivery" },
  ];

  const SALE_EVENTS = [
    { entityId: "oxford",  quantity: 55, timestamp: "2024-01-20T00:00:00Z", eventType: "sale" },
    { entityId: "sneaker", quantity: 5,  timestamp: "2024-01-20T00:00:00Z", eventType: "sale" },
    { entityId: "boot",    quantity: 10, timestamp: "2024-01-20T00:00:00Z", eventType: "sale" },
  ];

  // Stage 1
  const stageOne = computeStateDelta({
    snapshots:       SNAPSHOTS,
    deliveryEvents:  DELIVERY_EVENTS,
    saleEvents:      SALE_EVENTS,
  });

  assert(stageOne.deltas.length === 3, "3 deltas produced");
  const oxfordDelta = stageOne.deltas.find((d) => d.entityId === "oxford");
  assertEqual(oxfordDelta?.snapshotCount, 3, "oxford snapshotCount = 3");
  assertEqual(oxfordDelta?.netDelta, -35,    "oxford netDelta = 65-100 = -35");
  assertEqual(oxfordDelta?.salesTotal, 55,   "oxford salesTotal = 55");

  // Stage 2
  const stageTwo = interpretTrends({ deltas: stageOne.deltas });

  assert(stageTwo.trends.length === 3, "3 trends produced");
  const oxfordTrend = stageTwo.trends.find((t) => t.entityId === "oxford");
  const sneakerTrend = stageTwo.trends.find((t) => t.entityId === "sneaker");
  const bootTrend = stageTwo.trends.find((t) => t.entityId === "boot");

  assertEqual(oxfordTrend?.direction,   "down", "oxford → down");
  assertEqual(sneakerTrend?.direction,  "up",   "sneaker → up");
  assertEqual(bootTrend?.direction,     "flat",  "boot → flat");

  assertEqual(oxfordTrend?.periodCount,  3, "oxford periodCount = snapshotCount 3");
  assertEqual(sneakerTrend?.periodCount, 3, "sneaker periodCount = snapshotCount 3");

  assertEqual(oxfordTrend?.netDelta,   -35, "oxford netDelta forwarded");
  assertEqual(oxfordTrend?.salesTotal,  55, "oxford salesTotal forwarded");

  // Stage 3 — rank by velocity
  const stageThree = analyzePerformanceTrends({ trends: stageTwo.trends, rankBy: "velocity" });

  assert(stageThree.entities.length === 3, "3 entities ranked");

  // oxford velocity = 35, sneaker velocity = 25, boot velocity = 0
  const oxfordRanked  = stageThree.entities.find((e) => e.entityId === "oxford");
  const sneakerRanked = stageThree.entities.find((e) => e.entityId === "sneaker");
  const bootRanked    = stageThree.entities.find((e) => e.entityId === "boot");

  assertEqual(oxfordRanked?.rank,  1, "oxford rank 1 (highest velocity)");
  assertEqual(sneakerRanked?.rank, 2, "sneaker rank 2");
  assertEqual(bootRanked?.rank,    3, "boot rank 3");

  // direction must be present without merging
  assertEqual(oxfordRanked?.direction,  "down", "oxford direction = down in ranked output");
  assertEqual(sneakerRanked?.direction, "up",   "sneaker direction = up in ranked output");
  assertEqual(bootRanked?.direction,    "flat",  "boot direction = flat in ranked output");

  // Stage 4 — oxford has a low-stock alert
  const stageFour = generateRecommendations({
    alerts: [
      { entityId: "oxford", severity: "high", message: "Oxford inventory critically low" },
    ],
    rankedEntities: stageThree.entities,
  });

  assert(stageFour.recommendations.length === 3, "3 recommendations generated");

  const oxfordRec  = stageFour.recommendations.find((r) => r.entityId === "oxford");
  const sneakerRec = stageFour.recommendations.find((r) => r.entityId === "sneaker");
  const bootRec    = stageFour.recommendations.find((r) => r.entityId === "boot");

  // Oxford: alert present + direction "down" → reorder
  assertEqual(oxfordRec?.action, "reorder", "oxford: alert + down → reorder");
  assertEqual(oxfordRec?.urgency, "high",   "oxford: alert urgency = high");
  assert(oxfordRec?.reason.includes("Oxford inventory critically low"), "oxford reason includes alert message");

  // Sneaker: no alert, rank=2 (not rank 1), up direction → monitor
  assertEqual(sneakerRec?.action, "monitor", "sneaker: no alert, not rank 1 → monitor");

  // Boot: no alert, rank 3 (last), flat direction → investigate
  assertEqual(bootRec?.action, "investigate", "boot: last rank + flat → investigate");

  console.log("\n  Full pipeline trace:");
  console.log(`    oxford:  snapshotCount=${oxfordDelta?.snapshotCount}, netDelta=${oxfordDelta?.netDelta}, salesTotal=${oxfordDelta?.salesTotal}`);
  console.log(`    oxford trend: direction=${oxfordTrend?.direction}, velocity=${oxfordTrend?.velocity}, periodCount=${oxfordTrend?.periodCount}`);
  console.log(`    oxford ranked: rank=${oxfordRanked?.rank}, score=${oxfordRanked?.score}, direction=${oxfordRanked?.direction}`);
  console.log(`    oxford rec: action=${oxfordRec?.action}, urgency=${oxfordRec?.urgency}`);
  console.log(`    sneaker rec: action=${sneakerRec?.action}`);
  console.log(`    boot rec: action=${bootRec?.action}`);
});

await test("full pipeline — rankBy salesTotal uses forwarded salesTotal", async () => {
  const delta = computeStateDelta({
    snapshots: [
      { entityId: "A", value: 10, timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "A", value: 5,  timestamp: "2024-01-31T00:00:00Z" },
      { entityId: "B", value: 10, timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "B", value: 8,  timestamp: "2024-01-31T00:00:00Z" },
    ],
    deliveryEvents: [],
    saleEvents: [
      { entityId: "A", quantity: 50, timestamp: "2024-01-15T00:00:00Z", eventType: "sale" },
      { entityId: "B", quantity: 5,  timestamp: "2024-01-15T00:00:00Z", eventType: "sale" },
    ],
  });

  const trends = interpretTrends({ deltas: delta.deltas });
  const ranked = analyzePerformanceTrends({ trends: trends.trends, rankBy: "salesTotal" });

  const aRanked = ranked.entities.find((e) => e.entityId === "A");
  const bRanked = ranked.entities.find((e) => e.entityId === "B");

  // A has salesTotal=50, B has salesTotal=5 → A ranks first
  assertEqual(aRanked?.rank, 1, "A ranked 1st by salesTotal");
  assertEqual(bRanked?.rank, 2, "B ranked 2nd by salesTotal");
  assertEqual(aRanked?.score, 50, "A score = 50 (salesTotal)");
});

await test("full pipeline — rankBy netDelta uses forwarded netDelta", async () => {
  const delta = computeStateDelta({
    snapshots: [
      { entityId: "grower",   value: 10, timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "grower",   value: 90, timestamp: "2024-01-31T00:00:00Z" }, // +80
      { entityId: "shrinker", value: 90, timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "shrinker", value: 10, timestamp: "2024-01-31T00:00:00Z" }, // -80
    ],
    deliveryEvents: [],
    saleEvents: [],
  });

  const trends = interpretTrends({ deltas: delta.deltas });
  // velocities are equal (both 80) — rankBy netDelta breaks the tie meaningfully
  const ranked = analyzePerformanceTrends({ trends: trends.trends, rankBy: "netDelta" });

  const grower   = ranked.entities.find((e) => e.entityId === "grower");
  const shrinker = ranked.entities.find((e) => e.entityId === "shrinker");

  assertEqual(grower?.rank,   1, "grower ranked 1 by netDelta (positive)");
  assertEqual(shrinker?.rank, 2, "shrinker ranked 2 by netDelta (negative)");
  assertEqual(grower?.score,  80,  "grower score = 80");
  assertEqual(shrinker?.score, -80, "shrinker score = -80");
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────────────────────────────────────────────────`);
console.log(`  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);

if (failed > 0) {
  console.error("\nSome pipeline refinement assertions failed — review output above.");
  process.exit(1);
} else {
  console.log("\nAll pipeline refinement tests pass. ✅");
}

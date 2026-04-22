/**
 * Production Enhancement Tests — all six enhancements applied in the
 * production-grade enhancement pass.
 *
 * E1 — interpretTrends forwards startValue, endValue, deliveryTotal
 * E2 — computeStateDelta emits timeRange; interpretTrends adds velocityPerTime
 * E3 — analyzePerformanceTrends accepts entityLabelMap for human-readable labels
 * E4 — generateRecommendations uses percentile for size-stable urgency
 * E5 — generateRecommendations supports multi-alert aggregation + alertCount
 * E6 — all stages: no undefined fields, arrays always present, numbers always finite
 *
 * Run: node dev/testProductionEnhancements.mjs
 */

import { computeStateDelta }        from "../server/handlers/computeStateDelta.js";
import { interpretTrends }          from "../server/handlers/interpretTrends.js";
import { analyzePerformanceTrends } from "../server/handlers/analyzePerformanceTrends.js";
import { generateRecommendations }  from "../server/handlers/generateRecommendations.js";

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
// E2 TESTS — timeRange in computeStateDelta
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── E2: computeStateDelta — timeRange ───────────────────────────────────\n");

await test("timeRange emitted with correct startTimestamp and endTimestamp", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "shoe", value: 100, timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "shoe", value: 80,  timestamp: "2024-01-31T00:00:00Z" },
    ],
    deliveryEvents: [],
    saleEvents: [],
  });

  const d = result.deltas[0];
  assert(d.timeRange != null, "timeRange must exist");
  assertEqual(d.timeRange.startTimestamp, "2024-01-01T00:00:00Z", "startTimestamp");
  assertEqual(d.timeRange.endTimestamp,   "2024-01-31T00:00:00Z", "endTimestamp");
});

await test("durationMs equals endMs - startMs", async () => {
  const start = "2024-01-01T00:00:00Z";
  const end   = "2024-01-31T00:00:00Z";
  const expected = new Date(end).getTime() - new Date(start).getTime();

  const result = computeStateDelta({
    snapshots: [
      { entityId: "A", value: 50, timestamp: start },
      { entityId: "A", value: 40, timestamp: end   },
    ],
    deliveryEvents: [],
    saleEvents: [],
  });

  assertEqual(result.deltas[0].timeRange.durationMs, expected, `durationMs = ${expected}ms`);
});

await test("timeRange uses sorted order — not input order", async () => {
  // Snapshots out of order: Jan 31 first, Jan 1 last
  const result = computeStateDelta({
    snapshots: [
      { entityId: "B", value: 60, timestamp: "2024-01-31T00:00:00Z" },
      { entityId: "B", value: 80, timestamp: "2024-01-01T00:00:00Z" },
    ],
    deliveryEvents: [],
    saleEvents: [],
  });

  assertEqual(result.deltas[0].timeRange.startTimestamp, "2024-01-01T00:00:00Z", "startTimestamp is earliest");
  assertEqual(result.deltas[0].timeRange.endTimestamp,   "2024-01-31T00:00:00Z", "endTimestamp is latest");
});

await test("durationMs is always >= 0", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "C", value: 10, timestamp: "2024-06-01T00:00:00Z" },
      { entityId: "C", value: 10, timestamp: "2024-06-01T00:00:00Z" }, // same timestamp
    ],
    deliveryEvents: [],
    saleEvents: [],
  });

  assert(result.deltas[0].timeRange.durationMs >= 0, "durationMs >= 0 even for same timestamps");
});

// ─────────────────────────────────────────────────────────────────────────────
// E1 TESTS — interpretTrends forwards startValue, endValue, deliveryTotal
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── E1: interpretTrends — core state field forwarding ───────────────────\n");

await test("startValue forwarded exactly from delta", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "X", netDelta: -20, startValue: 100, endValue: 80, deliveryTotal: 5, salesTotal: 25, snapshotCount: 2 }],
  });
  assertEqual(result.trends[0].startValue, 100, "startValue = 100");
});

await test("endValue forwarded exactly from delta", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "X", netDelta: -20, startValue: 100, endValue: 80, deliveryTotal: 5, salesTotal: 25, snapshotCount: 2 }],
  });
  assertEqual(result.trends[0].endValue, 80, "endValue = 80");
});

await test("deliveryTotal forwarded exactly from delta", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "X", netDelta: 10, startValue: 30, endValue: 40, deliveryTotal: 15, salesTotal: 5, snapshotCount: 3 }],
  });
  assertEqual(result.trends[0].deliveryTotal, 15, "deliveryTotal = 15");
});

await test("startValue/endValue default to 0 when absent", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "Y", netDelta: 5, snapshotCount: 2 }],
  });
  assertEqual(result.trends[0].startValue,    0, "startValue defaults to 0");
  assertEqual(result.trends[0].endValue,      0, "endValue defaults to 0");
  assertEqual(result.trends[0].deliveryTotal, 0, "deliveryTotal defaults to 0");
});

await test("timeRange forwarded from delta", async () => {
  const timeRange = {
    startTimestamp: "2024-01-01T00:00:00Z",
    endTimestamp:   "2024-01-31T00:00:00Z",
    durationMs:     2678400000,
  };
  const result = interpretTrends({
    deltas: [{ entityId: "A", netDelta: 10, snapshotCount: 2, timeRange }],
  });
  assert(result.trends[0].timeRange !== null, "timeRange forwarded");
  assertEqual(result.trends[0].timeRange?.startTimestamp, "2024-01-01T00:00:00Z", "startTimestamp forwarded");
  assertEqual(result.trends[0].timeRange?.durationMs, 2678400000, "durationMs forwarded");
});

await test("timeRange is null when absent from delta", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "B", netDelta: 3, snapshotCount: 2 }],
  });
  assertEqual(result.trends[0].timeRange, null, "timeRange null when absent");
});

await test("velocityPerTime computed when durationMs > 0", async () => {
  const durationMs = 1_000_000; // 1 million ms
  const netDelta = 50;
  const result = interpretTrends({
    deltas: [{
      entityId: "C",
      netDelta,
      snapshotCount: 2,
      timeRange: { startTimestamp: "t0", endTimestamp: "t1", durationMs },
    }],
  });
  const expected = Math.abs(netDelta) / durationMs;
  assertEqual(result.trends[0].velocityPerTime, expected, `velocityPerTime = velocity / durationMs`);
});

await test("velocityPerTime is 0 when durationMs is 0", async () => {
  const result = interpretTrends({
    deltas: [{
      entityId: "D",
      netDelta: 10,
      snapshotCount: 2,
      timeRange: { startTimestamp: "t", endTimestamp: "t", durationMs: 0 },
    }],
  });
  assertEqual(result.trends[0].velocityPerTime, 0, "velocityPerTime = 0 when no duration");
});

await test("velocityPerTime is 0 when timeRange absent", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "E", netDelta: 20, snapshotCount: 2 }],
  });
  assertEqual(result.trends[0].velocityPerTime, 0, "velocityPerTime = 0 when no timeRange");
});

await test("full trend row has all required fields with no undefined values", async () => {
  const result = interpretTrends({
    deltas: [{
      entityId: "full",
      netDelta: 8,
      startValue: 10,
      endValue: 18,
      deliveryTotal: 12,
      salesTotal: 4,
      snapshotCount: 4,
      timeRange: { startTimestamp: "2024-01-01T00:00:00Z", endTimestamp: "2024-01-15T00:00:00Z", durationMs: 1209600000 },
    }],
  });

  const t = result.trends[0];
  const fields = ["entityId", "direction", "velocity", "velocityPerTime", "periodCount",
                  "netDelta", "salesTotal", "startValue", "endValue", "deliveryTotal", "timeRange"];
  for (const f of fields) {
    assert(f in t, `field "${f}" present`);
    assert(t[f] !== undefined, `field "${f}" not undefined`);
  }
  assert(Number.isFinite(t.velocityPerTime), "velocityPerTime is finite");
  assert(Number.isFinite(t.velocity),        "velocity is finite");
  assert(Number.isFinite(t.netDelta),        "netDelta is finite");
});

// ─────────────────────────────────────────────────────────────────────────────
// E3 TESTS — entityLabelMap in analyzePerformanceTrends
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── E3: analyzePerformanceTrends — entityLabelMap ───────────────────────\n");

const SAMPLE_TRENDS_3 = [
  { entityId: "oxford",  direction: "down", velocity: 35, periodCount: 3, netDelta: -35, salesTotal: 55 },
  { entityId: "sneaker", direction: "up",   velocity: 25, periodCount: 3, netDelta:  25, salesTotal: 5  },
  { entityId: "boot",    direction: "flat", velocity: 0,  periodCount: 3, netDelta:  0,  salesTotal: 10 },
];

await test("label resolved from entityLabelMap when provided", async () => {
  const result = analyzePerformanceTrends({
    trends: SAMPLE_TRENDS_3,
    rankBy: "velocity",
    entityLabelMap: {
      oxford:  "Oxford Classic",
      sneaker: "Sport Sneaker",
      boot:    "Winter Boot",
    },
  });

  const oxford  = result.entities.find((e) => e.entityId === "oxford");
  const sneaker = result.entities.find((e) => e.entityId === "sneaker");
  const boot    = result.entities.find((e) => e.entityId === "boot");

  assertEqual(oxford?.label,  "Oxford Classic", "oxford label resolved");
  assertEqual(sneaker?.label, "Sport Sneaker",  "sneaker label resolved");
  assertEqual(boot?.label,    "Winter Boot",    "boot label resolved");
});

await test("label falls back to entityId when no map provided", async () => {
  const result = analyzePerformanceTrends({ trends: SAMPLE_TRENDS_3, rankBy: "velocity" });

  assert(
    result.entities.every((e) => e.label === e.entityId),
    "all labels equal entityId when no map",
  );
});

await test("label falls back to entityId for entities not in map", async () => {
  const result = analyzePerformanceTrends({
    trends: SAMPLE_TRENDS_3,
    rankBy: "velocity",
    entityLabelMap: { oxford: "Oxford Classic" }, // only oxford mapped
  });

  const sneaker = result.entities.find((e) => e.entityId === "sneaker");
  const boot    = result.entities.find((e) => e.entityId === "boot");

  assertEqual(sneaker?.label, "sneaker", "unmapped entity falls back to entityId");
  assertEqual(boot?.label,    "boot",    "unmapped entity falls back to entityId");
});

await test("empty entityLabelMap treated same as no map", async () => {
  const result = analyzePerformanceTrends({
    trends: SAMPLE_TRENDS_3,
    rankBy: "velocity",
    entityLabelMap: {},
  });

  assert(
    result.entities.every((e) => e.label === e.entityId),
    "empty map → entityId fallback",
  );
});

await test("entityLabelMap that is array — treated as no map (graceful)", async () => {
  const result = analyzePerformanceTrends({
    trends: SAMPLE_TRENDS_3,
    rankBy: "velocity",
    entityLabelMap: /** @type {any} */ (["invalid"]),
  });

  assert(
    result.entities.every((e) => e.label === e.entityId),
    "invalid map type (array) → entityId fallback",
  );
});

await test("entityLabelMap does not affect ranking — only label", async () => {
  const withMap    = analyzePerformanceTrends({ trends: SAMPLE_TRENDS_3, rankBy: "velocity", entityLabelMap: { oxford: "X" } });
  const withoutMap = analyzePerformanceTrends({ trends: SAMPLE_TRENDS_3, rankBy: "velocity" });

  // Ranks and scores must be identical
  for (let i = 0; i < withMap.entities.length; i++) {
    assertEqual(withMap.entities[i].rank,     withoutMap.entities[i].rank,     `rank[${i}] unchanged`);
    assertEqual(withMap.entities[i].score,    withoutMap.entities[i].score,    `score[${i}] unchanged`);
    assertEqual(withMap.entities[i].entityId, withoutMap.entities[i].entityId, `entityId[${i}] unchanged`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// E4 TESTS — percentile-based urgency in generateRecommendations
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── E4: generateRecommendations — percentile urgency ────────────────────\n");

await test("percentile field present in all recommendations", async () => {
  const result = generateRecommendations({
    alerts: [],
    rankedEntities: [
      { entityId: "A", label: "A", rank: 1, score: 10, direction: "up" },
      { entityId: "B", label: "B", rank: 2, score: 5,  direction: "down" },
    ],
  });

  for (const rec of result.recommendations) {
    assert("percentile" in rec, `${rec.entityId}: percentile field present`);
    assert(typeof rec.percentile === "number", `${rec.entityId}: percentile is number`);
    assert(rec.percentile > 0 && rec.percentile <= 1, `${rec.entityId}: percentile in (0, 1]`);
  }
});

await test("percentile = rank / totalEntities — exact values", async () => {
  const result = generateRecommendations({
    alerts: [],
    rankedEntities: [
      { entityId: "P1", label: "P1", rank: 1, score: 30, direction: "up" },
      { entityId: "P2", label: "P2", rank: 2, score: 20, direction: "up" },
      { entityId: "P3", label: "P3", rank: 3, score: 10, direction: "flat" },
      { entityId: "P4", label: "P4", rank: 4, score: 5,  direction: "down" },
      { entityId: "P5", label: "P5", rank: 5, score: 1,  direction: "down" },
    ],
  });

  const p = (/** @type {string} */ id) => result.recommendations.find((r) => r.entityId === id)?.percentile;
  assertEqual(p("P1"), 0.2, "P1 percentile = 1/5 = 0.2");
  assertEqual(p("P2"), 0.4, "P2 percentile = 2/5 = 0.4");
  assertEqual(p("P3"), 0.6, "P3 percentile = 3/5 = 0.6");
  assertEqual(p("P4"), 0.8, "P4 percentile = 4/5 = 0.8");
  assertEqual(p("P5"), 1.0, "P5 percentile = 5/5 = 1.0");
});

await test("urgency critical for bottom 20% trending down (percentile >= 0.8)", async () => {
  // 5 entities — P5 at rank 5 (percentile 1.0, bottom 20%) trending down → critical
  const result = generateRecommendations({
    alerts: [],
    rankedEntities: [
      { entityId: "P1", label: "P1", rank: 1, score: 30, direction: "up" },
      { entityId: "P2", label: "P2", rank: 2, score: 20, direction: "up" },
      { entityId: "P3", label: "P3", rank: 3, score: 10, direction: "flat" },
      { entityId: "P4", label: "P4", rank: 4, score: 5,  direction: "down" },
      { entityId: "P5", label: "P5", rank: 5, score: 1,  direction: "down" },
    ],
  });

  const p5 = result.recommendations.find((r) => r.entityId === "P5");
  const p4 = result.recommendations.find((r) => r.entityId === "P4");

  assertEqual(p5?.urgency, "critical", "P5 percentile=1.0 + down → critical");
  assertEqual(p4?.urgency, "critical", "P4 percentile=0.8 + down → critical (at threshold)");
});

await test("urgency stable across different dataset sizes — same percentile, same urgency", async () => {
  // Small set (2 entities) — P2 is last (percentile 1.0) + down
  const small = generateRecommendations({
    alerts: [],
    rankedEntities: [
      { entityId: "top",    label: "top",    rank: 1, score: 20, direction: "up" },
      { entityId: "bottom", label: "bottom", rank: 2, score: 5,  direction: "down" },
    ],
  });

  // Large set (10 entities) — last entity is percentile 1.0 + down
  const rankedEntities10 = Array.from({ length: 10 }, (_, i) => ({
    entityId: `e${i + 1}`,
    label: `e${i + 1}`,
    rank: i + 1,
    score: 100 - i * 10,
    direction: i === 9 ? "down" : "up",
  }));
  const large = generateRecommendations({ alerts: [], rankedEntities: rankedEntities10 });

  // Both bottom entities (percentile 1.0, direction "down") should get "critical"
  const smallBottom = small.recommendations.find((r) => r.entityId === "bottom");
  const largeBottom = large.recommendations.find((r) => r.entityId === "e10");

  assertEqual(smallBottom?.urgency, "critical", "2-entity set bottom: critical");
  assertEqual(largeBottom?.urgency, "critical", "10-entity set bottom: critical");
  assertEqual(smallBottom?.percentile, 1.0, "small percentile = 1.0");
  assertEqual(largeBottom?.percentile, 1.0, "large percentile = 1.0");
});

await test("percentile included in reason string", async () => {
  const result = generateRecommendations({
    alerts: [],
    rankedEntities: [{ entityId: "solo", label: "solo", rank: 1, score: 10, direction: "up" }],
  });
  // percentile = 1/1 = 1.0 → 100th percentile
  assert(result.recommendations[0].reason.includes("100th percentile"), "reason mentions percentile");
});

// ─────────────────────────────────────────────────────────────────────────────
// E5 TESTS — multi-alert support
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── E5: generateRecommendations — multi-alert aggregation ───────────────\n");

await test("alertCount = 0 when no alerts for entity", async () => {
  const result = generateRecommendations({
    alerts: [],
    rankedEntities: [{ entityId: "A", label: "A", rank: 1, score: 10, direction: "up" }],
  });

  assertEqual(result.recommendations[0].alertCount, 0, "alertCount = 0 with no alerts");
});

await test("alertCount = 1 for single alert", async () => {
  const result = generateRecommendations({
    alerts: [{ entityId: "A", severity: "high", message: "Low stock" }],
    rankedEntities: [{ entityId: "A", label: "A", rank: 1, score: 10, direction: "down" }],
  });

  assertEqual(result.recommendations[0].alertCount, 1, "alertCount = 1");
});

await test("alertCount matches total alerts for entity", async () => {
  const result = generateRecommendations({
    alerts: [
      { entityId: "A", severity: "low",    message: "Restock reminder" },
      { entityId: "A", severity: "medium", message: "Sales dip" },
      { entityId: "A", severity: "high",   message: "Critically low" },
    ],
    rankedEntities: [{ entityId: "A", label: "A", rank: 1, score: 10, direction: "down" }],
  });

  assertEqual(result.recommendations[0].alertCount, 3, "alertCount = 3 for three alerts");
});

await test("severity = highest severity across multiple alerts", async () => {
  // low + critical + medium → should derive "critical" urgency
  const result = generateRecommendations({
    alerts: [
      { entityId: "A", severity: "low",      message: "Note 1" },
      { entityId: "A", severity: "critical", message: "URGENT" },
      { entityId: "A", severity: "medium",   message: "Note 2" },
    ],
    rankedEntities: [
      { entityId: "A", label: "A", rank: 1, score: 10, direction: "up" },
      { entityId: "B", label: "B", rank: 2, score: 5,  direction: "up" },
    ],
  });

  const recA = result.recommendations.find((r) => r.entityId === "A");
  assertEqual(recA?.urgency, "critical", "highest severity (critical) drives urgency");
  assertEqual(recA?.alertCount, 3, "alertCount = 3");
});

await test("first non-empty message used in reason", async () => {
  const result = generateRecommendations({
    alerts: [
      { entityId: "A", severity: "low",  message: "First message" },
      { entityId: "A", severity: "high", message: "Second message" },
    ],
    rankedEntities: [{ entityId: "A", label: "A", rank: 1, score: 5, direction: "down" }],
  });

  const rec = result.recommendations[0];
  assert(rec.reason.includes("First message"), "first message used in reason");
  assert(!rec.reason.includes("Second message"), "second message not repeated");
});

await test("alert count > 1 mentioned in reason", async () => {
  const result = generateRecommendations({
    alerts: [
      { entityId: "X", severity: "high",   message: "Primary alert" },
      { entityId: "X", severity: "medium", message: "Secondary" },
    ],
    rankedEntities: [{ entityId: "X", label: "X", rank: 1, score: 10, direction: "down" }],
  });

  const rec = result.recommendations[0];
  assert(rec.reason.includes("2 alerts total"), "reason mentions alert count > 1");
});

await test("alerts for different entities do not contaminate each other", async () => {
  const result = generateRecommendations({
    alerts: [
      { entityId: "A", severity: "critical", message: "A is critical" },
      { entityId: "B", severity: "low",      message: "B is low" },
    ],
    rankedEntities: [
      { entityId: "A", label: "A", rank: 1, score: 10, direction: "down" },
      { entityId: "B", label: "B", rank: 2, score: 5,  direction: "up"  },
    ],
  });

  const recA = result.recommendations.find((r) => r.entityId === "A");
  const recB = result.recommendations.find((r) => r.entityId === "B");

  assertEqual(recA?.urgency, "critical", "A urgency = critical");
  assertEqual(recA?.alertCount, 1, "A alertCount = 1");

  assertEqual(recB?.alertCount, 1, "B alertCount = 1");
  assert(recB?.urgency !== "critical", "B urgency != critical (only low alert)");
});

await test("multiple entities, different alert counts — each counted independently", async () => {
  const result = generateRecommendations({
    alerts: [
      { entityId: "A", severity: "high", message: "A alert 1" },
      { entityId: "A", severity: "high", message: "A alert 2" },
      { entityId: "B", severity: "low",  message: "B alert 1" },
    ],
    rankedEntities: [
      { entityId: "A", label: "A", rank: 1, score: 20, direction: "down" },
      { entityId: "B", label: "B", rank: 2, score: 10, direction: "up"  },
      { entityId: "C", label: "C", rank: 3, score: 5,  direction: "up"  },
    ],
  });

  const a = result.recommendations.find((r) => r.entityId === "A");
  const b = result.recommendations.find((r) => r.entityId === "B");
  const c = result.recommendations.find((r) => r.entityId === "C");

  assertEqual(a?.alertCount, 2, "A has 2 alerts");
  assertEqual(b?.alertCount, 1, "B has 1 alert");
  assertEqual(c?.alertCount, 0, "C has 0 alerts");
});

// ─────────────────────────────────────────────────────────────────────────────
// E6 TESTS — field consistency guarantee
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── E6: Field consistency across all stages ──────────────────────────────\n");

await test("computeStateDelta: all numeric fields are finite", async () => {
  const result = computeStateDelta({
    snapshots: [
      { entityId: "A", value: 10, timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "A", value: 20, timestamp: "2024-01-31T00:00:00Z" },
    ],
    deliveryEvents: [],
    saleEvents: [],
  });
  const d = result.deltas[0];
  for (const k of ["startValue", "endValue", "netDelta", "deliveryTotal", "salesTotal", "snapshotCount"]) {
    assert(Number.isFinite(d[k]), `${k} is finite`);
  }
  assert(Number.isFinite(d.timeRange.durationMs), "timeRange.durationMs is finite");
});

await test("interpretTrends: no undefined fields in output row", async () => {
  const result = interpretTrends({
    deltas: [{ entityId: "X", netDelta: 5, startValue: 10, endValue: 15, deliveryTotal: 0, salesTotal: 5, snapshotCount: 2,
               timeRange: { startTimestamp: "2024-01-01T00:00:00Z", endTimestamp: "2024-01-31T00:00:00Z", durationMs: 2678400000 } }],
  });

  const t = result.trends[0];
  for (const k of ["entityId", "direction", "velocity", "velocityPerTime", "periodCount",
                    "netDelta", "salesTotal", "startValue", "endValue", "deliveryTotal"]) {
    assert(t[k] !== undefined, `${k} is defined`);
  }
  // timeRange is present (not null here since we passed one)
  assert(t.timeRange !== undefined, "timeRange is defined (not undefined)");
});

await test("analyzePerformanceTrends: all output fields defined and typed correctly", async () => {
  const result = analyzePerformanceTrends({
    trends: [{ entityId: "Y", direction: "up", velocity: 10, periodCount: 2, netDelta: 10, salesTotal: 5 }],
    rankBy: "velocity",
  });

  const e = result.entities[0];
  assert(typeof e.entityId  === "string",  "entityId string");
  assert(typeof e.label     === "string",  "label string");
  assert(typeof e.rank      === "number",  "rank number");
  assert(typeof e.score     === "number",  "score number");
  assert(typeof e.direction === "string",  "direction string");
  assert(Number.isInteger(e.rank) && e.rank >= 1, "rank integer >= 1");
  assert(Number.isFinite(e.score), "score finite");
});

await test("generateRecommendations: all output fields defined and typed correctly", async () => {
  const result = generateRecommendations({
    alerts: [{ entityId: "Z", severity: "high", message: "test" }],
    rankedEntities: [{ entityId: "Z", label: "Z", rank: 1, score: 5, direction: "down" }],
  });

  const r = result.recommendations[0];
  assert(typeof r.entityId   === "string",  "entityId string");
  assert(typeof r.label      === "string",  "label string");
  assert(typeof r.action     === "string",  "action string");
  assert(typeof r.urgency    === "string",  "urgency string");
  assert(typeof r.reason     === "string",  "reason string");
  assert(typeof r.alertCount === "number",  "alertCount number");
  assert(typeof r.percentile === "number",  "percentile number");
  assert(r.reason.length > 0, "reason non-empty");
  assert(Number.isFinite(r.percentile), "percentile finite");
  assert(Number.isFinite(r.alertCount), "alertCount finite");
});

// ─────────────────────────────────────────────────────────────────────────────
// FULL PIPELINE WITH ALL ENHANCEMENTS
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Full enhanced pipeline ───────────────────────────────────────────────\n");

await test("full pipeline — all enhancements active — shoe store scenario", async () => {
  // Stage 1: computeStateDelta
  const stage1 = computeStateDelta({
    snapshots: [
      { entityId: "oxford",  value: 100, timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "oxford",  value: 82,  timestamp: "2024-01-15T00:00:00Z" },
      { entityId: "oxford",  value: 65,  timestamp: "2024-01-31T00:00:00Z" },
      { entityId: "sneaker", value: 30,  timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "sneaker", value: 42,  timestamp: "2024-01-15T00:00:00Z" },
      { entityId: "sneaker", value: 55,  timestamp: "2024-01-31T00:00:00Z" },
      { entityId: "boot",    value: 50,  timestamp: "2024-01-01T00:00:00Z" },
      { entityId: "boot",    value: 52,  timestamp: "2024-01-15T00:00:00Z" },
      { entityId: "boot",    value: 50,  timestamp: "2024-01-31T00:00:00Z" },
    ],
    deliveryEvents: [
      { entityId: "oxford",  quantity: 20, timestamp: "2024-01-10T00:00:00Z", eventType: "delivery" },
      { entityId: "sneaker", quantity: 30, timestamp: "2024-01-10T00:00:00Z", eventType: "delivery" },
      { entityId: "boot",    quantity: 10, timestamp: "2024-01-10T00:00:00Z", eventType: "delivery" },
    ],
    saleEvents: [
      { entityId: "oxford",  quantity: 55, timestamp: "2024-01-20T00:00:00Z", eventType: "sale" },
      { entityId: "sneaker", quantity: 5,  timestamp: "2024-01-20T00:00:00Z", eventType: "sale" },
      { entityId: "boot",    quantity: 10, timestamp: "2024-01-20T00:00:00Z", eventType: "sale" },
    ],
  });

  // Verify timeRange present
  const oxfordDelta = stage1.deltas.find((d) => d.entityId === "oxford");
  assert(oxfordDelta?.timeRange != null, "E2: oxford delta has timeRange");
  assertEqual(oxfordDelta?.timeRange.startTimestamp, "2024-01-01T00:00:00Z", "E2: startTimestamp");
  assert(oxfordDelta?.timeRange.durationMs > 0, "E2: durationMs > 0");
  assertEqual(oxfordDelta?.startValue, 100, "E1: startValue in delta");
  assertEqual(oxfordDelta?.deliveryTotal, 20, "E1: deliveryTotal in delta");

  // Stage 2: interpretTrends
  const stage2 = interpretTrends({ deltas: stage1.deltas });

  const oxfordTrend = stage2.trends.find((t) => t.entityId === "oxford");
  assertEqual(oxfordTrend?.startValue,    100, "E1: startValue forwarded through trends");
  assertEqual(oxfordTrend?.deliveryTotal, 20,  "E1: deliveryTotal forwarded through trends");
  assert(oxfordTrend?.timeRange != null, "E2: timeRange forwarded through trends");
  assert(typeof oxfordTrend?.velocityPerTime === "number", "E2: velocityPerTime present");
  assert(oxfordTrend?.velocityPerTime > 0, "E2: velocityPerTime > 0 (has duration)");

  // Stage 3: analyzePerformanceTrends with label map (E3)
  const stage3 = analyzePerformanceTrends({
    trends: stage2.trends,
    rankBy: "velocity",
    entityLabelMap: {
      oxford:  "Oxford Classic",
      sneaker: "Sport Sneaker",
      boot:    "Winter Boot",
    },
  });

  const oxfordRanked = stage3.entities.find((e) => e.entityId === "oxford");
  assertEqual(oxfordRanked?.label, "Oxford Classic", "E3: label resolved from entityLabelMap");
  assert(typeof oxfordRanked?.direction === "string", "direction forwarded to ranked entity");

  // Stage 4: generateRecommendations — multi-alert (E5) + percentile (E4)
  const stage4 = generateRecommendations({
    alerts: [
      { entityId: "oxford", severity: "high",   message: "Stock critically low" },
      { entityId: "oxford", severity: "medium", message: "Sales velocity high" },
    ],
    rankedEntities: stage3.entities,
  });

  const oxfordRec  = stage4.recommendations.find((r) => r.entityId === "oxford");
  const sneakerRec = stage4.recommendations.find((r) => r.entityId === "sneaker");
  const bootRec    = stage4.recommendations.find((r) => r.entityId === "boot");

  // E5: multi-alert
  assertEqual(oxfordRec?.alertCount, 2, "E5: oxford alertCount = 2");
  assert(oxfordRec?.reason.includes("2 alerts total"), "E5: multi-alert count in reason");

  // E4: percentile
  assert(typeof oxfordRec?.percentile === "number", "E4: percentile present");
  assert(oxfordRec?.reason.includes("percentile"), "E4: percentile in reason");

  // Recommendations are sensible
  assertEqual(oxfordRec?.action, "reorder", "oxford: alert + down → reorder");
  assert(sneakerRec != null, "sneaker rec exists");
  assert(bootRec != null, "boot rec exists");

  // Label from labelMap flows into recommendation
  assertEqual(oxfordRec?.label, "Oxford Classic", "E3: label from labelMap in recommendation");

  console.log("\n  Enhanced pipeline trace:");
  console.log(`    oxford delta: startValue=${oxfordDelta?.startValue}, endValue=${oxfordDelta?.endValue}, timeRange.durationMs=${oxfordDelta?.timeRange.durationMs}ms`);
  console.log(`    oxford trend: velocityPerTime=${oxfordTrend?.velocityPerTime?.toFixed(10)}/ms, periodCount=${oxfordTrend?.periodCount}`);
  console.log(`    oxford ranked: label="${oxfordRanked?.label}", rank=${oxfordRanked?.rank}, direction=${oxfordRanked?.direction}`);
  console.log(`    oxford rec: action=${oxfordRec?.action}, urgency=${oxfordRec?.urgency}, alertCount=${oxfordRec?.alertCount}, percentile=${oxfordRec?.percentile}`);
  console.log(`    sneaker rec: action=${sneakerRec?.action}, urgency=${sneakerRec?.urgency}`);
  console.log(`    boot rec: action=${bootRec?.action}, urgency=${bootRec?.urgency}`);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────────────────────────────────────────────────`);
console.log(`  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);

if (failed > 0) {
  console.error("\nSome enhancement assertions failed — review output above.");
  process.exit(1);
} else {
  console.log("\nAll production enhancement tests pass. ✅");
}

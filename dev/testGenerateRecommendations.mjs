/**
 * Tests for the generateRecommendations engine capability.
 *
 * Calls the pure function from server/handlers/generateRecommendations.js directly —
 * no server initialization required.
 *
 * The same function is registered in CLAIRA_RUN_HANDLERS as:
 *   generateRecommendations: (body) => generateRecommendationsHandler(body)
 *
 * Run: node dev/testGenerateRecommendations.mjs
 */

import { generateRecommendations } from "../server/handlers/generateRecommendations.js";

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

// Sample ranked entities (from analyzePerformanceTrends output)
const RANKED_3 = [
  { entityId: "boot-C", label: "boot-C", rank: 1, score: 40, direction: "up"   },
  { entityId: "shoe-A", label: "shoe-A", rank: 2, score: 15, direction: "down" },
  { entityId: "shoe-B", label: "shoe-B", rank: 3, score: 10, direction: "down" },
];

console.log("\n── generateRecommendations — Engine Handler Tests ───────────────────────\n");

// ── Test 1: No alerts — rank + direction drive recommendations ───────────────

await test("no alerts — rank 1 + up direction → promote", async () => {
  const result = generateRecommendations({
    alerts: [],
    rankedEntities: RANKED_3,
  });

  assert(Array.isArray(result.recommendations), "recommendations is array");
  assertEqual(result.recommendations.length, 3, "three recommendations");

  const top = result.recommendations.find((r) => r.entityId === "boot-C");
  assert(top != null, "boot-C recommendation exists");
  assertEqual(top.action, "promote", "rank 1 + up → promote");
  assert(typeof top.reason === "string" && top.reason.length > 0, "reason is non-empty string");
});

await test("no alerts — last rank + down direction → investigate", async () => {
  const result = generateRecommendations({
    alerts: [],
    rankedEntities: RANKED_3,
  });

  const last = result.recommendations.find((r) => r.entityId === "shoe-B");
  assert(last != null, "shoe-B recommendation exists");
  assertEqual(last.action, "investigate", "last rank + down → investigate");
});

await test("no alerts — mid rank + down direction → monitor", async () => {
  const result = generateRecommendations({
    alerts: [],
    rankedEntities: RANKED_3,
  });

  const mid = result.recommendations.find((r) => r.entityId === "shoe-A");
  assert(mid != null, "shoe-A recommendation exists");
  // shoe-A is rank 2 of 3, direction down — not last rank so falls through to monitor
  assertEqual(mid.action, "monitor", "mid rank → monitor");
});

// ── Test 2: Alert on entity — alert signal overrides rank-based logic ────────

await test("alert on entity + down direction → reorder", async () => {
  const result = generateRecommendations({
    alerts: [{ entityId: "shoe-A", severity: "high", message: "Stock below threshold" }],
    rankedEntities: RANKED_3,
  });

  const rec = result.recommendations.find((r) => r.entityId === "shoe-A");
  assertEqual(rec?.action, "reorder", "alert + down → reorder");
  assertEqual(rec?.urgency, "high", "alert urgency = high");
  assert(rec?.reason.includes("Alert"), "reason mentions alert");
});

await test("critical alert → urgency is critical", async () => {
  const result = generateRecommendations({
    alerts: [{ entityId: "shoe-B", severity: "critical", message: "Out of stock" }],
    rankedEntities: RANKED_3,
  });

  const rec = result.recommendations.find((r) => r.entityId === "shoe-B");
  assertEqual(rec?.urgency, "critical", "critical alert → critical urgency");
});

await test("alert on top-ranked entity with up direction → investigate (not reorder)", async () => {
  const result = generateRecommendations({
    alerts: [{ entityId: "boot-C", severity: "low", message: "Unusual spike in demand" }],
    rankedEntities: RANKED_3,
  });

  const rec = result.recommendations.find((r) => r.entityId === "boot-C");
  // Alert present + direction "up" → no reorder, falls to investigate
  assertEqual(rec?.action, "investigate", "alert + up direction → investigate");
});

// ── Test 3: Custom actionTypes ────────────────────────────────────────────────

await test("custom actionTypes — restricts available actions", async () => {
  const result = generateRecommendations({
    alerts: [{ entityId: "shoe-B", severity: "high", message: "Low stock" }],
    rankedEntities: RANKED_3,
    actionTypes: ["investigate", "monitor"],  // no "reorder"
  });

  const rec = result.recommendations.find((r) => r.entityId === "shoe-B");
  // Alert + down direction, but "reorder" not in actionTypes → falls to "investigate"
  assertEqual(rec?.action, "investigate", "reorder not allowed → falls to investigate");
});

await test("custom actionTypes with only monitor — all entities get monitor", async () => {
  const result = generateRecommendations({
    alerts: [],
    rankedEntities: RANKED_3,
    actionTypes: ["monitor"],
  });

  assert(
    result.recommendations.every((r) => r.action === "monitor"),
    "all entities get monitor when only monitor allowed",
  );
});

// ── Test 4: Conflicting signals ───────────────────────────────────────────────

await test("conflicting signals — alert on rank-1 up entity: alert wins", async () => {
  const result = generateRecommendations({
    alerts: [{ entityId: "boot-C", severity: "high", message: "Demand spike — verify supply" }],
    rankedEntities: RANKED_3,
  });

  const rec = result.recommendations.find((r) => r.entityId === "boot-C");
  // Would normally be "promote" (rank 1 + up), but alert overrides → investigate
  assert(rec?.action !== "promote", "alert overrides promote for rank 1 entity");
  assertEqual(rec?.action, "investigate", "alert on up entity → investigate");
});

// ── Test 5: Empty rankedEntities → empty recommendations ────────────────────

await test("empty rankedEntities → returns empty recommendations", async () => {
  const result = generateRecommendations({
    alerts: [{ entityId: "some-entity", severity: "high" }],
    rankedEntities: [],
  });

  assert(Array.isArray(result.recommendations), "recommendations is array");
  assertEqual(result.recommendations.length, 0, "no entities → no recommendations");
});

// ── Test 6: No alerts, single entity ─────────────────────────────────────────

await test("single entity, no alerts, direction up → promote", async () => {
  const result = generateRecommendations({
    alerts: [],
    rankedEntities: [{ entityId: "solo", label: "Solo Item", rank: 1, score: 20, direction: "up" }],
  });

  assertEqual(result.recommendations.length, 1, "one recommendation");
  assertEqual(result.recommendations[0].action, "promote", "solo rank 1 up → promote");
  assertEqual(result.recommendations[0].label, "Solo Item", "label passed through from ranked entity");
});

// ── Test 7: Alerts for entities not in rankedEntities — no crash ──────────────

await test("alerts for non-existent entities — ignored gracefully", async () => {
  const result = generateRecommendations({
    alerts: [
      { entityId: "phantom-entity", severity: "critical", message: "Missing" },
    ],
    rankedEntities: RANKED_3,
  });

  assertEqual(result.recommendations.length, 3, "still three recommendations");
  assert(
    result.recommendations.every((r) => r.entityId !== "phantom-entity"),
    "phantom entity not in output",
  );
});

// ── Test 8: Malformed body — throws clearly ──────────────────────────────────

await test("throws when alerts is not an array", async () => {
  try {
    generateRecommendations({ alerts: "bad", rankedEntities: RANKED_3 });
    throw new Error("should have thrown");
  } catch (e) {
    assert(String(e).includes("alerts must be an array"), `expected clear error, got: ${e}`);
  }
});

await test("throws when rankedEntities is not an array", async () => {
  try {
    generateRecommendations({ alerts: [], rankedEntities: null });
    throw new Error("should have thrown");
  } catch (e) {
    assert(String(e).includes("rankedEntities must be an array"), `expected clear error, got: ${e}`);
  }
});

await test("throws when body is not an object", async () => {
  try {
    generateRecommendations(null);
    throw new Error("should have thrown");
  } catch (e) {
    assert(String(e).includes("body must be an object"), `expected clear error, got: ${e}`);
  }
});

// ── Test 9: Urgency levels ────────────────────────────────────────────────────

await test("urgency low for rank-1, up, no alert", async () => {
  const result = generateRecommendations({
    alerts: [],
    rankedEntities: [
      { entityId: "top", label: "top", rank: 1, score: 50, direction: "up" },
      { entityId: "mid", label: "mid", rank: 2, score: 30, direction: "up" },
    ],
  });

  const top = result.recommendations.find((r) => r.entityId === "top");
  assertEqual(top?.urgency, "low", "rank 1 up no alert → low urgency");
});

await test("urgency medium for flat direction with no alert", async () => {
  const result = generateRecommendations({
    alerts: [],
    rankedEntities: [
      { entityId: "flat-one", label: "flat-one", rank: 1, score: 0, direction: "flat" },
    ],
  });

  const rec = result.recommendations[0];
  assertEqual(rec?.urgency, "medium", "flat direction → medium urgency");
});

// ── Test 10: Recommendation has all required fields ───────────────────────────

await test("all required fields present in recommendation output", async () => {
  const result = generateRecommendations({
    alerts: [],
    rankedEntities: [{ entityId: "check-me", label: "Check Me", rank: 1, score: 5, direction: "up" }],
  });

  const rec = result.recommendations[0];
  assert("entityId" in rec,  "entityId present");
  assert("label"    in rec,  "label present");
  assert("action"   in rec,  "action present");
  assert("urgency"  in rec,  "urgency present");
  assert("reason"   in rec,  "reason present");
  assert(typeof rec.reason === "string" && rec.reason.length > 0, "reason is non-empty");
});

// ── Test 11: Malformed entries in alerts/rankedEntities — skipped ────────────

await test("null entries in alerts — skipped gracefully", async () => {
  const result = generateRecommendations({
    alerts: [null, undefined, { entityId: "shoe-A", severity: "high" }],
    rankedEntities: RANKED_3,
  });

  // Should still work — null alerts skipped, shoe-A alert processed
  const rec = result.recommendations.find((r) => r.entityId === "shoe-A");
  assertEqual(rec?.urgency, "high", "real alert processed despite null entries");
});

await test("null entries in rankedEntities — skipped gracefully", async () => {
  const result = generateRecommendations({
    alerts: [],
    rankedEntities: [
      null,
      { entityId: "valid", label: "Valid", rank: 1, score: 10, direction: "up" },
      undefined,
    ],
  });

  assertEqual(result.recommendations.length, 1, "only valid entity in output");
  assertEqual(result.recommendations[0].entityId, "valid", "valid entity processed");
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────────────────────────────────────────────────`);
console.log(`  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);

if (failed > 0) {
  console.error("\nSome assertions failed — review implementation above.");
  process.exit(1);
} else {
  console.log("\nAll generateRecommendations tests pass. ✅");
}

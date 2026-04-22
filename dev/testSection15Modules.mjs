/**
 * Contract validation for Section 15 module definitions (Shoe Store workflow).
 *
 * Verifies each module passes assertEngineContract without executing any engine logic.
 * Run: node dev/testSection15Modules.mjs
 */

import { assertEngineContract } from "../workflow/modules/moduleContract.js";
import { entityRegistryModule }           from "../workflow/modules/entityRegistryModule.js";
import { inventorySnapshotLoggerModule }  from "../workflow/modules/inventorySnapshotLoggerModule.js";
import { deliveryLoggerModule }           from "../workflow/modules/deliveryLoggerModule.js";
import { salesLoggerModule }              from "../workflow/modules/salesLoggerModule.js";
import { stateDeltaComputerModule }       from "../workflow/modules/stateDeltaComputerModule.js";
import { trendInterpreterModule }         from "../workflow/modules/trendInterpreterModule.js";
import { rankingEngineModule }            from "../workflow/modules/rankingEngineModule.js";
import { recommendationGeneratorModule }  from "../workflow/modules/recommendationGeneratorModule.js";

let passed = 0;
let failed = 0;

/** @param {string} name @param {() => void} fn */
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

console.log("\n── Section 15 Module Contract Validation ─────────────────────────────────\n");

// ── Existing-capability modules ──────────────────────────────────────────────

console.log("EXISTING-CAPABILITY MODULES (engineKinds all ✅ in CLAIRA_RUN_HANDLERS)\n");

test("entity_registry passes assertEngineContract", () => {
  assertEngineContract(entityRegistryModule, "entity_registry");
});
test("entity_registry.engineKinds = [createTrackingEntity, listTrackingEntities]", () => {
  const kinds = entityRegistryModule.engineKinds;
  if (!kinds.includes("createTrackingEntity") || !kinds.includes("listTrackingEntities")) {
    throw new Error(`unexpected engineKinds: ${JSON.stringify(kinds)}`);
  }
});
test("entity_registry consumes entity, produces entity", () => {
  if (!entityRegistryModule.consumes.includes("entity")) throw new Error("consumes missing entity");
  if (!entityRegistryModule.produces.some(p => p.kind === "entity")) throw new Error("produces missing entity");
});
test("entity_registry.buildPayload throws on missing artifact", () => {
  try {
    entityRegistryModule.buildPayload({});
    throw new Error("should have thrown");
  } catch (e) {
    if (!String(e).includes("entity_input must run first")) throw e;
  }
});

test("inventory_snapshot_logger passes assertEngineContract", () => {
  assertEngineContract(inventorySnapshotLoggerModule, "inventory_snapshot_logger");
});
test("inventory_snapshot_logger.engineKinds = [addTrackingSnapshot, listTrackingSnapshots]", () => {
  const kinds = inventorySnapshotLoggerModule.engineKinds;
  if (!kinds.includes("addTrackingSnapshot") || !kinds.includes("listTrackingSnapshots")) {
    throw new Error(`unexpected engineKinds: ${JSON.stringify(kinds)}`);
  }
});
test("inventory_snapshot_logger consumes entity, produces aggregate", () => {
  if (!inventorySnapshotLoggerModule.consumes.includes("entity")) throw new Error("consumes missing entity");
  if (!inventorySnapshotLoggerModule.produces.some(p => p.kind === "aggregate")) throw new Error("produces missing aggregate");
});

test("delivery_logger passes assertEngineContract", () => {
  assertEngineContract(deliveryLoggerModule, "delivery_logger");
});
test("delivery_logger.engineKinds = [addTrackingSnapshot]", () => {
  if (!deliveryLoggerModule.engineKinds.includes("addTrackingSnapshot")) {
    throw new Error("missing addTrackingSnapshot");
  }
});
test("delivery_logger consumes entity, produces event", () => {
  if (!deliveryLoggerModule.consumes.includes("entity")) throw new Error("consumes missing entity");
  if (!deliveryLoggerModule.produces.some(p => p.kind === "event")) throw new Error("produces missing event");
});

test("sales_logger passes assertEngineContract", () => {
  assertEngineContract(salesLoggerModule, "sales_logger");
});
test("sales_logger consumes entity, produces event", () => {
  if (!salesLoggerModule.consumes.includes("entity")) throw new Error("consumes missing entity");
  if (!salesLoggerModule.produces.some(p => p.kind === "event")) throw new Error("produces missing event");
});

// ── New-capability modules ────────────────────────────────────────────────────

console.log("\nNEW-CAPABILITY MODULES (engineKinds ❌ — not yet in CLAIRA_RUN_HANDLERS)\n");

test("state_delta_computer passes assertEngineContract", () => {
  assertEngineContract(stateDeltaComputerModule, "state_delta_computer");
});
test("state_delta_computer.engineKinds = [computeStateDelta]", () => {
  if (!stateDeltaComputerModule.engineKinds.includes("computeStateDelta")) {
    throw new Error("missing computeStateDelta");
  }
});
test("state_delta_computer consumes aggregate + event, produces analysis", () => {
  if (!stateDeltaComputerModule.consumes.includes("aggregate")) throw new Error("consumes missing aggregate");
  if (!stateDeltaComputerModule.consumes.includes("event")) throw new Error("consumes missing event");
  if (!stateDeltaComputerModule.produces.some(p => p.kind === "analysis")) throw new Error("produces missing analysis");
});
test("state_delta_computer.buildPayload throws on missing aggregate", () => {
  try {
    stateDeltaComputerModule.buildPayload({});
    throw new Error("should have thrown");
  } catch (e) {
    if (!String(e).includes("inventory_snapshot_logger must run first")) throw e;
  }
});

test("trend_interpreter passes assertEngineContract", () => {
  assertEngineContract(trendInterpreterModule, "trend_interpreter");
});
test("trend_interpreter.engineKinds = [interpretTrends]", () => {
  if (!trendInterpreterModule.engineKinds.includes("interpretTrends")) {
    throw new Error("missing interpretTrends");
  }
});
test("trend_interpreter consumes analysis, produces analysis", () => {
  if (!trendInterpreterModule.consumes.includes("analysis")) throw new Error("consumes missing analysis");
  if (!trendInterpreterModule.produces.some(p => p.kind === "analysis")) throw new Error("produces missing analysis");
});

test("ranking_engine passes assertEngineContract", () => {
  assertEngineContract(rankingEngineModule, "ranking_engine");
});
test("ranking_engine.engineKinds = [analyzePerformanceTrends]", () => {
  if (!rankingEngineModule.engineKinds.includes("analyzePerformanceTrends")) {
    throw new Error("missing analyzePerformanceTrends");
  }
});
test("ranking_engine consumes analysis, produces aggregate", () => {
  if (!rankingEngineModule.consumes.includes("analysis")) throw new Error("consumes missing analysis");
  if (!rankingEngineModule.produces.some(p => p.kind === "aggregate")) throw new Error("produces missing aggregate");
});

test("recommendation_generator passes assertEngineContract", () => {
  assertEngineContract(recommendationGeneratorModule, "recommendation_generator");
});
test("recommendation_generator.engineKinds = [generateRecommendations]", () => {
  if (!recommendationGeneratorModule.engineKinds.includes("generateRecommendations")) {
    throw new Error("missing generateRecommendations");
  }
});
test("recommendation_generator consumes aggregate, produces deliverable", () => {
  if (!recommendationGeneratorModule.consumes.includes("aggregate")) throw new Error("consumes missing aggregate");
  if (!recommendationGeneratorModule.produces.some(p => p.kind === "deliverable")) throw new Error("produces missing deliverable");
});
test("recommendation_generator.buildPayload throws on missing AlertSet", () => {
  try {
    recommendationGeneratorModule.buildPayload({});
    throw new Error("should have thrown");
  } catch (e) {
    if (!String(e).includes("threshold_evaluator must run first")) throw e;
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────────────────────────────────────────────────`);
console.log(`  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);

if (failed > 0) {
  console.error("\nSome assertions failed — review module definitions above.");
  process.exit(1);
} else {
  console.log("\nAll Section 15 modules pass assertEngineContract. ✅");
}

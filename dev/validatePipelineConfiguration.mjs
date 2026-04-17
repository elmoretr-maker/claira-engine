/**
 * Phase 1 — pipeline validation proofs (valid + invalid cases).
 * Run: node dev/validatePipelineConfiguration.mjs
 */
import { validatePipelineConfiguration } from "../workflow/pipeline/validatePipelineConfiguration.js";
import { MODULE_REGISTRY } from "../workflow/modules/moduleRegistry.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

// --- Valid: core modules that produce entity before consuming it ---
const v1 = validatePipelineConfiguration({
  orderedModuleIds: ["entity_tracking", "event_log"],
  registry: MODULE_REGISTRY,
});
assert("valid entity→event passes", v1.ok === true, JSON.stringify(v1.errors));

// --- Invalid 1: consume entity without prior producer ---
const badRegistry1 = {
  only_event: {
    modulePipelineType: "tracking",
    consumes: ["entity"],
    produces: [{ kind: "event", mode: "create" }],
  },
};
const inv1 = validatePipelineConfiguration({
  orderedModuleIds: ["only_event"],
  registry: /** @type {typeof MODULE_REGISTRY} */ (badRegistry1),
});
assert("invalid missing entity producer fails", inv1.ok === false);
assert(
  "invalid case 1 has DATA_CONTRACT_MISSING",
  inv1.errors.some((e) => e.code === "DATA_CONTRACT_MISSING"),
  inv1.errors.map((e) => e.code).join(","),
);

// --- Invalid 2: processing without preceding input (mock registry) ---
const badRegistry2 = {
  solo_processing: {
    modulePipelineType: "processing",
    consumes: [],
    produces: [{ kind: "analysis", mode: "create" }],
  },
};
const inv2 = validatePipelineConfiguration({
  orderedModuleIds: ["solo_processing"],
  registry: /** @type {typeof MODULE_REGISTRY} */ (badRegistry2),
});
assert("invalid processing without input fails", inv2.ok === false);
assert(
  "invalid case 2 has ORDER_INPUT_BEFORE_PROCESSING",
  inv2.errors.some((e) => e.code === "ORDER_INPUT_BEFORE_PROCESSING"),
  inv2.errors.map((e) => e.code).join(","),
);

console.log("\n--- Invalid case 1 errors (sample) ---");
console.log(JSON.stringify(inv1.errors, null, 2));
console.log("\n--- Invalid case 2 errors (sample) ---");
console.log(JSON.stringify(inv2.errors, null, 2));

console.log("\nAll validatePipelineConfiguration proofs passed.");

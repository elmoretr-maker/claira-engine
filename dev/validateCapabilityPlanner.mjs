/**
 * Planner + domain registry — deterministic plans, domain constraints.
 * Run: node dev/validateCapabilityPlanner.mjs
 */
import { registerAllCapabilities } from "../workflow/modules/capabilities/registerAllCapabilities.js";
import { planCapabilities } from "../workflow/modules/capabilities/capabilityPlanner.js";
import { getDomainDefinition, isModuleAllowedInDomain, listDomainIds } from "../workflow/modules/capabilities/domainRegistry.js";
import { getCapabilities } from "../workflow/modules/capabilities/capabilityRegistry.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

registerAllCapabilities();
const available = getCapabilities().map((m) => m.id);

const intents = [{ label: "organize tax documents w2 1099", score: 1 }];

const p1 = planCapabilities({
  intentCandidates: intents,
  refinedCategory: "documents",
  domainMode: "tax",
  availableModules: available,
});
const p2 = planCapabilities({
  intentCandidates: intents,
  refinedCategory: "documents",
  domainMode: "tax",
  availableModules: available,
});

assert("determinism: identical tax plan", JSON.stringify(p1) === JSON.stringify(p2));
assert("tax: 3–5 steps", p1.length >= 3 && p1.length <= 5);
assert("tax: starts with metadata_extractor", p1[0]?.moduleId === "metadata_extractor");
assert("tax: includes tagging", p1.some((s) => s.moduleId === "tagging"));
assert("tax: includes smart_rename", p1.some((s) => s.moduleId === "smart_rename"));
assert("tax: includes folder_structure", p1.some((s) => s.moduleId === "folder_structure"));
assert("tax: comparison module allowed", isModuleAllowedInDomain("tax_document_comparison", "tax"));
assert(
  "tax: default plan excludes comparison",
  !p1.some((s) => s.moduleId === "tax_document_comparison"),
);

for (const s of p1) {
  assert(`step allowed in tax: ${s.moduleId}`, isModuleAllowedInDomain(s.moduleId, "tax"));
  assert(`step registered: ${s.moduleId}`, available.includes(s.moduleId));
}

const bogus = planCapabilities({
  intentCandidates: [{ label: "x", score: 1 }],
  refinedCategory: null,
  domainMode: "tax",
  availableModules: ["metadata_extractor", "tagging"],
});
assert("short registry: plan length bounded", bogus.length >= 1 && bogus.length <= 5);

assert("domains list", listDomainIds().includes("tax") && listDomainIds().includes("game-dev"));
const taxDef = getDomainDefinition("tax");
assert("tax tag hints", Array.isArray(taxDef.tagHints) && taxDef.tagHints.length >= 2);

console.log("\nvalidateCapabilityPlanner: all checks passed.\n");

/**
 * Validates module registry contract and domain expectation references.
 * Run: node dev/validateModuleRegistry.mjs
 */
import { validateModuleRegistry, MODULE_REGISTRY } from "../workflow/modules/moduleRegistry.js";
import { domainExpectedModules } from "../workflow/moduleMapping/domainExpectedCoverage.js";

validateModuleRegistry();

for (const [domainId, spec] of Object.entries(domainExpectedModules)) {
  const req = spec?.required;
  if (!Array.isArray(req)) {
    console.error(`FAIL: domain "${domainId}" must have required: string[]`);
    process.exit(1);
  }
  for (const mid of req) {
    if (!MODULE_REGISTRY[mid]) {
      console.error(`FAIL: domain "${domainId}" references unknown module "${mid}"`);
      process.exit(1);
    }
  }
}

console.log("ok: module registry + domain expectation references");

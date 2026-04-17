/**
 * Minimum module coverage when a domain matches keyword detection.
 * Never auto-applied — clarification only. Aligned with MODULE_DISCOVERY_WORKING.md.
 *
 * Domain expectations must only reference registered modules.
 * (Future modules like task_management must not appear here until registered in workflow/modules/moduleRegistry.js.)
 */

import { REGISTERED_WORKFLOW_MODULE_IDS } from "../modules/moduleRegistry.js";

const REGISTERED = new Set(REGISTERED_WORKFLOW_MODULE_IDS);

/**
 * @typedef {{ required: string[] }} DomainExpectationSpec
 */

/**
 * @type {Record<string, DomainExpectationSpec>}
 */
export const domainExpectedModules = {
  fitness: {
    required: ["entity_tracking", "event_log"],
  },
  medical: {
    required: ["entity_tracking", "event_log"],
  },
  commerce: {
    required: ["entity_tracking", "event_log"],
  },
  project: {
    required: ["entity_tracking", "event_log"],
  },
};

/**
 * @param {string} domainId
 * @returns {string[]}
 */
export function getRequiredModulesForDomain(domainId) {
  const spec = domainExpectedModules[domainId];
  return Array.isArray(spec?.required) ? spec.required : [];
}

/**
 * Validates that every domain lists only registered module ids.
 * @param {Record<string, DomainExpectationSpec>} [obj]
 * @throws {Error} if any reference is invalid
 */
export function validateDomainExpectations(obj = domainExpectedModules) {
  const errors = [];
  for (const [domainId, spec] of Object.entries(obj)) {
    const req = spec?.required;
    if (!Array.isArray(req)) {
      errors.push(`domain "${domainId}": expected { required: string[] }`);
      continue;
    }
    for (const mid of req) {
      if (typeof mid !== "string" || !REGISTERED.has(mid)) {
        errors.push(`domain "${domainId}": invalid or unregistered module "${mid}"`);
      }
    }
  }
  if (errors.length > 0) {
    const msg = errors.join("; ");
    throw new Error(`validateDomainExpectations: ${msg}`);
  }
}

validateDomainExpectations();

/** @deprecated Use domainExpectedModules + getRequiredModulesForDomain */
export const DOMAIN_EXPECTED_MODULES = domainExpectedModules;

/**
 * Minimum module coverage when a domain (or preset) matches keyword detection.
 * Never auto-applied — clarification only. Aligned with MODULE_DISCOVERY_WORKING.md.
 *
 * Note: `task_management` is planned but not registered; project expectations use entity + event only (§3 row 8).
 */

/** @type {Record<string, string[]>} — keys match DomainModuleHint.id */
export const domainExpectedModules = {
  fitness: ["entity_tracking", "event_log"],
  medical: ["entity_tracking", "event_log"],
  commerce: ["entity_tracking", "event_log"],
  project: ["entity_tracking", "event_log"],
};

/** @deprecated Use domainExpectedModules */
export const DOMAIN_EXPECTED_MODULES = domainExpectedModules;

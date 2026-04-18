/**
 * Deterministic capability plans (controlled chaining only; no recursion or randomness).
 */

import { findBestCapability } from "./capabilityRegistry.js";
import { getDomainDefinition, isModuleAllowedInDomain } from "./domainRegistry.js";

const MAX_STEPS = 5;
const MIN_STEPS = 3;

/** Never auto-inserted into planned chains (explicit UI/API only). */
const EXPLICIT_ONLY_PLAN_MODULES = new Set([
  "tax_document_comparison",
  "fitness_image_comparison",
  "contractor_cost_tracking",
  "receipt_tracking",
]);

/**
 * @param {string[]} availableModules
 * @param {string | null | undefined} domainMode
 * @param {string} moduleId
 */
function isValidStep(availableModules, domainMode, moduleId) {
  const id = String(moduleId ?? "").trim();
  if (!id) return false;
  if (!availableModules.includes(id)) return false;
  return isModuleAllowedInDomain(id, domainMode);
}

/**
 * Prefer modules that score on intent, in stable order.
 * @param {Array<{ label?: string, score?: number | null }>} intentCandidates
 * @param {string[]} pool module ids to rank
 * @param {string[]} availableModules
 */
function rankByIntent(intentCandidates, pool, availableModules) {
  const { module, score } = findBestCapability(intentCandidates);
  /** @type {string[]} */
  const ordered = [];
  if (module != null && pool.includes(module.id) && availableModules.includes(module.id)) {
    ordered.push(module.id);
  }
  const rest = pool.filter((id) => !ordered.includes(id)).sort((a, b) => a.localeCompare(b));
  for (const id of rest) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  if (score <= 0 && ordered.length === 0 && module != null && pool.includes(module.id)) {
    return [module.id, ...rest.filter((x) => x !== module.id)];
  }
  return ordered.length ? ordered : rest;
}

/**
 * @param {{
 *   intentCandidates: Array<{ label?: string, score?: number | null }>,
 *   refinedCategory?: string | null,
 *   domainMode?: string | null,
 *   availableModules: string[],
 * }} input
 * @returns {Array<{ step: number, moduleId: string }>}
 */
export function planCapabilities(input) {
  const intentCandidates = Array.isArray(input.intentCandidates) ? input.intentCandidates : [];
  const domainMode = input.domainMode ?? null;
  const availableModules = Array.isArray(input.availableModules)
    ? [...new Set(input.availableModules.map((x) => String(x ?? "").trim()).filter(Boolean))]
        .filter((id) => !EXPLICIT_ONLY_PLAN_MODULES.has(id))
        .sort((a, b) => a.localeCompare(b))
    : [];

  const domain = getDomainDefinition(domainMode);
  /** @type {string[]} */
  let sequence = [];

  const defaultFlow = Array.isArray(domain.defaultFlow) ? domain.defaultFlow : [];
  for (const id of defaultFlow) {
    if (isValidStep(availableModules, domainMode, id) && !sequence.includes(id)) {
      sequence.push(id);
    }
  }

  if (sequence.length < MIN_STEPS) {
    const preferred = Array.isArray(domain.preferredModules) ? domain.preferredModules : [];
    const ranked = rankByIntent(intentCandidates, preferred, availableModules);
    for (const id of ranked) {
      if (isValidStep(availableModules, domainMode, id) && !sequence.includes(id)) {
        sequence.push(id);
      }
      if (sequence.length >= MIN_STEPS) break;
    }
  }

  if (sequence.length < MIN_STEPS) {
    const fillerPool = availableModules.filter((id) => isModuleAllowedInDomain(id, domainMode));
    const ranked = rankByIntent(intentCandidates, fillerPool, availableModules);
    for (const id of ranked) {
      if (!sequence.includes(id)) sequence.push(id);
      if (sequence.length >= MIN_STEPS) break;
    }
  }

  sequence = sequence.slice(0, MAX_STEPS);

  return sequence.map((moduleId, i) => ({ step: i + 1, moduleId }));
}

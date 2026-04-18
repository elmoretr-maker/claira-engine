/**
 * Registry for product capability modules only (not MODULE_REGISTRY).
 */

import { assertCapabilityModule } from "./capabilityContract.js";

/** @type {import("./capabilityContract.js").CapabilityModule[]} */
const capabilities = [];

/** Test / registerAll: clear before re-registering. */
export function clearCapabilityRegistry() {
  capabilities.length = 0;
}

/**
 * @param {import("./capabilityContract.js").CapabilityModule} module
 */
export function registerCapability(module) {
  assertCapabilityModule(module, module?.id ?? "capability");
  if (capabilities.some((c) => c.id === module.id)) {
    throw new Error(`registerCapability: duplicate id "${module.id}"`);
  }
  capabilities.push(module);
}

/**
 * @returns {readonly import("./capabilityContract.js").CapabilityModule[]}
 */
export function getCapabilities() {
  return Object.freeze([...capabilities].sort((a, b) => a.id.localeCompare(b.id)));
}

/**
 * @param {string} s
 */
function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * @param {string} a
 * @param {string} b
 */
function intentMatchScore(a, b) {
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 4;
  if (A.includes(B) || B.includes(A)) return 3;
  const wa = new Set(A.split(/[^a-z0-9]+/).filter((x) => x.length >= 2));
  const wb = new Set(B.split(/[^a-z0-9]+/).filter((x) => x.length >= 2));
  let inter = 0;
  for (const x of wa) {
    if (wb.has(x)) inter++;
  }
  if (inter === 0) return 0;
  return Math.min(2, inter);
}

/**
 * @param {Array<{ label?: string, score?: number | null }> | null | undefined} intentCandidates
 * @returns {{ module: import("./capabilityContract.js").CapabilityModule | null, score: number, breakdown: string }}
 */
export function findBestCapability(intentCandidates) {
  const cands = Array.isArray(intentCandidates) ? intentCandidates : [];
  const list = getCapabilities();

  /**
   * @param {import("./capabilityContract.js").CapabilityModule} mod
   */
  function scoreModule(mod) {
    let score = 0;
    for (const intent of mod.supportedIntents) {
      const ni = norm(intent);
      if (!ni) continue;
      for (const c of cands) {
        const lab = typeof c?.label === "string" ? c.label : "";
        score += intentMatchScore(lab, ni);
        score += intentMatchScore(lab, intent);
      }
    }
    return score;
  }

  const scored = list.map((mod) => ({ mod, score: scoreModule(mod) }));
  const max = scored.length ? Math.max(...scored.map((s) => s.score)) : 0;
  if (max <= 0) {
    return { module: null, score: 0, breakdown: "no_intent_match" };
  }
  const top = scored
    .filter((s) => s.score === max)
    .sort((a, b) => a.mod.id.localeCompare(b.mod.id));
  const bestMod = top[0]?.mod ?? null;
  if (!bestMod) {
    return { module: null, score: 0, breakdown: "no_intent_match" };
  }
  return {
    module: bestMod,
    score: max,
    breakdown: `intent_score=${max}`,
  };
}

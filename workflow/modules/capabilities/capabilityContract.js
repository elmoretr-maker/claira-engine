/**
 * Product capability modules — NOT workflow pipeline modules.
 * Separate from workflow/modules/moduleContract.js (artifact pipeline).
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   description: string,
 *   supportedIntents: string[],
 *   run: (input: Record<string, unknown>, context: CapabilityRunContext) => unknown,
 * }} CapabilityModule
 */

/**
 * @typedef {{
 *   intentCandidates: Array<{ label: string, score?: number | null }>,
 *   refinedCategory: string | null | undefined,
 *   inputData: Record<string, unknown>,
 * }} CapabilityRunContext
 */

/**
 * @param {unknown} mod
 * @param {string} [label]
 */
export function assertCapabilityModule(mod, label = "capability") {
  if (mod == null || typeof mod !== "object" || Array.isArray(mod)) {
    throw new Error(`${label}: must be a non-null object`);
  }
  const m = /** @type {Record<string, unknown>} */ (mod);
  if (typeof m.id !== "string" || !m.id.trim()) throw new Error(`${label}: id required`);
  if (typeof m.name !== "string" || !m.name.trim()) throw new Error(`${label}: name required`);
  if (typeof m.description !== "string") throw new Error(`${label}: description required`);
  if (!Array.isArray(m.supportedIntents) || !m.supportedIntents.every((x) => typeof x === "string")) {
    throw new Error(`${label}: supportedIntents must be string[]`);
  }
  if (typeof m.run !== "function") throw new Error(`${label}: run must be a function`);
}

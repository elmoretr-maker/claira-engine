/**
 * Real push to an external system (Shopify / Wix mutation APIs, etc.).
 * Set REAL_EXTERNAL_OUTPUT_READY to true only after exportToExternal performs real writes.
 */

/** Flip to true when this module is fully wired to a production API. */
export const REAL_EXTERNAL_OUTPUT_READY = false;

/**
 * @param {unknown} results
 * @param {string} [target]
 * @returns {Record<string, unknown>}
 */
export function exportToExternal(results, target) {
  if (!REAL_EXTERNAL_OUTPUT_READY) {
    throw new Error("Real external output not wired — implement in realExternalOutput.js");
  }
  throw new Error("Real external output: implement exportToExternal body");
}

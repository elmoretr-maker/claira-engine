/**
 * Real external ingestion (Shopify / Wix / etc.).
 * Set REAL_EXTERNAL_ADAPTER_READY to true only after fetchExternalData returns live API data.
 */

/** Flip to true when this module is fully wired to a production API. */
export const REAL_EXTERNAL_ADAPTER_READY = false;

/**
 * @returns {Promise<import("./baseAdapter.js").StandardInput[]>}
 */
export async function fetchExternalData() {
  if (!REAL_EXTERNAL_ADAPTER_READY) {
    throw new Error("Real external adapter not wired — implement Shopify/Wix API in realExternalAdapter.js");
  }
  throw new Error("Real external adapter: implement fetchExternalData body");
}

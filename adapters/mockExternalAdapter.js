/**
 * Mock external source (e.g. CMS / Wix-style) returning normalized items.
 */

import { registerSimulation } from "../core/simulationRegistry.js";
import { normalizeInput } from "./baseAdapter.js";

/**
 * @returns {Promise<import("./baseAdapter.js").StandardInput[]>}
 */
export async function fetchExternalData() {
  return [
    normalizeInput({
      type: "image",
      data: {
        filePath: null,
        buffer: null,
        url: "https://example.com/mock-wix-asset.png",
      },
      metadata: {
        source: "wix",
        originalName: "mock-wix-asset.png",
      },
    }),
    normalizeInput({
      type: "product",
      data: {
        filePath: null,
        buffer: null,
        url: null,
      },
      metadata: {
        source: "wix",
        originalName: "mock-product-record.json",
      },
    }),
  ];
}

registerSimulation({
  name: "mock_external_adapter",
  location: "adapters/mockExternalAdapter.js",
  description: "Simulated external data fetch (mock Wix/URL assets)",
  replaceWith: "Real external API adapter (Shopify/Wix API)",
});

/**
 * server/capabilities.js
 *
 * Capability Registry and Event → Capability Mapper for Claira.
 *
 * ─── WHAT IS A CAPABILITY? ───────────────────────────────────────────────────
 *
 * A capability is a named, documented unit of work that the Claira engine can
 * perform.  Each capability maps 1:1 to a key in CLAIRA_RUN_HANDLERS — this
 * file does NOT own the execution logic, only the metadata and routing rules.
 *
 * Capabilities let external callers (integrations, dashboards, future AI
 * agents) discover what the engine can do and what inputs are required,
 * without inspecting implementation code.
 *
 * ─── HOW MAPPING WORKS ───────────────────────────────────────────────────────
 *
 * getCapabilityForEvent(eventType, platform, payload) inspects three signals:
 *
 *   1. eventType  — the string label sent by the platform (e.g. Wix's
 *                   "wix/stores/catalog/product/created")
 *   2. platform   — the integration source (e.g. "wix", "shopify")
 *   3. payload    — the raw request body, used to detect the presence of
 *                   images or product data that changes which capability to use
 *
 * Rules are evaluated top-to-bottom and the first match wins.  This keeps the
 * function predictable and easy to extend without hidden fallback chains.
 *
 * ─── EXTENSIBILITY ───────────────────────────────────────────────────────────
 *
 * To add a new capability:
 *   1. Add its entry to the `capabilities` map below.
 *   2. Add matching rules to getCapabilityForEvent (or a new platform helper).
 *   3. The corresponding CLAIRA_RUN_HANDLERS key must already exist (or be
 *      added separately) — this file never touches handler logic.
 */

// =============================================================================
// CAPABILITY REGISTRY
// =============================================================================

/**
 * A record describing a single engine capability.
 *
 * @typedef {{
 *   description: string,
 *   input:  string[],
 *   output: string[],
 * }} CapabilityRecord
 */

/**
 * Registry of all known Claira capabilities.
 *
 * Keys match the `kind` field used in CLAIRA_RUN_HANDLERS.
 * This object is read-only at runtime — nothing should mutate it.
 *
 * @type {Readonly<Record<string, CapabilityRecord>>}
 */
export const capabilities = Object.freeze({
  ingestData: {
    description: "Ingest structured or webhook data into the Claira engine",
    input:  ["json", "webhook"],
    output: ["structuredData"],
  },
  processFolder: {
    description: "Analyse a local folder's contents and classify assets",
    input:  ["folder"],
    output: ["analysis"],
  },
  processData: {
    description: "Process and classify structured data payloads",
    input:  ["json"],
    output: ["classification", "analysis"],
  },
  getRiskInsights: {
    description: "Generate risk insights from the current engine state",
    input:  ["data"],
    output: ["insights"],
  },
  buildProductCatalog: {
    description: "Convert raw product images into a structured, platform-ready catalog",
    input:  ["images", "folder", "productData"],
    output: ["products", "fileStructure"],
  },
  getRooms: {
    description: "Retrieve classified room results",
    input:  ["data"],
    output: ["rooms"],
  },
  getSuggestions: {
    description: "Generate AI-driven suggestions from current state",
    input:  ["data"],
    output: ["suggestions"],
  },
  loadIndustryPack: {
    description: "Activate an industry configuration pack",
    input:  ["industryId"],
    output: ["packConfig"],
  },
  workspaceScan: {
    description: "Scan workspace for assets and generate a read model",
    input:  ["folder"],
    output: ["workspaceReadModel"],
  },
});

// =============================================================================
// INTERNAL: image detection
// =============================================================================

/**
 * Wix event type strings that indicate a product lifecycle event.
 * Checked as prefix/substring matches to be tolerant of minor variations.
 */
const PRODUCT_EVENT_PATTERNS = [
  "catalog/product",
  "wix/stores/catalog/product",
  "product-created",
  "product-updated",
  "product-deleted",
  "product/created",
  "product/updated",
  "product/deleted",
];

/**
 * Return true if the event type string matches any known product event pattern.
 * Case-insensitive.
 * @param {string | null | undefined} eventType
 */
function isProductEvent(eventType) {
  if (!eventType) return false;
  const lower = eventType.toLowerCase();
  return PRODUCT_EVENT_PATTERNS.some((pat) => lower.includes(pat.toLowerCase()));
}

/**
 * Return true if the payload contains image data in any recognised location:
 *   - top-level `images` array with at least one entry
 *   - `productData.images`, `productData.media`, `productData.mediaItems`
 *   - `productData.image` string starting with "http"
 *
 * @param {Record<string, any>} payload
 */
function hasImageData(payload) {
  if (!payload || typeof payload !== "object") return false;

  // Direct image array on payload.
  if (Array.isArray(payload.images) && payload.images.length > 0) return true;

  const pd = payload.productData;
  if (!pd || typeof pd !== "object") return false;

  // Normalise to array of product records.
  const records = Array.isArray(pd) ? pd : [pd];

  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    if (typeof rec.image === "string" && rec.image.startsWith("http")) return true;
    if (rec.media?.mainMedia?.url) return true;
    if (Array.isArray(rec.mediaItems) && rec.mediaItems.length > 0) return true;
    if (Array.isArray(rec.images) && rec.images.length > 0) return true;
  }

  return false;
}

// =============================================================================
// PUBLIC: getCapabilityForEvent
// =============================================================================

/**
 * Map an inbound platform event to the most appropriate Claira capability.
 *
 * Returns a capability key (matching a key in `capabilities` and a key in
 * CLAIRA_RUN_HANDLERS), or `null` if no capability applies to this event.
 *
 * Decision logic:
 *   1. Product event + image data  → "buildProductCatalog"
 *      (images are present — run the full catalog builder + image pipeline)
 *   2. Product event, no images   → "ingestData"
 *      (product metadata but no images — still worth ingesting)
 *   3. Any payload with product data, no product event  → "ingestData"
 *      (catch-all for platform data we understand structurally)
 *   4. Everything else            → null
 *      (unrecognised event; caller decides how to handle)
 *
 * @param {string | null | undefined}     eventType  Platform event label.
 * @param {string | null | undefined}     platform   Source platform ("wix", "shopify", …).
 * @param {Record<string, any>}           payload    Raw request body.
 * @returns {keyof typeof capabilities | null}
 *
 * @example
 * // Wix product-created webhook with images → build catalog
 * getCapabilityForEvent("wix/stores/catalog/product/created", "wix", { productData: { images: ["https://…"] } })
 * // → "buildProductCatalog"
 *
 * @example
 * // Wix product-created webhook without images → ingest
 * getCapabilityForEvent("wix/stores/catalog/product/created", "wix", { productData: { name: "Wallet" } })
 * // → "ingestData"
 *
 * @example
 * // Unknown event type
 * getCapabilityForEvent("site/published", "wix", {})
 * // → null
 */
export function getCapabilityForEvent(eventType, platform, payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};

  // ── Rule 1: product event + images → full catalog pipeline ───────────────
  if (isProductEvent(eventType) && hasImageData(safePayload)) {
    return "buildProductCatalog";
  }

  // ── Rule 2: product event, no images → ingest metadata ───────────────────
  if (isProductEvent(eventType)) {
    return "ingestData";
  }

  // ── Rule 3: non-product event but product data present → ingest ───────────
  if (safePayload.productData != null) {
    return "ingestData";
  }

  // ── Rule 4: unrecognised ──────────────────────────────────────────────────
  return null;
}

// =============================================================================
// PUBLIC: describeCapability
// =============================================================================

/**
 * Return the registry entry for a capability key, or null if not found.
 * Safe to call with any string — never throws.
 *
 * @param {string} key
 * @returns {CapabilityRecord | null}
 */
export function describeCapability(key) {
  return Object.prototype.hasOwnProperty.call(capabilities, key)
    ? capabilities[key]
    : null;
}

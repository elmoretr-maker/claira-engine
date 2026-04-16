/**
 * Per-module keyword lists for deterministic composition (no global keyword table).
 * Matching: substring search on normalized build text (industryName + buildIntent), lowercased.
 */

/** @type {Record<string, { keywords: string[] }>} */
export const MODULE_KEYWORD_MAP = {
  entity_tracking: {
    keywords: ["client", "user", "person", "customer", "member", "patient", "record", "people", "contact"],
  },
  asset_registry: {
    keywords: ["image", "photo", "upload", "file", "picture", "scan", "document", "attachment", "media"],
  },
  event_log: {
    keywords: ["timeline", "history", "log", "activity", "track", "progress", "journal", "notes", "session"],
  },
};

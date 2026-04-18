/**
 * When true, listIndustryPacks includes invalid packs with diagnostics (dev/staging).
 * Production builds must hide broken packs from the catalog.
 * @returns {boolean}
 */
export function isPackDiagnosticsMode() {
  return process.env.NODE_ENV !== "production";
}

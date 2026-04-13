/**
 * Canonical on-disk snapshot: entityId, timestamp, rawData, extractedSignals.
 * Hydration merges legacy files (imagePath + extractedData) for consumers.
 */

/**
 * @param {unknown} snap
 * @returns {Record<string, unknown> | null}
 */
export function hydrateSnapshot(snap) {
  if (!snap || typeof snap !== "object" || Array.isArray(snap)) return null;
  const s = /** @type {Record<string, unknown>} */ (snap);

  if ("rawData" in s && "extractedSignals" in s) {
    const raw = s.rawData && typeof s.rawData === "object" && !Array.isArray(s.rawData) ? /** @type {Record<string, unknown>} */ (s.rawData) : {};
    const sig =
      s.extractedSignals && typeof s.extractedSignals === "object" && !Array.isArray(s.extractedSignals)
        ? /** @type {Record<string, unknown>} */ (s.extractedSignals)
        : {};
    const manual =
      raw.manualMetrics && typeof raw.manualMetrics === "object" && !Array.isArray(raw.manualMetrics)
        ? /** @type {Record<string, number>} */ (raw.manualMetrics)
        : {};
    const imagePath = typeof raw.imagePath === "string" && raw.imagePath.length > 0 ? raw.imagePath : null;
    return {
      ...s,
      imagePath,
      extractedData: { ...sig, manualMetrics: manual },
    };
  }

  /** Legacy: top-level imagePath + extractedData */
  return { ...s };
}

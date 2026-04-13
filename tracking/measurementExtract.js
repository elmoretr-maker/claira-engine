/**
 * Extracts flexible visual + structural signals from normalized tracking images (dimensions, aspect, layout).
 * Optional category/industry are reserved for future signal selection; core output is domain-agnostic.
 */

import { existsSync } from "fs";

/**
 * @param {string} absPath — should be normalized PNG from imageNormalize
 * @param {string} [_categoryKey]
 * @param {string} [_industrySlug]
 * @param {Record<string, unknown> | null} [normalizationMeta] — merged into normalization on the snapshot’s extractedSignals
 */
export async function extractMeasurementsFromImage(absPath, _categoryKey, _industrySlug, normalizationMeta = null) {
  /** @type {Record<string, unknown>} */
  const extractedData = {
    proportions: null,
    sizeRatios: null,
    structuralDifferences: null,
    imageMeta: null,
    normalized: null,
    ratios: null,
    normalization: normalizationMeta && typeof normalizationMeta === "object" ? { ...normalizationMeta } : null,
  };
  if (!absPath || !existsSync(absPath)) {
    return extractedData;
  }
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(absPath).metadata();
    const w = typeof meta.width === "number" ? meta.width : 0;
    const h = typeof meta.height === "number" ? meta.height : 0;
    extractedData.imageMeta = {
      width: w,
      height: h,
      format: meta.format ?? null,
      orientation: meta.orientation ?? null,
      normalizedPipeline: true,
    };
    extractedData.normalized = {
      width: w,
      height: h,
      widthOverHeight: w > 0 && h > 0 ? Math.round((w / h) * 10000) / 10000 : null,
    };
    if (w > 0 && h > 0) {
      const ratio = w / h;
      extractedData.proportions = {
        widthOverHeight: Math.round(ratio * 10000) / 10000,
        portraitBias: ratio < 1 ? 1 / ratio : ratio,
      };
      extractedData.sizeRatios = {
        longSide: Math.max(w, h),
        shortSide: Math.min(w, h),
        longOverShort: Math.round((Math.max(w, h) / Math.min(w, h)) * 10000) / 10000,
      };
      extractedData.structuralDifferences = {
        orientation: w >= h ? "landscape" : "portrait",
        megapixels: Math.round(((w * h) / 1e6) * 1000) / 1000,
      };
      const src = extractedData.normalization && typeof extractedData.normalization === "object"
        ? /** @type {{ sourceAspect?: number | null, sourceLongEdge?: number }} */ (extractedData.normalization)
        : {};
      extractedData.ratios = {
        canvasWidthOverHeight: Math.round(ratio * 10000) / 10000,
        sourceAspectRecorded: typeof src.sourceAspect === "number" ? src.sourceAspect : null,
        sourceLongEdgeRecorded: typeof src.sourceLongEdge === "number" ? src.sourceLongEdge : null,
      };
    }
  } catch {
    extractedData.imageMeta = { error: "could_not_read_image" };
  }
  return extractedData;
}

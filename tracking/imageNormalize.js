/**
 * Normalize tracking photos for comparable geometry (sharp only; no classifier).
 * Standard canvas + EXIF orientation; "centering" via contain + centre gravity on fixed canvas.
 */

import { existsSync, unlinkSync } from "fs";

/** Long edge target; short edge scales with aspect (contain). */
export const NORMALIZED_LONG_EDGE = 1024;
export const NORMALIZED_SHORT_EDGE = 768;

/**
 * Resize to fit inside NORMALIZED_SHORT_EDGE x NORMALIZED_LONG_EDGE, letterbox to exact canvas.
 * @param {string} inputPath
 * @param {string} outputPath — normalized PNG path
 * @returns {Promise<{
 *   standardWidth: number,
 *   standardHeight: number,
 *   sourceWidth: number,
 *   sourceHeight: number,
 *   sourceAspect: number | null,
 *   sourceLongEdge: number,
 *   innerWidth: number | null,
 *   innerHeight: number | null,
 * }>}
 */
export async function normalizeTrackingImage(inputPath, outputPath) {
  const sharp = (await import("sharp")).default;
  if (!existsSync(inputPath)) {
    throw new Error("normalizeTrackingImage: input missing");
  }

  const orientedMeta = await sharp(inputPath).rotate().metadata();
  const ow = typeof orientedMeta.width === "number" ? orientedMeta.width : 0;
  const oh = typeof orientedMeta.height === "number" ? orientedMeta.height : 0;
  const sourceAspect = ow > 0 && oh > 0 ? ow / oh : null;
  const sourceLongEdge = ow > 0 && oh > 0 ? Math.max(ow, oh) : 0;

  const STD_W = NORMALIZED_SHORT_EDGE;
  const STD_H = NORMALIZED_LONG_EDGE;

  const buf = await sharp(inputPath)
    .rotate()
    .resize(STD_W, STD_H, {
      fit: "contain",
      position: "centre",
      background: { r: 245, g: 245, b: 245 },
    })
    .png()
    .toBuffer();

  await sharp(buf).toFile(outputPath);

  const inner = await sharp(buf).metadata();
  const iw = typeof inner.width === "number" ? inner.width : null;
  const ih = typeof inner.height === "number" ? inner.height : null;

  return {
    standardWidth: STD_W,
    standardHeight: STD_H,
    sourceWidth: ow,
    sourceHeight: oh,
    sourceAspect,
    sourceLongEdge,
    innerWidth: iw,
    innerHeight: ih,
  };
}

/**
 * @param {string} path
 */
export function safeUnlink(path) {
  try {
    if (path && existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
  }
}

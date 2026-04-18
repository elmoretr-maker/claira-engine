/**
 * Compare two images — read-only. Uses sharp only (no pixelmatch dependency).
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { assertCapabilityModule } from "./capabilityContract.js";

/**
 * @param {string} p
 * @param {string} cwd
 */
function resolvePath(p, cwd) {
  const s = String(p ?? "").trim();
  if (!s) return "";
  return path.isAbsolute(s) ? s : path.resolve(cwd, s);
}

/**
 * @param {Buffer} a
 * @param {Buffer} b
 * @param {number} width
 * @param {number} height
 */
function diffBuffersRGBA(a, b, width, height) {
  const pixels = width * height;
  let diffPixels = 0;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2] || a[o + 3] !== b[o + 3]) {
      diffPixels++;
    }
  }
  const changePercentage = pixels > 0 ? Number(((100 * diffPixels) / pixels).toFixed(4)) : 0;
  const differenceScore = pixels > 0 ? Number((diffPixels / pixels).toFixed(6)) : 0;
  return { differenceScore, changePercentage, diffPixels, totalPixels: pixels };
}

export const imageDiffModule = {
  id: "image_diff",
  name: "Image difference",
  description: "Pixel-level comparison of two images (read-only).",
  supportedIntents: ["compare", "difference", "diff", "image diff", "similarity", "visual diff"],

  /**
   * @param {Record<string, unknown>} input
   * @param {import("./capabilityContract.js").CapabilityRunContext} context
   */
  async run(input, context) {
    const cwd = String(input.cwd ?? context.inputData?.cwd ?? process.cwd());
    const pathA = resolvePath(
      String(input.primaryFile ?? input.pathA ?? input.imageA ?? "").trim(),
      cwd,
    );
    const pathB = resolvePath(
      String(input.secondaryFile ?? input.pathB ?? input.imageB ?? "").trim(),
      cwd,
    );

    if (!pathA || !pathB) {
      return {
        differenceScore: null,
        changePercentage: null,
        width: 0,
        height: 0,
        summary: !pathA
          ? "Missing primaryFile (or pathA): no file path on this row."
          : "Missing secondaryFile: only one file in batch — add another asset or compare session with 2+ files (secondary defaults to next row).",
      };
    }
    if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) {
      return {
        differenceScore: null,
        changePercentage: null,
        width: 0,
        height: 0,
        summary: "One or both image paths do not exist.",
      };
    }

    const ma = await sharp(pathA).metadata();
    const mb = await sharp(pathB).metadata();
    const wa = ma.width ?? 0;
    const ha = ma.height ?? 0;
    const wb = mb.width ?? 0;
    const hb = mb.height ?? 0;
    const w = Math.min(wa, wb) || wa || wb;
    const h = Math.min(ha, hb) || ha || hb;
    if (w <= 0 || h <= 0) {
      return {
        differenceScore: null,
        changePercentage: null,
        width: 0,
        height: 0,
        summary: "Could not read image dimensions.",
      };
    }

    const bufA = await sharp(pathA)
      .resize(w, h, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const bufB = await sharp(pathB)
      .resize(w, h, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer();

    const { differenceScore, changePercentage, diffPixels, totalPixels } = diffBuffersRGBA(bufA, bufB, w, h);

    return {
      differenceScore,
      changePercentage,
      width: w,
      height: h,
      diffSummary: `${diffPixels} / ${totalPixels} pixels differ`,
    };
  },
};

assertCapabilityModule(imageDiffModule, "imageDiffModule");

/**
 * Compare fitness/progress images (read-only). Sharp pipeline duplicated from image_diff
 * (imageDiffModule is not modified per project rules).
 */

import sharp from "sharp";
import { assertCapabilityModule } from "./capabilityContract.js";
import { getDomainDefinition } from "./domainRegistry.js";
import { assertFitnessImagePathUnderCwd } from "./fitnessImagePathUnderCwd.js";

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
  const totalPixels = pixels;
  const normalizedDiff = totalPixels > 0 ? Number((diffPixels / totalPixels).toFixed(8)) : 0;
  return { diffPixels, totalPixels, normalizedDiff };
}

/**
 * @param {number} similarityScore
 * @returns {"Minimal change" | "Moderate progress" | "Significant transformation"}
 */
export function insightLabelFromSimilarity(similarityScore) {
  if (similarityScore > 0.95) return "Minimal change";
  if (similarityScore >= 0.8) return "Moderate progress";
  return "Significant transformation";
}

/**
 * @param {string} cwd
 * @param {string} pathA
 * @param {string} pathB
 * @returns {Promise<
 *   | { ok: true, absA: string, absB: string, comparisonResult: Record<string, unknown>, pairSummary: string }
 *   | { ok: false, message: string, summary: string }
 * >}
 */
async function compareOneFitnessPair(cwd, pathA, pathB) {
  if (!pathA || !pathB) {
    return { ok: false, message: "fitness_image_comparison: pathA and pathB required", summary: "Select two images." };
  }
  if (pathA === pathB) {
    return { ok: false, message: "fitness_image_comparison: paths must differ", summary: "Choose two different image files." };
  }

  let absA;
  let absB;
  try {
    absA = assertFitnessImagePathUnderCwd(cwd, pathA).absPath;
    absB = assertFitnessImagePathUnderCwd(cwd, pathB).absPath;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg, summary: msg };
  }

  const ma = await sharp(absA).metadata();
  const mb = await sharp(absB).metadata();
  const wa = ma.width ?? 0;
  const ha = ma.height ?? 0;
  const wb = mb.width ?? 0;
  const hb = mb.height ?? 0;
  const w = Math.min(wa, wb) || wa || wb;
  const h = Math.min(ha, hb) || ha || hb;
  if (w <= 0 || h <= 0) {
    return {
      ok: false,
      message: "fitness_image_comparison: invalid dimensions",
      summary: "Could not read image dimensions.",
    };
  }

  const bufA = await sharp(absA)
    .resize(w, h, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const bufB = await sharp(absB)
    .resize(w, h, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  const { normalizedDiff, diffPixels, totalPixels } = diffBuffersRGBA(bufA, bufB, w, h);
  const similarityScore = Number((1 - normalizedDiff).toFixed(6));
  const changeDetected = normalizedDiff > 0.001;
  const confidence = Number(Math.min(0.99, 0.5 + 0.49 * Math.abs(2 * similarityScore - 1)).toFixed(4));
  const insightLabel = insightLabelFromSimilarity(similarityScore);

  const comparisonResult = {
    similarityScore,
    changeDetected,
    confidence,
    insightLabel,
    normalizedDiff,
    width: w,
    height: h,
    diffPixels,
    totalPixels,
  };

  const pairSummary = `Compared ${w}×${h} · ${diffPixels}/${totalPixels} pixels differ · similarity ${similarityScore}`;
  return { ok: true, absA, absB, comparisonResult, pairSummary };
}

/**
 * @param {unknown} raw
 * @returns {{ stageA: string, stageB: string, pathA: string, pathB: string }[] | null}
 */
function normalizeImagePairsInput(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  /** @type {{ stageA: string, stageB: string, pathA: string, pathB: string }[]} */
  const out = [];
  for (const row of raw) {
    if (row == null || typeof row !== "object" || Array.isArray(row)) continue;
    const rec = /** @type {Record<string, unknown>} */ (row);
    const pathA = String(rec.pathA ?? "").trim();
    const pathB = String(rec.pathB ?? "").trim();
    const stageA = String(rec.stageA ?? "").trim();
    const stageB = String(rec.stageB ?? "").trim();
    if (!pathA || !pathB) continue;
    out.push({ stageA, stageB, pathA, pathB });
  }
  return out.length ? out : null;
}

/**
 * @typedef {object} FitnessImageComparisonRunInput
 * @property {string} [cwd] Workspace root used to resolve relative image paths.
 * @property {string} [pathA] First image path (single-pair mode).
 * @property {string} [pathB] Second image path.
 * @property {string} [stageA] Optional label for the first image/stage.
 * @property {string} [stageB] Optional label for the second image/stage.
 * @property {string} [primaryFile] Alias for pathA.
 * @property {string} [secondaryFile] Alias for pathB.
 * @property {Array<{ stageA?: string, stageB?: string, pathA?: string, pathB?: string }>} [imagePairs] Multiple ordered pairs (multi-pair mode).
 */

export const fitnessImageComparisonModule = {
  id: "fitness_image_comparison",
  name: "Fitness image comparison",
  description:
    "Pairwise pixel comparison of two progress images (read-only; fitness or contractor timeline domains).",
  supportedIntents: ["fitness compare", "progress compare", "before after", "body comparison", "room progress compare"],

  /**
   * @param {FitnessImageComparisonRunInput} input
   * @param {import("./capabilityContract.js").CapabilityRunContext} context
   */
  async run(input, context) {
    const dm =
      context.inputData != null &&
      typeof context.inputData === "object" &&
      !Array.isArray(context.inputData) &&
      typeof /** @type {{ domainMode?: string }} */ (context.inputData).domainMode === "string"
        ? String(/** @type {{ domainMode?: string }} */ (context.inputData).domainMode).trim()
        : "";
    const domainId = getDomainDefinition(dm).id;
    if (domainId !== "fitness" && domainId !== "contractor") {
      return {
        error: true,
        message: "fitness_image_comparison: requires domainMode fitness or contractor",
        summary: "Switch capability domain to Fitness or General Contractor to use this module.",
      };
    }

    const cwd =
      typeof input.cwd === "string" && input.cwd.trim()
        ? input.cwd.trim()
        : typeof context.inputData?.cwd === "string"
          ? String(context.inputData.cwd).trim()
          : process.cwd();

    const fromPairs = normalizeImagePairsInput(input.imagePairs);
    /** @type {{ stageA: string, stageB: string, pathA: string, pathB: string }[]} */
    let pairs;
    if (fromPairs) {
      pairs = fromPairs;
    } else {
      const pathA = String(input.pathA ?? input.primaryFile ?? "").trim();
      const pathB = String(input.pathB ?? input.secondaryFile ?? "").trim();
      const stageA = String(input.stageA ?? "").trim();
      const stageB = String(input.stageB ?? "").trim();
      pairs = [{ stageA, stageB, pathA, pathB }];
    }

    /** @type {{ stageA: string, stageB: string, result: Record<string, unknown> }[]} */
    const comparisons = [];
    /** @type {{ label: string, similarityScore: number, changeDetected: boolean, confidence: number, insightLabel: string }[]} */
    const items = [];

    let firstAbsA = "";
    let firstAbsB = "";
    /** @type {Record<string, unknown> | null} */
    let firstFull = null;

    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      const one = await compareOneFitnessPair(cwd, p.pathA, p.pathB);
      if (!one.ok) {
        return {
          error: true,
          message: one.message,
          summary: pairs.length > 1 ? `${one.summary} (pair ${i + 1}/${pairs.length}: ${p.stageA} → ${p.stageB})` : one.summary,
        };
      }
      const cr = /** @type {Record<string, unknown>} */ (one.comparisonResult);
      const slim = {
        similarityScore: cr.similarityScore,
        changeDetected: cr.changeDetected,
        confidence: cr.confidence,
        insightLabel: cr.insightLabel,
      };
      comparisons.push({ stageA: p.stageA, stageB: p.stageB, result: slim });
      items.push({
        label: `${p.stageA || "A"} → ${p.stageB || "B"}`,
        similarityScore: /** @type {number} */ (cr.similarityScore),
        changeDetected: /** @type {boolean} */ (cr.changeDetected),
        confidence: /** @type {number} */ (cr.confidence),
        insightLabel: /** @type {string} */ (cr.insightLabel),
      });
      if (i === 0) {
        firstAbsA = one.absA;
        firstAbsB = one.absB;
        firstFull = cr;
      }
    }

    if (!firstFull) {
      return {
        error: true,
        message: "fitness_image_comparison: no pairs to compare",
        summary: "No image pairs provided.",
      };
    }

    const n = comparisons.length;
    const summaryText =
      n > 1
        ? `${n} pairwise comparisons · first pair similarity ${firstFull.similarityScore}`
        : pairSummaryFromFull(/** @type {Record<string, unknown>} */ (firstFull), firstAbsA, firstAbsB);

    return {
      summary: summaryText,
      pathA: firstAbsA,
      pathB: firstAbsB,
      width: firstFull.width,
      height: firstFull.height,
      normalizedDiff: firstFull.normalizedDiff,
      diffPixels: firstFull.diffPixels,
      totalPixels: firstFull.totalPixels,
      similarityScore: firstFull.similarityScore,
      changeDetected: firstFull.changeDetected,
      confidence: firstFull.confidence,
      insightLabel: firstFull.insightLabel,
      comparisons,
      items,
    };
  },
};

/**
 * @param {Record<string, unknown>} full
 * @param {string} absA
 * @param {string} absB
 */
function pairSummaryFromFull(full, _absA, _absB) {
  const w = full.width;
  const h = full.height;
  const dp = full.diffPixels;
  const tp = full.totalPixels;
  const sim = full.similarityScore;
  return `Compared ${w}×${h} · ${dp}/${tp} pixels differ · similarity ${sim}`;
}

assertCapabilityModule(fitnessImageComparisonModule, "fitnessImageComparisonModule");

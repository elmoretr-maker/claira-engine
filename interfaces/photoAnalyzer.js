/**
 * interfaces/photoAnalyzer.js
 *
 * Photo quality analysis for the "analyzePhotos" capability.
 *
 * Uses:
 *   - sharp  — pixel-level blur (Laplacian variance) and resolution
 *   - CLIP   — semantic label signals (portrait, smile, blur hint)
 *
 * Does NOT re-implement the CLIP pipeline. Receives already-computed CLIP
 * analysis results and enriches them with pixel-level quality data.
 */

import sharp from "sharp";
import { readFile } from "fs/promises";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** CLIP label fragments that suggest a person is visible. */
const PORTRAIT_TOKENS = new Set([
  "person", "people", "face", "portrait", "selfie",
  "man", "woman", "child", "human", "boy", "girl",
  "smile", "smiling",
]);

/** CLIP label fragments that suggest a smile / positive expression. */
const SMILE_TOKENS = new Set([
  "smile", "smiling", "happy", "laughing", "joy", "cheerful", "grin",
]);

/** CLIP label fragments that hint at blur (fallback — sharp metrics take priority). */
const BLUR_TOKENS = new Set([
  "blur", "blurry", "unfocused", "out-of-focus", "hazy", "foggy",
]);

// ---------------------------------------------------------------------------
// Laplacian variance — sharpness metric
// ---------------------------------------------------------------------------

/**
 * Compute the Laplacian variance of a grayscale pixel buffer.
 * Higher values indicate sharper images; near-zero indicates blur.
 *
 * Uses a sparse sample (step=2 in each axis) for speed on large images.
 *
 * @param {Buffer | Uint8Array} data  Raw 8-bit grayscale pixel values (row-major)
 * @param {number} width
 * @param {number} height
 * @returns {number}  Variance in [0, ∞)
 */
function laplacianVariance(data, width, height) {
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  // Skip the 1-pixel border so the 3×3 kernel never goes out of bounds.
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const c = data[y * width + x];
      // Discrete Laplacian (8-connected)
      const lap =
        8 * c
        - data[(y - 1) * width + x]
        - data[(y + 1) * width + x]
        - data[y * width + (x - 1)]
        - data[y * width + (x + 1)]
        - data[(y - 1) * width + (x - 1)]
        - data[(y - 1) * width + (x + 1)]
        - data[(y + 1) * width + (x - 1)]
        - data[(y + 1) * width + (x + 1)];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}

// ---------------------------------------------------------------------------
// Public: assessImageQuality
// ---------------------------------------------------------------------------

/**
 * Assess the pixel-level quality of a single image.
 *
 * Downloads URLs; reads local file paths directly. Resizes to at most
 * 512px on the longest side before computing sharpness to keep it fast.
 *
 * @param {string} src  HTTP(S) URL or absolute local file path
 * @returns {Promise<{
 *   sharpness:  number,   // 0 (blurry) – 1 (sharp)
 *   resolution: number,   // total pixels (width × height)
 *   width:      number,
 *   height:     number,
 * }>}
 */
export async function assessImageQuality(src) {
  const FALLBACK = { sharpness: 0.5, resolution: 0, width: 0, height: 0 };

  try {
    let buf;
    if (src.startsWith("http://") || src.startsWith("https://")) {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${src}`);
      buf = Buffer.from(await res.arrayBuffer());
    } else {
      buf = await readFile(src);
    }

    const img = sharp(buf);
    const meta = await img.metadata();
    const origW = meta.width ?? 0;
    const origH = meta.height ?? 0;
    if (origW === 0 || origH === 0) return FALLBACK;

    // Downscale for speed (sharpness metric doesn't need full resolution).
    const scale = Math.min(1, 512 / Math.max(origW, origH));
    const sW = Math.max(1, Math.round(origW * scale));
    const sH = Math.max(1, Math.round(origH * scale));

    const { data, info } = await img
      .resize({ width: sW, height: sH, fit: "inside" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const variance = laplacianVariance(data, info.width, info.height);

    // Empirical normalization:
    //   variance < 50  → blurry   → sharpness ≈ 0.0–0.25
    //   variance 50–300 → average → sharpness ≈ 0.25–0.7
    //   variance > 300  → sharp   → sharpness ≈ 0.7–1.0
    const sharpness = Math.min(1, Math.max(0, variance / 300));

    return {
      sharpness,
      resolution: origW * origH,
      width:  origW,
      height: origH,
    };
  } catch {
    return FALLBACK;
  }
}

// ---------------------------------------------------------------------------
// Public: inferPhotoLabels
// ---------------------------------------------------------------------------

/**
 * Derive human-readable photo tags from CLIP classification + pixel metrics.
 *
 * @param {Record<string, any> | null} clipResult  Single image CLIP analysis object
 * @param {{ sharpness: number, resolution: number }} quality
 * @returns {string[]}  Deduplicated label array
 */
export function inferPhotoLabels(clipResult, quality) {
  /** @type {Set<string>} */
  const labels = new Set();

  // ── Blur / sharpness ──────────────────────────────────────────────────────
  if (quality.sharpness < 0.2) {
    labels.add("blurry");
  } else if (quality.sharpness >= 0.7) {
    labels.add("sharp");
  }

  // ── Resolution ────────────────────────────────────────────────────────────
  if (quality.resolution > 0) {
    if (quality.resolution >= 8_000_000) {
      labels.add("high-res");
    } else if (quality.resolution < 500_000) {
      labels.add("low-res");
    }
  }

  // ── CLIP semantic labels ───────────────────────────────────────────────────
  const clipLabel = (
    clipResult?.classification?.predicted_label ??
    clipResult?.label ??
    ""
  ).toLowerCase();

  const clipConf = clipResult?.classification?.confidence ?? clipResult?.confidence ?? 0;

  if (clipLabel) {
    // Split on common separators so "leather-wallet" → ["leather", "wallet"]
    const tokens = clipLabel.split(/[-_\s]+/);

    if (tokens.some((t) => PORTRAIT_TOKENS.has(t))) labels.add("portrait");
    if (tokens.some((t) => SMILE_TOKENS.has(t))) labels.add("smile");
    if (tokens.some((t) => BLUR_TOKENS.has(t)) && !labels.has("blurry")) labels.add("blurry");
  }

  // High CLIP confidence = image was clearly recognized = generally good quality
  if (clipConf >= 0.82) labels.add("well-exposed");

  return Array.from(labels);
}

// ---------------------------------------------------------------------------
// Public: computePhotoScore
// ---------------------------------------------------------------------------

/**
 * Compute a composite quality score in [0, 1].
 *
 * Weights (tunable):
 *   45 % sharpness  (pixel metric)
 *   25 % resolution (normalized to 12 MP ceiling)
 *   30 % CLIP confidence (proxy for overall image clarity)
 *
 * Label adjustments applied after the weighted sum.
 *
 * @param {string[]} labels
 * @param {{ sharpness: number, resolution: number }} quality
 * @param {number} clipConfidence  Raw confidence from CLIP, 0–1
 * @returns {number}
 */
export function computePhotoScore(labels, quality, clipConfidence) {
  const sharpPart = quality.sharpness;
  const resPart = quality.resolution > 0
    ? Math.min(1, quality.resolution / 12_000_000)
    : 0.5; // unknown resolution → neutral
  const clipPart = Math.min(1, Math.max(0, clipConfidence));

  let score = 0.45 * sharpPart + 0.25 * resPart + 0.30 * clipPart;

  // Penalties
  if (labels.includes("blurry"))   score -= 0.25;
  if (labels.includes("low-res"))  score -= 0.10;

  // Bonuses
  if (labels.includes("high-res"))      score += 0.05;
  if (labels.includes("well-exposed"))  score += 0.05;

  return Math.min(1, Math.max(0, score));
}

// ---------------------------------------------------------------------------
// Public: groupPhotoResults
// ---------------------------------------------------------------------------

/**
 * Sort and group analyzed photo results into quality tiers.
 *
 * Thresholds (score):
 *   best  ≥ 0.65
 *   good  0.35 – 0.64
 *   poor  < 0.35
 *
 * @param {Array<{ image: string, score: number, labels: string[], quality: object }>} results
 * @returns {{ best: typeof results, good: typeof results, poor: typeof results }}
 */
export function groupPhotoResults(results) {
  const sorted = [...results].sort((a, b) => b.score - a.score);
  return {
    best: sorted.filter((r) => r.score >= 0.65),
    good: sorted.filter((r) => r.score >= 0.35 && r.score < 0.65),
    poor: sorted.filter((r) => r.score < 0.35),
  };
}

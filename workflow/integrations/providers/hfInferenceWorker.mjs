/**
 * Child-process worker: CLIP zero-shot image classification (openai/clip-vit-base-patch32 equivalent).
 * Serverless `api-inference.huggingface.co/models/...` routes for CLIP are no longer available, and Hub
 * has no inference-provider mapping for hosted zero-shot CLIP; we run the same architecture via
 * transformers.js (@xenova/transformers) with ONNX weights (Xenova/clip-vit-base-patch32).
 *
 * Single JSON line to stdout: { ok: true, result } | { ok: false, reason?, error? }
 * Exit code 0 always; parent treats ok !== true as fallback to heuristic.
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "@xenova/transformers";

/** Hub-aligned CLIP ViT-B/32 ONNX model (matches openai/clip-vit-base-patch32). */
const XENOVA_CLIP_MODEL = process.env.HF_CLIP_MODEL || "Xenova/clip-vit-base-patch32";

/** Display / contract string (Phase 8 + deliverables). */
const DISPLAY_MODEL_ID = "openai/clip-vit-base-patch32";

const CANDIDATE_LABELS = [
  "a natural photograph",
  "a scanned document",
  "a digital screenshot",
  "a business invoice or form",
  "a video game asset",
];

/** @type {Promise<import("@xenova/transformers").Pipeline> | null} */
let classifierPromise = null;

function getClassifier() {
  if (!classifierPromise) {
    classifierPromise = pipeline("zero-shot-image-classification", XENOVA_CLIP_MODEL);
  }
  return classifierPromise;
}

/**
 * @param {unknown} data
 * @returns {Array<{ label: string, score: number }>}
 */
function parseZeroShotResponse(data) {
  if (Array.isArray(data)) {
    return data
      .map((row) => {
        if (row == null || typeof row !== "object" || Array.isArray(row)) return null;
        const o = /** @type {Record<string, unknown>} */ (row);
        const label = typeof o.label === "string" ? o.label : "";
        const score = typeof o.score === "number" && Number.isFinite(o.score) ? o.score : NaN;
        if (!label || Number.isNaN(score)) return null;
        return { label, score };
      })
      .filter((x) => x != null);
  }
  if (data != null && typeof data === "object" && !Array.isArray(data)) {
    const o = /** @type {Record<string, unknown>} */ (data);
    const labels = o.labels;
    const scores = o.scores;
    if (Array.isArray(labels) && Array.isArray(scores) && labels.length === scores.length) {
      /** @type {Array<{ label: string, score: number }>} */
      const out = [];
      for (let i = 0; i < labels.length; i++) {
        const label = String(labels[i] ?? "");
        const score = typeof scores[i] === "number" && Number.isFinite(scores[i]) ? scores[i] : NaN;
        if (label && !Number.isNaN(score)) out.push({ label, score });
      }
      return out;
    }
  }
  return [];
}

/**
 * @param {Array<{ label: string, score: number }>} ranked
 */
function toAnalysisResult(ranked) {
  const sorted = [...ranked].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const category = top.label.slice(0, 240);
  const confidence = Math.min(1, Math.max(0, top.score));
  return {
    category,
    labels: sorted.map((x) => x.label),
    confidence,
    features: {
      provider: "huggingface",
      model: DISPLAY_MODEL_ID,
      inferenceRuntime: "transformers.js",
      xenovaModelId: XENOVA_CLIP_MODEL,
      zeroShot: true,
      ranked: sorted.map((x) => ({ label: x.label, score: x.score })),
      candidateLabels: CANDIDATE_LABELS,
    },
    embeddings: null,
    modelSource: "external",
    provider: "huggingface",
  };
}

(async function main() {
  const ref = String(process.env.HF_ASSET_REF ?? "").trim();
  if (process.env.HF_DISABLE === "1" || !ref) {
    console.log(JSON.stringify({ ok: false, reason: "disabled_or_empty" }));
    return;
  }

  const token =
    process.env.HUGGINGFACE_API_TOKEN ||
    process.env.HF_TOKEN ||
    process.env.HUGGING_FACE_HUB_TOKEN ||
    "";

  if (!token) {
    console.log(JSON.stringify({ ok: false, reason: "no_token" }));
    return;
  }

  try {
    const classifier = await getClassifier();
    /** @type {unknown} */
    let raw;
    if (/^https?:\/\//i.test(ref)) {
      raw = await classifier(ref, CANDIDATE_LABELS);
    } else {
      const resolved = path.isAbsolute(ref) ? ref : path.resolve(process.cwd(), ref);
      if (!fs.existsSync(resolved)) {
        console.log(JSON.stringify({ ok: false, reason: "not_found", path: resolved }));
        return;
      }
      raw = await classifier(resolved, CANDIDATE_LABELS);
    }

    const ranked = parseZeroShotResponse(raw);
    if (ranked.length === 0) {
      console.log(JSON.stringify({ ok: false, reason: "empty_scores", detail: raw }));
      return;
    }
    console.log(JSON.stringify({ ok: true, result: toAnalysisResult(ranked) }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  }
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
});

/**
 * Phase 8 — Hugging Face (CLIP zero-shot) as a pluggable imageAnalysisProvider implementation.
 * Runs inference in a child process with timeout; on any failure returns null (classifier uses heuristic).
 * Worker uses transformers.js (ONNX) for CLIP ViT-B/32; token still required to enable the real-inference path.
 * Token: process.env.HUGGINGFACE_API_TOKEN (loaded from repo-root .env via loadRootEnv when available).
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "../../../server/loadRootEnv.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(__dirname, "hfInferenceWorker.mjs");

/**
 * Mirrors dev/validatePhase8 token heuristic — placeholder tokens must not trigger worker spawn.
 * @param {string | undefined} t
 * @returns {boolean}
 */
function looksLikeUsableHuggingFaceToken(t) {
  if (t == null || typeof t !== "string") return false;
  const s = t.trim();
  if (s.length < 8) return false;
  const lower = s.toLowerCase();
  if (lower === "your_token_here" || lower.startsWith("your_")) return false;
  return true;
}

/**
 * When HF is disabled or no real token: do not spawn the worker (no subprocess, no model load).
 * @returns {boolean} true if inference must be skipped (caller returns null → heuristic path).
 */
function mustSkipHuggingFaceInference() {
  loadRootEnv();
  if (process.env.HF_DISABLE === "1") return true;
  const raw =
    process.env.HUGGINGFACE_API_TOKEN || process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN || "";
  return !looksLikeUsableHuggingFaceToken(raw);
}

/**
 * Run HF worker synchronously (blocks until complete, timeout, or parse error).
 * @param {{ id: string, ref: string, entityId?: string }} asset
 * @returns {import("../imageAnalysisProvider.js").ImageAnalysisResult | null}
 */
function runHfWorkerSync(asset) {
  loadRootEnv();
  const timeoutMs = Math.min(
    360_000,
    Math.max(3000, Number(process.env.HF_TIMEOUT_MS || 45_000) || 45_000),
  );
  const r = spawnSync(process.execPath, [WORKER], {
    encoding: "utf8",
    env: {
      ...process.env,
      HF_ASSET_REF: String(asset?.ref ?? ""),
    },
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.error) return null;
  const out = String(r.stdout ?? "").trim();
  if (!out) return null;
  /** @type {{ ok?: boolean, result?: Record<string, unknown> }} */
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    return null;
  }
  if (!parsed || parsed.ok !== true || parsed.result == null || typeof parsed.result !== "object") {
    return null;
  }
  return /** @type {import("../imageAnalysisProvider.js").ImageAnalysisResult} */ (parsed.result);
}

/**
 * @type {import("../imageAnalysisProvider.js").ImageAnalysisProvider}
 */
export const huggingFaceProvider = {
  id: "huggingface",
  /**
   * @param {{ id: string, ref: string, entityId?: string }} asset
   */
  analyzeImage(asset) {
    if (asset == null || typeof asset !== "object") return null;
    if (mustSkipHuggingFaceInference()) return null;
    return runHfWorkerSync(asset);
  },
};

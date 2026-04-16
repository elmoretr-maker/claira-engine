/**
 * Per-room placement validation ("door monitor") — compares an input embedding
 * to CLIP embeddings of PNGs in the room's references/ folder.
 * Not wired into analyze/CLI yet.
 */

import { existsSync } from "fs";
import { readdir } from "fs/promises";
import { join } from "path";
import { l2NormalizeFloat32 } from "../core/classifier.js";
import { getImageEmbedding } from "../vision/clipEmbedder.js";

/**
 * @param {Float32Array} a
 * @param {Float32Array} b
 */
function cosineSimilarityNormalized(a, b) {
  if (a.length !== b.length) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listPngFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith(".png")) {
      out.push(join(dir, e.name));
    }
  }
  return out.sort();
}

/**
 * @param {{ config: object, referencePath: string }} room
 */
function getThreshold(room) {
  const t = room?.config?.require_review_threshold;
  if (t != null && Number.isFinite(Number(t))) return Number(t);
  return 0.5;
}

/**
 * Validates whether an embedding belongs in this room vs its reference PNGs.
 * Uses **max** cosine similarity to any reference (same metric family as the classifier).
 *
 * @param {string | null | undefined} label — room / label key (for diagnostics only)
 * @param {Float32Array | number[]} embedding — input vector (e.g. CLIP image embedding)
 * @param {{ config: object, referencePath: string }} room — entry from `loadRooms()`
 * @param {{ strictValidation?: boolean }} [options] — raise cosine bar when Entrance strict mode is on
 * @returns {Promise<{ accepted: boolean, score: number, reason: string }>}
 */
export async function validatePlacement(label, embedding, room, options) {
  const refDir = room?.referencePath;
  if (!refDir || typeof refDir !== "string") {
    return {
      accepted: false,
      score: 0,
      reason: "invalid_room: missing referencePath",
    };
  }

  const paths = await listPngFiles(refDir);
  if (paths.length === 0) {
    return {
      accepted: false,
      score: 0,
      reason: "no_reference_images",
    };
  }

  const input = l2NormalizeFloat32(
    embedding instanceof Float32Array ? embedding : new Float32Array(embedding),
  );

  /** @type {number[]} */
  const sims = [];
  for (const p of paths) {
    const r = await getImageEmbedding(p);
    if (r.error) continue;
    const ref = l2NormalizeFloat32(new Float32Array(r.embedding));
    const sim = cosineSimilarityNormalized(input, ref);
    if (!Number.isFinite(sim)) {
      return {
        accepted: false,
        score: 0,
        reason: "embedding_length_mismatch",
      };
    }
    sims.push(sim);
  }

  if (sims.length === 0) {
    return {
      accepted: false,
      score: 0,
      reason: "no_valid_reference_embeddings",
    };
  }

  const score = Math.max(...sims);
  let threshold = getThreshold(room);
  if (options?.strictValidation === true) {
    threshold = Math.min(0.92, threshold + 0.08);
  }
  const accepted = score >= threshold;
  const tag = label != null && String(label).trim() ? String(label).trim() : "unknown";

  return {
    accepted,
    score: Number(score.toFixed(6)),
    reason: accepted
      ? `accepted (${tag}: max_cosine ${score.toFixed(4)} >= ${threshold})`
      : `rejected (${tag}: max_cosine ${score.toFixed(4)} < ${threshold})`,
  };
}

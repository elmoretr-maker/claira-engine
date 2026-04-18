/**
 * Resolve image paths strictly under cwd (no traversal). Read-only helpers for fitness comparison.
 */

import { existsSync, statSync } from "fs";
import { resolve, relative, sep, isAbsolute, extname } from "path";

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

/** @type {Set<string>} */
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

/**
 * @param {string} cwd
 * @param {string} userPath
 * @returns {{ absPath: string }}
 */
export function assertFitnessImagePathUnderCwd(cwd, userPath) {
  const root = resolve(cwd || process.cwd());
  const raw = String(userPath ?? "").trim();
  if (!raw) throw new Error("fitness_image_comparison: empty path");

  const candidate = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
  const ext = extname(candidate).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(`fitness_image_comparison: unsupported image type: ${userPath}`);
  }

  const rel = relative(root, candidate);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || rel.split(sep).includes("..")) {
    throw new Error(`fitness_image_comparison: path must be under workspace (${root}): ${userPath}`);
  }

  if (!existsSync(candidate)) {
    throw new Error(`fitness_image_comparison: file not found: ${userPath}`);
  }
  const st = statSync(candidate);
  if (!st.isFile()) throw new Error(`fitness_image_comparison: not a file: ${userPath}`);
  if (st.size > MAX_IMAGE_BYTES) {
    throw new Error(`fitness_image_comparison: image exceeds max size (${MAX_IMAGE_BYTES} bytes): ${userPath}`);
  }
  return { absPath: candidate };
}

export { MAX_IMAGE_BYTES };

/**
 * Compress receipt images for embedded PDF/JSON reports (sharp).
 * Target: base64 payload ≤ ~300KB; progressive quality and resize; preserve aspect ratio.
 */

import { existsSync, readFileSync } from "fs";
import { join, relative, resolve } from "path";
import sharp from "sharp";

/** Max base64 character length (~300KB string as requested). */
const MAX_B64_CHARS = 300 * 1024;

/**
 * @param {Buffer} buf
 * @returns {Promise<{ mimeType: "image/jpeg", dataBase64: string } | null>}
 */
async function compressBufferToJpegBase64(buf) {
  const qualities = [90, 85, 80, 75, 70, 65, 60];
  /** @type {(number | undefined)[]} */
  const widths = [undefined, 2000, 1600, 1400, 1200, 1000, 800, 640, 512];
  for (const w of widths) {
    for (const q of qualities) {
      try {
        let chain = sharp(buf).rotate();
        if (w != null) {
          chain = chain.resize({ width: w, fit: "inside", withoutEnlargement: true });
        }
        const out = await chain.jpeg({ quality: q, mozjpeg: true }).toBuffer();
        const b64 = out.toString("base64");
        if (b64.length <= MAX_B64_CHARS) {
          return { mimeType: "image/jpeg", dataBase64: b64 };
        }
      } catch {
        /* try next combination */
      }
    }
  }
  return null;
}

/**
 * @param {string} cwd
 * @param {string} relPath workspace-relative image path
 * @returns {Promise<{ mimeType: string, dataBase64: string } | null>}
 */
export async function compressAndEmbedReceiptImage(cwd, relPath) {
  const root = resolve(String(cwd ?? "").trim() || process.cwd());
  const parts = String(relPath).split(/[/\\]/).filter(Boolean);
  if (parts.some((p) => p === "..")) return null;
  const abs = join(root, ...parts);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || rel === "") return null;
  if (!existsSync(abs)) return null;
  let buf;
  try {
    buf = readFileSync(abs);
  } catch {
    return null;
  }
  try {
    const out = await compressBufferToJpegBase64(buf);
    return out;
  } catch {
    return null;
  }
}

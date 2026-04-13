/**
 * Copy corrected images into references/user/<label>/ for the next reference_embeddings rebuild.
 * Does not rebuild embeddings here (batch via `node vision/buildReferences.js`).
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from "fs";
import { basename, dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { clearReferenceEmbeddingsCache } from "../interfaces/referenceLoader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const USER_REF_BASE = join(ROOT, "references", "user");

/** True after a successful copy; cleared when `vision/buildReferences.js` finishes. */
export let userReferencesPendingRebuild = false;

export function clearUserReferencesPendingRebuild() {
  userReferencesPendingRebuild = false;
}

/**
 * @param {string|null|undefined} raw
 */
function sanitizeLabel(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || s.includes("..")) return "";
  if (/[/\\]/.test(s)) return "";
  if (!/^[a-z0-9_-]+$/.test(s)) return "";
  return s;
}

/**
 * @param {string|null|undefined} filePath — local path (not http(s))
 * @param {string|null|undefined} selected_label — folder name under references/user/
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
export function addUserReference(filePath, selected_label) {
  const rawPath = String(filePath ?? "").trim();
  if (!rawPath || /^https?:\/\//i.test(rawPath)) {
    return { ok: false, reason: "no_local_file" };
  }
  const src = resolve(rawPath);
  if (!existsSync(src) || !statSync(src).isFile()) {
    return { ok: false, reason: "not_found" };
  }
  const ext = extname(src).toLowerCase();
  const allowed = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  if (!allowed.has(ext)) {
    return { ok: false, reason: "unsupported_image_ext" };
  }

  const label = sanitizeLabel(selected_label);
  if (!label) {
    return { ok: false, reason: "invalid_label" };
  }

  const destDir = join(USER_REF_BASE, label);
  mkdirSync(destDir, { recursive: true });

  let base = basename(src, ext) || "ref";
  base = base.replace(/[^\w.-]+/g, "_").slice(0, 80) || "ref";
  let dest = join(destDir, `${base}${ext}`);
  if (existsSync(dest)) {
    dest = join(destDir, `${base}_${Date.now()}${ext}`);
  }

  copyFileSync(src, dest);
  userReferencesPendingRebuild = true;
  clearReferenceEmbeddingsCache();
  console.log("New user reference added");
  return { ok: true, path: dest };
}

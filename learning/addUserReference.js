/**
 * Durable reference learning: copy images into references/user/<label>/ for future runs.
 * Runtime loads these via referenceLoader (clearReferenceEmbeddingsCache); embeddings are not
 * rebuilt mid-batch — deterministic batch model is preserved.
 *
 * Use {@link persistReferenceLearning} for all product call sites; {@link addUserReference} is the low-level copy.
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

const RECENT_PERSIST_MS = 90_000;
/** @type {Map<string, number>} */
const recentPersistKeys = new Map();

function pruneStalePersistKeys() {
  const now = Date.now();
  for (const [k, t] of recentPersistKeys) {
    if (now - t > RECENT_PERSIST_MS) recentPersistKeys.delete(k);
  }
}

function persistDedupeKey(absSrc, label) {
  return `${String(absSrc)}\0${label}`;
}

/**
 * Single durable learning entry: optional short-window dedupe, then {@link addUserReference}.
 * @param {string|null|undefined} filePath
 * @param {string|null|undefined} label — references/user subfolder (sanitized)
 * @param {{ skipDedupe?: boolean }} [options] — set for intentional bulk ingest (e.g. tunnel) if needed
 * @returns {{ ok: true, path: string } | { ok: true, skipped: true, reason: "duplicate_recent", duplicateRecent?: true } | { ok: false, reason: string }}
 */
export function persistReferenceLearning(filePath, label, options = {}) {
  pruneStalePersistKeys();
  const rawPath = String(filePath ?? "").trim();
  if (!rawPath || /^https?:\/\//i.test(rawPath)) {
    return { ok: false, reason: "no_local_file" };
  }
  const sanitized = sanitizeLabel(label);
  if (!sanitized) {
    return { ok: false, reason: "invalid_label" };
  }
  let absSrc;
  try {
    absSrc = resolve(rawPath);
  } catch {
    return { ok: false, reason: "invalid_path" };
  }
  if (options.skipDedupe !== true) {
    const k = persistDedupeKey(absSrc, sanitized);
    const t = recentPersistKeys.get(k);
    if (t != null && Date.now() - t < RECENT_PERSIST_MS) {
      return { ok: true, skipped: true, reason: "duplicate_recent", duplicateRecent: true };
    }
  }
  const out = addUserReference(rawPath, sanitized);
  if (out.ok && options.skipDedupe !== true) {
    recentPersistKeys.set(persistDedupeKey(absSrc, sanitized), Date.now());
  }
  return out;
}

/**
 * @param {string|null|undefined} filePath — local path (not http(s))
 * @param {string|null|undefined} selected_label — folder name under references/user/
 * @returns {{ ok: true, path: string } | { ok: false, reason: string, detail?: string }}
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

  let dest;
  try {
    mkdirSync(destDir, { recursive: true });

    let base = basename(src, ext) || "ref";
    base = base.replace(/[^\w.-]+/g, "_").slice(0, 80) || "ref";
    dest = join(destDir, `${base}${ext}`);
    if (existsSync(dest)) {
      dest = join(destDir, `${base}_${Date.now()}${ext}`);
    }

    copyFileSync(src, dest);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[learning] addUserReference io_error: ${msg}`);
    return { ok: false, reason: "io_error", detail: msg };
  }

  userReferencesPendingRebuild = true;
  clearReferenceEmbeddingsCache();
  console.log("New user reference added");
  return { ok: true, path: dest };
}

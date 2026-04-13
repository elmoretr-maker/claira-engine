/**
 * Tunnel upload staging under engine root: temp/tunnel_staging/<category>/
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, unlinkSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = join(__dirname, "..");

/** Relative to engine root (POSIX-style for API responses). */
export const TUNNEL_STAGING_REL = "temp/tunnel_staging";

/**
 * @returns {string} Absolute path to temp/tunnel_staging
 */
export function getTunnelStagingRoot() {
  return join(ENGINE_ROOT, "temp", "tunnel_staging");
}

/**
 * @param {string} category — sanitized slug
 * @returns {string} Relative folder path for processFolder (from engine cwd)
 */
export function tunnelStagingFolderRel(category) {
  const c = String(category ?? "").trim();
  return `${TUNNEL_STAGING_REL}/${c}`;
}

/**
 * @param {string} child — resolved or unresolved path
 * @param {string} root — resolved root
 * @returns {boolean}
 */
function isPathInsideOrEqual(child, root) {
  const c = resolve(child);
  const r = resolve(root);
  if (c === r) return true;
  const rel = relative(r, c);
  return rel !== "" && !rel.startsWith("..") && !rel.includes("..");
}

/**
 * @param {string} absPath — any path
 * @returns {boolean}
 */
export function isUnderTunnelStagingRoot(absPath) {
  return isPathInsideOrEqual(absPath, getTunnelStagingRoot());
}

/**
 * Remove all files (and nested dirs) inside a category staging folder after a run.
 * No-op if the path is not under temp/tunnel_staging/.
 *
 * @param {string} absCategoryDir — absolute path to temp/tunnel_staging/<category>
 */
export function cleanupTunnelStagingCategoryDir(absCategoryDir) {
  const stagingRoot = getTunnelStagingRoot();
  const dir = resolve(absCategoryDir);
  if (!existsSync(dir)) return;
  if (!isPathInsideOrEqual(dir, stagingRoot)) return;

  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const p = join(dir, name);
    try {
      const st = lstatSync(p);
      if (st.isDirectory()) {
        rmSync(p, { recursive: true, force: true });
      } else {
        unlinkSync(p);
      }
    } catch {
      /* best-effort cleanup */
    }
  }
}

/**
 * Ensure temp/tunnel_staging exists.
 */
export function ensureTunnelStagingRoot() {
  mkdirSync(getTunnelStagingRoot(), { recursive: true });
}

/**
 * Remove temp/tunnel_staging entirely, then recreate an empty directory tree.
 * Safe no-op if root cannot be read.
 */
export function resetTunnelStagingTree() {
  const root = getTunnelStagingRoot();
  try {
    if (existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
  try {
    mkdirSync(root, { recursive: true });
  } catch {
    /* ignore */
  }
}

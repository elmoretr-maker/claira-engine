/**
 * Optional disk cache for buildIndustryKnowledge (per slug, TTL).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "cache");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} slug
 */
function cachePath(slug) {
  const s = String(slug ?? "").trim().toLowerCase();
  if (!s || !/^[a-z0-9_-]+$/.test(s)) return "";
  return join(CACHE_DIR, `${s}.json`);
}

/**
 * @param {string} slug
 * @param {string} displayName
 * @param {number} [ttlMs]
 * @returns {null | Record<string, unknown>}
 */
export function readResearchCache(slug, displayName, ttlMs = DEFAULT_TTL_MS) {
  const p = cachePath(slug);
  if (!p || !existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    if (String(raw.displayName ?? "").trim() !== String(displayName ?? "").trim()) return null;
    const t = typeof raw.cachedAt === "number" ? raw.cachedAt : 0;
    if (Date.now() - t > ttlMs) return null;
    const k = raw.knowledge;
    if (!k || typeof k !== "object") return null;
    return /** @type {Record<string, unknown>} */ (k);
  } catch {
    return null;
  }
}

/**
 * @param {string} slug
 * @param {string} displayName
 * @param {Record<string, unknown>} knowledge
 */
export function writeResearchCache(slug, displayName, knowledge) {
  const p = cachePath(slug);
  if (!p) return;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(
    p,
    `${JSON.stringify({ displayName: String(displayName).trim(), cachedAt: Date.now(), knowledge }, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Load approved network + search configuration (no open browsing).
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
export const ALLOWED_SOURCES_PATH = join(ROOT, "config", "allowedSources.json");

/**
 * @returns {{
 *   version: number,
 *   allowedHosts: string[],
 *   pingUrls: Array<{ id?: string, url: string, timeoutMs?: number }>,
 *   sources: Array<{ id: string, label?: string, method?: string, urlTemplate: string }>,
 * }}
 */
export function loadAllowedSources() {
  if (!existsSync(ALLOWED_SOURCES_PATH)) {
    throw new Error(`Missing ${ALLOWED_SOURCES_PATH}`);
  }
  const raw = JSON.parse(readFileSync(ALLOWED_SOURCES_PATH, "utf8"));
  if (!raw || typeof raw !== "object") throw new Error("allowedSources: invalid JSON");
  const allowedHosts = Array.isArray(raw.allowedHosts)
    ? raw.allowedHosts.map((h) => String(h).trim().toLowerCase()).filter(Boolean)
    : [];
  const pingUrls = Array.isArray(raw.pingUrls) ? raw.pingUrls : [];
  const sources = Array.isArray(raw.sources) ? raw.sources : [];
  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    allowedHosts,
    pingUrls,
    sources,
  };
}

/**
 * @param {string} urlStr
 * @param {string[]} allowedHosts
 */
export function assertUrlHostAllowed(urlStr, allowedHosts) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error("Invalid URL");
  }
  const host = u.hostname.toLowerCase();
  if (!allowedHosts.includes(host)) {
    throw new Error(`Host not allowed: ${host}`);
  }
}

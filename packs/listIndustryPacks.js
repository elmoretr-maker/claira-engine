/**
 * Discover industry packs under packs/ (each folder with structure.json).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PACKS_DIR = join(ROOT, "packs");

/**
 * @param {string} slug
 */
function humanizeSlug(slug) {
  const s = String(slug ?? "").trim();
  if (!s) return "Pack";
  return s
    .split(/[-_]/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * @param {string} packDir
 * @returns {{ label?: string, inputVerb?: string } | undefined}
 */
function readPackUxFromReferenceJson(packDir) {
  const refPath = join(packDir, "reference.json");
  if (!existsSync(refPath)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(refPath, "utf8"));
    const p = raw?.pack;
    if (!p || typeof p !== "object" || Array.isArray(p)) return undefined;
    const o = /** @type {Record<string, unknown>} */ (p);
    /** @type {{ label?: string, inputVerb?: string }} */
    const out = {};
    if (typeof o.label === "string" && o.label.trim()) out.label = o.label.trim();
    if (typeof o.inputVerb === "string" && o.inputVerb.trim()) out.inputVerb = o.inputVerb.trim();
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @returns {Array<{ slug: string, label: string, inputVerb?: string }>}
 */
export function listIndustryPacks() {
  if (!existsSync(PACKS_DIR)) return [];
  /** @type {Array<{ slug: string, label: string, inputVerb?: string }>} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(PACKS_DIR);
  } catch {
    return [];
  }
  for (const name of entries) {
    const slug = String(name).trim().toLowerCase();
    if (!slug || !/^[a-z0-9_-]+$/.test(slug)) continue;
    const packDir = join(PACKS_DIR, name);
    try {
      if (!statSync(packDir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!existsSync(join(packDir, "structure.json"))) continue;
    const ux = readPackUxFromReferenceJson(packDir);
    out.push({
      slug,
      label: ux?.label || humanizeSlug(slug),
      ...(ux?.inputVerb ? { inputVerb: ux.inputVerb } : {}),
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

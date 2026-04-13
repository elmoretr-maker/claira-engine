/**
 * Post-generation checks: files, keyword counts, duplicates (mirrors generator rules).
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const KEYWORD_TARGET_MIN = 10;

/**
 * @param {string} packSlug
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validatePackIntegrity(packSlug) {
  const slug = String(packSlug ?? "").trim();
  /** @type {string[]} */
  const errors = [];
  if (!slug) {
    errors.push("Missing pack slug");
    return { ok: false, errors };
  }

  const packDir = join(ROOT, "packs", slug);
  const structPath = join(packDir, "structure.json");
  const refPath = join(packDir, "reference.json");
  if (!existsSync(structPath)) errors.push(`Missing structure.json`);
  if (!existsSync(refPath)) errors.push(`Missing reference.json`);

  /** @type {Record<string, string[]>} */
  let categories = {};
  try {
    const structure = JSON.parse(readFileSync(structPath, "utf8"));
    categories =
      structure?.categories && typeof structure.categories === "object" && !Array.isArray(structure.categories)
        ? structure.categories
        : {};
  } catch {
    errors.push("structure.json unreadable");
    return { ok: false, errors };
  }

  const keys = Object.keys(categories);
  if (keys.length === 0) errors.push("No categories in structure.json");

  /** @type {Set<string>} */
  const allKw = new Set();
  for (const k of keys) {
    const words = categories[k];
    if (!Array.isArray(words)) {
      errors.push(`Category ${k}: keywords not an array`);
      continue;
    }
    if (words.length < KEYWORD_TARGET_MIN) {
      errors.push(`Category ${k}: fewer than ${KEYWORD_TARGET_MIN} keywords (${words.length})`);
    }
    for (const w of words) {
      const low = String(w).trim().toLowerCase();
      if (!low) continue;
      if (allKw.has(low)) errors.push(`Duplicate keyword across pack: "${low}"`);
      allKw.add(low);
    }
  }

  let ref;
  try {
    ref = JSON.parse(readFileSync(refPath, "utf8"));
  } catch {
    errors.push("reference.json unreadable");
    return { ok: false, errors };
  }

  for (const k of keys) {
    if (!ref.categories?.[k]) errors.push(`reference.json missing category: ${k}`);
  }

  const procPath = join(packDir, "reference_assets", "processes.json");
  let proc = {};
  if (existsSync(procPath)) {
    try {
      proc = JSON.parse(readFileSync(procPath, "utf8"));
    } catch {
      proc = {};
    }
  }
  for (const k of keys) {
    if (!proc[k]) errors.push(`processes.json missing category: ${k}`);
    const imgDir = join(packDir, "reference_assets", "images", k);
    if (!existsSync(imgDir)) errors.push(`Missing images dir: ${k}`);
    else {
      const names = readdirSync(imgDir);
      if (names.filter((n) => n.endsWith(".png")).length === 0) errors.push(`No PNG assets: ${k}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

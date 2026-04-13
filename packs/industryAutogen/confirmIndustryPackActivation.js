/**
 * User-confirmed activation after quality gate (loads pack into config).
 */

import { existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

/**
 * @param {string} rawSlug
 * @returns {{ ok: boolean, slug?: string, error?: string }}
 */
export async function confirmIndustryPackActivation(rawSlug) {
  const slug = String(rawSlug ?? "")
    .trim()
    .toLowerCase();
  if (!slug || !/^[a-z0-9_-]+$/.test(slug)) {
    return { ok: false, error: "Invalid pack slug." };
  }
  const packDir = join(ROOT, "packs", slug);
  if (!existsSync(join(packDir, "structure.json"))) {
    return { ok: false, error: `Pack not found: packs/${slug}` };
  }

  const { loadIndustryPack } = await import("../loadIndustryPack.js");
  await loadIndustryPack(slug);
  return { ok: true, slug };
}

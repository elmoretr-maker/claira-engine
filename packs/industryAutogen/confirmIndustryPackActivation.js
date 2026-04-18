/**
 * User-confirmed activation after quality gate (loads pack into config).
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { getPackRegistryEntry } from "../../workflow/packs/packRegistry.js";
import { registerCustomPackEntry } from "../../workflow/packs/customPacksStore.js";

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

  if (!getPackRegistryEntry(slug)) {
    let label = slug;
    try {
      const refPath = join(packDir, "reference.json");
      if (existsSync(refPath)) {
        const ref = JSON.parse(readFileSync(refPath, "utf8"));
        const pl = ref?.pack?.label;
        if (typeof pl === "string" && pl.trim()) label = pl.trim();
      }
    } catch {
      /* keep slug */
    }
    try {
      registerCustomPackEntry({ id: slug, name: label, domainMode: "general" });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const { loadIndustryPack } = await import("../loadIndustryPack.js");
  await loadIndustryPack(slug);
  return { ok: true, slug };
}

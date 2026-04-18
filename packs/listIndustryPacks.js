/**
 * Category packs: catalog from packRegistry only; filesystem confirms loadability.
 */

import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { getAllPackRegistryEntries } from "../workflow/packs/packRegistry.js";
import { isPackDiagnosticsMode } from "../workflow/packs/packDiagnosticsMode.js";
import { validatePackTriad } from "../workflow/packs/validatePackTriad.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PACKS_DIR = join(ROOT, "packs");

/**
 * Warn when a folder exists under packs/ without a registry entry (dev diagnostics only).
 */
function warnOrphanPackFolders() {
  if (!isPackDiagnosticsMode() || !existsSync(PACKS_DIR)) return;
  const registered = new Set(getAllPackRegistryEntries().map((p) => p.id));
  let entries;
  try {
    entries = readdirSync(PACKS_DIR);
  } catch {
    return;
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
    if (!registered.has(slug)) {
      console.warn(`[packs] ignoring packs/${slug}/ — no packRegistry entry (add to workflow/packs/packRegistry.js or customPacks.json)`);
    }
  }
}

/**
 * @returns {Array<{
 *   slug: string,
 *   label: string,
 *   inputVerb?: string,
 *   description?: string,
 *   domainMode?: string,
 *   status: "ok" | "invalid",
 *   valid: boolean,
 *   errors?: string[],
 * }>}
 */
export function listIndustryPacks() {
  warnOrphanPackFolders();
  const diagnostics = isPackDiagnosticsMode();
  /** @type {Array<{
 *   slug: string,
   *   label: string,
   *   inputVerb?: string,
   *   description?: string,
   *   domainMode?: string,
   *   status: "ok" | "invalid",
   *   valid: boolean,
   *   errors?: string[],
   * }>} */
  const out = [];

  for (const entry of getAllPackRegistryEntries()) {
    const { id, name, domainMode, description, inputVerb } = entry;
    const v = validatePackTriad(id);
    const base = {
      slug: id,
      label: name,
      ...(inputVerb ? { inputVerb } : {}),
      ...(description ? { description } : {}),
      domainMode,
 };
    if (v.valid) {
      out.push({ ...base, status: /** @type {"ok"} */ ("ok"), valid: true });
    } else if (diagnostics) {
      out.push({
        ...base,
        status: "invalid",
        valid: false,
        errors: v.errors,
      });
    }
  }

  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

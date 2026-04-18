/**
 * User-generated pack entries (merged after builtins). Display/config only — no execution fields.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CUSTOM_PACKS_PATH = join(__dirname, "customPacks.json");

/**
 * @typedef {{ id: string, name: string, domainMode: string, description?: string }} CustomPackEntry
 */

/**
 * @returns {CustomPackEntry[]}
 */
export function readCustomPackEntries() {
  if (!existsSync(CUSTOM_PACKS_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(CUSTOM_PACKS_PATH, "utf8"));
    const packs = raw?.packs;
    if (!Array.isArray(packs)) return [];
    /** @type {CustomPackEntry[]} */
    const out = [];
    for (const p of packs) {
      if (!p || typeof p !== "object" || Array.isArray(p)) continue;
      const o = /** @type {Record<string, unknown>} */ (p);
      const id = typeof o.id === "string" ? o.id.trim().toLowerCase() : "";
      const name = typeof o.name === "string" ? o.name.trim() : "";
      const domainMode = typeof o.domainMode === "string" ? o.domainMode.trim() : "";
      if (!id || !/^[a-z0-9_-]+$/.test(id) || !name || !domainMode) continue;
      const description = typeof o.description === "string" ? o.description.trim() : "";
      out.push({
        id,
        name,
        domainMode,
        ...(description ? { description } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * @param {CustomPackEntry} entry
 */
export function registerCustomPackEntry(entry) {
  const id = String(entry?.id ?? "")
    .trim()
    .toLowerCase();
  const name = String(entry?.name ?? "").trim();
  const domainMode = String(entry?.domainMode ?? "").trim();
  if (!id || !/^[a-z0-9_-]+$/.test(id) || !name || !domainMode) {
    throw new Error("registerCustomPackEntry: id, name, and domainMode are required");
  }
  const description = typeof entry.description === "string" ? entry.description.trim() : "";
  const existing = readCustomPackEntries();
  const filtered = existing.filter((p) => p.id !== id);
  filtered.push({
    id,
    name,
    domainMode,
    ...(description ? { description } : {}),
  });
  filtered.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(
    CUSTOM_PACKS_PATH,
    `${JSON.stringify({ version: 1, packs: filtered }, null, 2)}\n`,
    "utf8",
  );
}

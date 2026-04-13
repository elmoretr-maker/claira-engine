/**
 * User-local progress entities (JSON under tracking/entities/). Not shared automatically.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ENTITIES_DIR, ensureTrackingDirs } from "./paths.js";

/**
 * @param {{ name: string, category: string, industry?: string }} input
 */
export function createTrackingEntity(input) {
  ensureTrackingDirs();
  const name = String(input?.name ?? "").trim();
  const category = String(input?.category ?? "").trim();
  if (!name || !category) {
    return { ok: false, error: "name and category are required." };
  }
  const industry = String(input?.industry ?? "").trim().toLowerCase();
  const id = `e_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const entity = {
    id,
    name,
    category,
    industry,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(ENTITIES_DIR, `${id}.json`), `${JSON.stringify(entity, null, 2)}\n`, "utf8");
  return { ok: true, entity };
}

/**
 * @param {string} [industryFilter] — optional slug filter
 */
export function listTrackingEntities(industryFilter = "") {
  ensureTrackingDirs();
  const want = String(industryFilter ?? "").trim().toLowerCase();
  /** @type {unknown[]} */
  const out = [];
  if (!existsSync(ENTITIES_DIR)) return { ok: true, entities: [] };
  for (const f of readdirSync(ENTITIES_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const e = JSON.parse(readFileSync(join(ENTITIES_DIR, f), "utf8"));
      if (!e || typeof e !== "object") continue;
      if (want && String(e.industry ?? "").toLowerCase() !== want) continue;
      out.push(e);
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => String(/** @type {{ createdAt?: string }} */ (b).createdAt ?? "").localeCompare(String(/** @type {{ createdAt?: string }} */ (a).createdAt ?? "")));
  return { ok: true, entities: out };
}

/**
 * @param {string} rawId
 */
export function getTrackingEntity(rawId) {
  const id = String(rawId ?? "").trim().toLowerCase();
  if (!/^e_[a-z0-9_-]+$/.test(id)) return { ok: false, error: "Invalid entity id." };
  const p = join(ENTITIES_DIR, `${id}.json`);
  if (!existsSync(p)) return { ok: false, error: "Entity not found." };
  try {
    const e = JSON.parse(readFileSync(p, "utf8"));
    return { ok: true, entity: e };
  } catch {
    return { ok: false, error: "Invalid entity file." };
  }
}

/**
 * Room registry — per-room config + reference image paths (no engine integration yet).
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Scan `rooms/` for subfolders containing `room.config.json`, attach `references/` path.
 * Keys are `config.name` (must match folder intent; falls back to directory name).
 *
 * @returns {Record<string, { config: object, referencePath: string }>}
 */
export function loadRooms() {
  /** @type {Record<string, { config: object, referencePath: string }>} */
  const out = {};
  const entries = readdirSync(__dirname, { withFileTypes: true });

  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const roomDir = join(__dirname, e.name);
    const configPath = join(roomDir, "room.config.json");
    if (!existsSync(configPath)) continue;

    const raw = readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    const key = typeof config?.name === "string" && config.name.length ? config.name : e.name;
    const referencePath = join(roomDir, "references");
    out[key] = { config, referencePath };
  }

  return out;
}

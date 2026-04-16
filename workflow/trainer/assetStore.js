/**
 * Trainer assets linked to a client (classification summary per ingested file).
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ensureTrainerDataDirs, TRAINER_CLIENTS_DIR } from "./paths.js";

const ASSETS_FILE = "assets.json";

/**
 * @param {string} clientId
 * @returns {object[]}
 */
function readAssets(clientId) {
  const p = join(TRAINER_CLIENTS_DIR, clientId, ASSETS_FILE);
  if (!existsSync(p)) return [];
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} clientId
 * @param {object[]} assets
 */
function writeAssets(clientId, assets) {
  const dir = join(TRAINER_CLIENTS_DIR, clientId);
  ensureTrainerDataDirs();
  writeFileSync(join(dir, ASSETS_FILE), `${JSON.stringify(assets, null, 2)}\n`, "utf8");
}

/**
 * @param {string} clientId
 * @param {object} asset
 * @returns {{ ok: true, asset: object } | { ok: false, error: string }}
 */
export function appendTrainerAsset(clientId, asset) {
  const id = String(clientId ?? "").trim();
  if (!id) return { ok: false, error: "clientId required" };
  if (!asset || typeof asset !== "object") return { ok: false, error: "asset required" };
  const row = {
    ...asset,
    id: asset.id || `a_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: asset.createdAt || new Date().toISOString(),
  };
  const list = readAssets(id);
  list.push(row);
  writeAssets(id, list);
  return { ok: true, asset: row };
}

/**
 * @param {string} clientId
 * @returns {object[]}
 */
export function listTrainerAssets(clientId) {
  const id = String(clientId ?? "").trim();
  if (!id) return [];
  return readAssets(id);
}

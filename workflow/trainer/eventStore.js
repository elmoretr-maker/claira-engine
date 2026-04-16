/**
 * Trainer timeline events per client.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ensureTrainerDataDirs, TRAINER_CLIENTS_DIR } from "./paths.js";

const EVENTS_FILE = "events.json";

/**
 * @param {string} clientId
 * @returns {object[]}
 */
function readEvents(clientId) {
  const p = join(TRAINER_CLIENTS_DIR, clientId, EVENTS_FILE);
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
 * @param {object[]} events
 */
function writeEvents(clientId, events) {
  const dir = join(TRAINER_CLIENTS_DIR, clientId);
  ensureTrainerDataDirs();
  writeFileSync(join(dir, EVENTS_FILE), `${JSON.stringify(events, null, 2)}\n`, "utf8");
}

/**
 * @param {string} clientId
 * @param {string} type
 * @param {Record<string, unknown>} [payload]
 * @returns {{ ok: true, event: object } | { ok: false, error: string }}
 */
export function appendTrainerEvent(clientId, type, payload = {}) {
  const id = String(clientId ?? "").trim();
  if (!id) return { ok: false, error: "clientId required" };
  const t = String(type ?? "").trim();
  if (!t) return { ok: false, error: "type required" };
  const ev = {
    id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type: t,
    at: new Date().toISOString(),
    payload: payload && typeof payload === "object" ? payload : {},
  };
  const list = readEvents(id);
  list.push(ev);
  writeEvents(id, list);
  return { ok: true, event: ev };
}

/**
 * @param {string} clientId
 * @returns {object[]}
 */
export function listTrainerEvents(clientId) {
  const id = String(clientId ?? "").trim();
  if (!id) return [];
  return readEvents(id);
}

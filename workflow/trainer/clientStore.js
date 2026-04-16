/**
 * Trainer clients (entities) — one folder per client under workflow/trainer/data/clients/<id>/.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { ensureTrainerDataDirs, TRAINER_CLIENTS_DIR } from "./paths.js";

/**
 * @param {string} displayName
 * @returns {{ ok: true, client: object } | { ok: false, error: string }}
 */
export function createTrainerClient(displayName) {
  const name = String(displayName ?? "").trim();
  if (!name) return { ok: false, error: "displayName required" };
  ensureTrainerDataDirs();
  const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const dir = join(TRAINER_CLIENTS_DIR, id);
  mkdirSync(dir, { recursive: true });
  const client = {
    id,
    type: "trainer_client",
    displayName: name,
    templateId: "trainer_progress_v1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, "client.json"), `${JSON.stringify(client, null, 2)}\n`, "utf8");
  return { ok: true, client };
}

/**
 * @returns {{ ok: true, clients: object[] } | { ok: false, error: string }}
 */
export function listTrainerClients() {
  ensureTrainerDataDirs();
  if (!existsSync(TRAINER_CLIENTS_DIR)) return { ok: true, clients: [] };
  /** @type {object[]} */
  const out = [];
  for (const name of readdirSync(TRAINER_CLIENTS_DIR, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const p = join(TRAINER_CLIENTS_DIR, name.name, "client.json");
    if (!existsSync(p)) continue;
    try {
      const c = JSON.parse(readFileSync(p, "utf8"));
      if (c && typeof c === "object") out.push(c);
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  return { ok: true, clients: out };
}

/**
 * @param {string} clientId
 * @returns {{ ok: true, client: object } | { ok: false, error: string }}
 */
export function getTrainerClient(clientId) {
  const id = String(clientId ?? "").trim();
  if (!id) return { ok: false, error: "clientId required" };
  const p = join(TRAINER_CLIENTS_DIR, id, "client.json");
  if (!existsSync(p)) return { ok: false, error: "not found" };
  try {
    const c = JSON.parse(readFileSync(p, "utf8"));
    if (!c || typeof c !== "object") return { ok: false, error: "invalid" };
    return { ok: true, client: c };
  } catch {
    return { ok: false, error: "read failed" };
  }
}

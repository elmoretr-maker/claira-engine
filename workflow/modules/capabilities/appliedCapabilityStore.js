/**
 * Persist applied capability dry-runs (Phase 3). Node-only file I/O.
 */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_REL = "workflow/feedback/data/applied_capabilities.json";

/**
 * @param {string} relOrAbs
 */
function resolveFromCwd(relOrAbs) {
  const r = String(relOrAbs ?? "").trim();
  if (!r) return "";
  if (/^[A-Za-z]:[\\/]/.test(r) || r.startsWith("/") || r.startsWith("\\\\")) return path.normalize(r);
  const cwd = typeof process.cwd === "function" ? process.cwd() : ".";
  return path.resolve(cwd, r);
}

function storePath() {
  const override = process.env.APPLIED_CAPABILITIES_PATH;
  if (typeof override === "string" && override.trim()) return resolveFromCwd(override.trim());
  return resolveFromCwd(DEFAULT_REL);
}

/**
 * @returns {string}
 */
function dirnameSafe(p) {
  return path.dirname(p);
}

/**
 * @typedef {{
 *   rowId: string,
 *   moduleId: string,
 *   originalValues: Record<string, unknown>,
 *   finalValues: Record<string, unknown>,
 *   timestamp: number,
 *   simulation?: Record<string, unknown>,
 * }} AppliedCapabilityRecord
 */

/**
 * @returns {{ version: number, byRowId: Record<string, AppliedCapabilityRecord> }}
 */
export function readAppliedCapabilityStore() {
  const p = storePath();
  if (!fs.existsSync(p)) return { version: 1, byRowId: {} };
  try {
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw);
    const byRowId =
      j != null && typeof j === "object" && !Array.isArray(j) && j.byRowId != null && typeof j.byRowId === "object"
        ? /** @type {Record<string, AppliedCapabilityRecord>} */ ({ ...j.byRowId })
        : {};
    return { version: 1, byRowId };
  } catch {
    return { version: 1, byRowId: {} };
  }
}

/**
 * @param {AppliedCapabilityRecord} record
 */
export function upsertAppliedCapabilityRecord(record) {
  const rowId = String(record.rowId ?? "").trim();
  if (!rowId) throw new Error("rowId required");
  const p = storePath();
  const dir = dirnameSafe(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const store = readAppliedCapabilityStore();
  store.byRowId[rowId] = {
    rowId,
    moduleId: String(record.moduleId ?? ""),
    originalValues:
      record.originalValues != null && typeof record.originalValues === "object" && !Array.isArray(record.originalValues)
        ? /** @type {Record<string, unknown>} */ ({ ...record.originalValues })
        : {},
    finalValues:
      record.finalValues != null && typeof record.finalValues === "object" && !Array.isArray(record.finalValues)
        ? /** @type {Record<string, unknown>} */ ({ ...record.finalValues })
        : {},
    timestamp: typeof record.timestamp === "number" && Number.isFinite(record.timestamp) ? record.timestamp : Date.now(),
    ...(record.simulation != null && typeof record.simulation === "object"
      ? { simulation: /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(record.simulation))) }
      : {}),
  };
  fs.writeFileSync(p, JSON.stringify(store, null, 2), "utf8");
  return store;
}

/**
 * @param {Record<string, AppliedCapabilityRecord>} byRowId
 */
export function replaceAppliedCapabilityStore(byRowId) {
  const p = storePath();
  const dir = dirnameSafe(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const store = { version: 1, byRowId: { ...byRowId } };
  fs.writeFileSync(p, JSON.stringify(store, null, 2), "utf8");
  return store;
}

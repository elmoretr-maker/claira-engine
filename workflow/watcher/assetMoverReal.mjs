/**
 * Phase 10 — Node-only real filesystem moves for asset_mover (not imported by the Vite client bundle).
 */

import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} destFile
 * @returns {string}
 */
function allocateUniqueDestPath(destFile) {
  if (!fs.existsSync(destFile)) return destFile;
  const dir = path.dirname(destFile);
  const base = path.basename(destFile);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  let n = 1;
  while (n < 100000) {
    const candidate = path.join(dir, `${stem}_${n}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    n += 1;
  }
  throw new Error("allocateUniqueDestPath: could not allocate filename");
}

/**
 * @param {string} cwd
 * @param {string} ref
 * @returns {string}
 */
function resolveSourcePath(cwd, ref) {
  const r = String(ref ?? "").trim();
  if (!r) throw new Error("empty source ref");
  return path.isAbsolute(r) ? path.normalize(r) : path.resolve(cwd, r);
}

/**
 * @param {string} cwd
 * @param {string} destinationSimulated
 * @returns {string}
 */
function resolveDestPath(cwd, destinationSimulated) {
  const d = String(destinationSimulated ?? "").trim().replace(/\//g, path.sep);
  if (!d) throw new Error("empty destination");
  return path.resolve(cwd, d);
}

/**
 * @typedef {{
 *   assetId: string,
 *   sourceRef: string,
 *   destinationSimulated: string,
 *   dryRun: boolean,
 *   duplicateResolution?: string,
 * }} MoveLogEntry
 */

/**
 * Apply real renames for moveLog rows. Never overwrites: uses allocateUniqueDestPath if needed.
 * @param {{
 *   cwd: string,
 *   moveLog: MoveLogEntry[],
 *   onLog?: (line: string) => void,
 * }} opts
 * @returns {{ applied: Array<{ from: string, to: string, assetId: string }>, errors: string[] }}
 */
export function applyRealAssetMovesFromLog(opts) {
  const cwd = String(opts.cwd ?? process.cwd()).trim() || process.cwd();
  const log = Array.isArray(opts.moveLog) ? opts.moveLog : [];
  const onLog = typeof opts.onLog === "function" ? opts.onLog : () => {};

  /** @type {{ from: string, to: string, assetId: string }[]} */
  const applied = [];
  /** @type {string[]} */
  const errors = [];

  for (const row of log) {
    if (row == null || typeof row !== "object") continue;
    if (row.dryRun === true) continue;
    const assetId = String(row.assetId ?? "");
    const sourceRef = String(row.sourceRef ?? "");
    const destSim = String(row.destinationSimulated ?? "");
    if (!assetId || !sourceRef || !destSim) {
      errors.push(`skip row: missing fields (${assetId})`);
      continue;
    }
    try {
      const from = resolveSourcePath(cwd, sourceRef);
      if (!fs.existsSync(from)) {
        errors.push(`source missing: ${from}`);
        onLog(`[asset_mover] skip (missing source): ${from}`);
        continue;
      }
      let to = resolveDestPath(cwd, destSim);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      to = allocateUniqueDestPath(to);
      if (fs.existsSync(to)) {
        errors.push(`destination still exists: ${to}`);
        continue;
      }
      fs.renameSync(from, to);
      applied.push({ from, to, assetId });
      onLog(`[asset_mover] moved: ${from} -> ${to}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
      onLog(`[asset_mover] error: ${msg}`);
    }
  }

  return { applied, errors };
}

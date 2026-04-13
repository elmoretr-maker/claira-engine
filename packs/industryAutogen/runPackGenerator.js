/**
 * Invoke dev/generate_pack_system.mjs as a subprocess (no edits to generator internals).
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const GENERATOR = join(ROOT, "dev", "generate_pack_system.mjs");

/**
 * @param {string[]} args
 * @returns {{ ok: boolean, stdout: string, stderr: string }}
 */
export function runPackGenerator(args) {
  if (!existsSync(GENERATOR)) {
    return { ok: false, stdout: "", stderr: `Missing generator: ${GENERATOR}` };
  }
  const r = spawnSync(process.execPath, [GENERATOR, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  const stdout = typeof r.stdout === "string" ? r.stdout : "";
  const stderr = typeof r.stderr === "string" ? r.stderr : "";
  const err = r.error instanceof Error ? r.error.message : "";
  if (r.status !== 0) {
    return { ok: false, stdout, stderr: stderr || err || `exit ${r.status}` };
  }
  return { ok: true, stdout, stderr };
}

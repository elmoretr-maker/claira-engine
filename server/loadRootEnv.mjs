import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Merge variables from repo-root `.env` into `process.env` (no extra dependency).
 * Skips keys that are already set in the environment.
 */
export function loadRootEnv() {
  const envPath = path.join(engineRoot, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    if (!k) continue;
    let v = trimmed.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
      (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

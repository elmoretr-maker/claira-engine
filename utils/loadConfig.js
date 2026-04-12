import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Deep-clone parsed config so callers never mutate on-disk state.
 * @returns {Record<string, unknown>}
 */
function deepCloneConfig(obj) {
  if (typeof structuredClone === "function") {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

/** Load engine.config.json from package root — always returns a fresh deep copy. */
export function loadEngineConfig() {
  const p = join(__dirname, "..", "engine.config.json");
  const raw = readFileSync(p, "utf8");
  const parsed = JSON.parse(raw);
  return deepCloneConfig(parsed);
}

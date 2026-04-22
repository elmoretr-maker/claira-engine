/**
 * JSON-backed metadata for workspace product sync (.claira/metadata_store.json).
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/** @typedef {{ syncGeneration: number, pathToId: Record<string, string>, items: Record<string, { attributes?: Record<string, unknown> }> }} WorkspaceMetadataStore */

/**
 * @param {string} relPath
 * @returns {string}
 */
export function normRel(relPath) {
  return String(relPath ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
}

/**
 * @param {string} clairaDir — `.claira` directory inside workspace root
 * @returns {WorkspaceMetadataStore}
 */
export function loadStore(clairaDir) {
  const file = join(clairaDir, "metadata_store.json");
  if (!existsSync(file)) {
    return {
      syncGeneration: 0,
      pathToId: {},
      items: {},
    };
  }
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return {
      syncGeneration: Number.isFinite(parsed.syncGeneration) ? parsed.syncGeneration : 0,
      pathToId: typeof parsed.pathToId === "object" && parsed.pathToId !== null ? parsed.pathToId : {},
      items: typeof parsed.items === "object" && parsed.items !== null ? parsed.items : {},
    };
  } catch {
    return {
      syncGeneration: 0,
      pathToId: {},
      items: {},
    };
  }
}

/**
 * @param {string} clairaDir
 * @param {WorkspaceMetadataStore} store
 */
export function saveStore(clairaDir, store) {
  const file = join(clairaDir, "metadata_store.json");
  writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
}

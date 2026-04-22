/**
 * Read model for "generator" state under `.claira/` (template + snapshot for workspace tools).
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { loadStore } from "./metadataStore.js";

/**
 * @param {string} clairaDir
 * @param {string} [expectedGeneration]
 */
export function assertFreshGeneratorReadModel(clairaDir, expectedGeneration) {
  const store = loadStore(clairaDir);
  if (expectedGeneration != null && store.syncGeneration !== expectedGeneration) {
    throw new Error("Workspace data changed while you were editing—refresh and try again.");
  }
}

/**
 * Load generator snapshot/manifest from `.claira/generator_snapshot.json` when present.
 *
 * @param {string} clairaDir
 * @param {{ industry?: string, includeTemplateFallback?: boolean }} [options]
 */
export function loadGeneratorReadModel(clairaDir, options = {}) {
  const store = loadStore(clairaDir);
  const snapPath = join(clairaDir, "generator_snapshot.json");
  if (!existsSync(snapPath)) {
    return {
      ok: false,
      code: "NO_GENERATOR_SNAPSHOT",
      error:
        "No generator snapshot in this workspace yet. This is normal for a new category—use the builder, then sync or save once.",
    };
  }
  let snapshot;
  let manifest;
  try {
    const raw = readFileSync(snapPath, "utf8");
    const parsed = JSON.parse(raw);
    snapshot = parsed.snapshot ?? parsed;
    manifest = parsed.manifest ?? { version: 1, segments: [] };
  } catch {
    return {
      ok: false,
      code: "CORRUPT_GENERATOR_SNAPSHOT",
      error: "Could not read generator_snapshot.json — delete .claira/generator_snapshot.json and try again.",
    };
  }

  const templateFallback = Boolean(options.includeTemplateFallback);

  return {
    ok: true,
    store,
    snapshot,
    manifest,
    templateFallback,
    paths: {
      snapshotPath: snapPath,
      industry: typeof options.industry === "string" ? options.industry : "",
    },
  };
}

/**
 * Apply a predefined industry pack: structure + reference embeddings.
 * @module
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { writeActivePackMeta } from "../interfaces/packReference.js";
import { InvalidPackError, validatePackTriad } from "../workflow/packs/validatePackTriad.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/**
 * @param {string} raw
 */
function sanitizeIndustry(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || !/^[a-z0-9_-]+$/.test(s)) return "";
  return s;
}

/**
 * Copy packs/<industry>/structure.json into config/ and optional reference_embeddings.json into references/.
 * If the pack has no reference_embeddings.json, writes an empty JSON object (runtime text/user/base refs still apply).
 * Clears in-memory reference embedding cache so the next load recomputes.
 *
 * @param {string} industry — e.g. "game-dev"
 * @returns {Promise<void>}
 */
export async function loadIndustryPack(industry) {
  const slug = sanitizeIndustry(industry);
  if (!slug) {
    throw new Error("loadIndustryPack: invalid industry (use letters, numbers, _ -)");
  }

  const triad = validatePackTriad(slug);
  if (!triad.valid) {
    throw new InvalidPackError(triad.errors);
  }

  const packDir = join(ROOT, "packs", slug);
  const srcStruct = join(packDir, "structure.json");
  const srcRef = join(packDir, "reference_embeddings.json");
  if (!existsSync(srcStruct)) {
    throw new Error(`loadIndustryPack: missing ${srcStruct}`);
  }
  const destStruct = join(ROOT, "config", "structure.json");
  const destRef = join(ROOT, "references", "reference_embeddings.json");
  const srcPackRef = join(packDir, "reference.json");
  const destPackRef = join(ROOT, "config", "pack_reference.json");

  mkdirSync(join(ROOT, "config"), { recursive: true });
  mkdirSync(join(ROOT, "references"), { recursive: true });

  copyFileSync(srcStruct, destStruct);
  if (existsSync(srcRef)) {
    copyFileSync(srcRef, destRef);
  } else {
    writeFileSync(destRef, "{}\n", "utf8");
  }

  if (existsSync(srcPackRef)) {
    copyFileSync(srcPackRef, destPackRef);
  } else {
    writeFileSync(destPackRef, `${JSON.stringify({ version: 1, categories: {} }, null, 2)}\n`, "utf8");
  }

  writeActivePackMeta(slug);

  const { clearReferenceEmbeddingsCache } = await import("../interfaces/referenceLoader.js");
  clearReferenceEmbeddingsCache();

  console.log("Loaded industry pack:", slug);
}

/**
 * Optional offline build: references/reference_embeddings.json from PNGs in references/<category>/.
 * Normal operation uses runtime {@link ../interfaces/referenceLoader.js}; this script remains for batch export.
 * Run from package root: node vision/buildReferences.js
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { readdir } from "fs/promises";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { isSupportedImageFilename } from "../adapters/supportedImages.js";
import { readStructureCategories } from "../interfaces/referenceLoader.js";
import { clearUserReferencesPendingRebuild } from "../learning/addUserReference.js";
import { getImageEmbedding } from "./clipEmbedder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REF_ROOT = join(ROOT, "references");
const OUT_FILE = join(REF_ROOT, "reference_embeddings.json");

const RESERVED_TOP_LEVEL = new Set(["user", "base"]);

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listRasterInDir(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.isFile() && isSupportedImageFilename(e.name)) {
      out.push(join(dir, e.name));
    }
  }
  return out.sort();
}

/**
 * @returns {Promise<string[]>}
 */
async function discoverCategoriesFromReferenceDirs() {
  if (!existsSync(REF_ROOT)) return [];
  const entries = await readdir(REF_ROOT, { withFileTypes: true });
  /** @type {string[]} */
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    if (RESERVED_TOP_LEVEL.has(e.name)) continue;
    out.push(e.name);
  }
  return out.sort();
}

/**
 * @returns {Promise<string[]>}
 */
async function resolveCategoryFolders() {
  const fromStruct = Object.keys(readStructureCategories());
  if (fromStruct.length > 0) return fromStruct;
  return discoverCategoriesFromReferenceDirs();
}

async function main() {
  const CATEGORIES = await resolveCategoryFolders();
  mkdirSync(REF_ROOT, { recursive: true });
  for (const cat of CATEGORIES) {
    mkdirSync(join(REF_ROOT, cat), { recursive: true });
  }

  /** @type {Record<string, Array<{ v: number[], source: string, meta?: string }>>} */
  const out = {};
  for (const cat of CATEGORIES) {
    const dir = join(REF_ROOT, cat);
    const paths = await listRasterInDir(dir);
    out[cat] = [];
    for (const p of paths) {
      const r = await getImageEmbedding(p);
      if (r.error) {
        console.error(`[skip] ${p}: ${r.message}`);
        continue;
      }
      out[cat].push({ v: [...r.embedding], source: "base", meta: basename(p) });
    }
  }

  const userRoot = join(REF_ROOT, "user");
  if (existsSync(userRoot)) {
    const userEntries = await readdir(userRoot, { withFileTypes: true });
    for (const e of userEntries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const label = e.name;
      const dir = join(userRoot, label);
      const paths = await listRasterInDir(dir);
      if (paths.length === 0) continue;
      if (!out[label]) out[label] = [];
      for (const p of paths) {
        const r = await getImageEmbedding(p);
        if (r.error) {
          console.error(`[skip] ${p}: ${r.message}`);
          continue;
        }
        out[label].push({ v: [...r.embedding], source: "user", meta: basename(p) });
      }
    }
  }

  writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_FILE}`);
  for (const cat of CATEGORIES) {
    console.log(`  ${cat}: ${out[cat]?.length ?? 0} vector(s)`);
  }
  const extra = Object.keys(out)
    .filter((k) => !CATEGORIES.includes(k))
    .sort();
  for (const k of extra) {
    console.log(`  ${k} (user refs): ${out[k].length} vector(s)`);
  }

  clearUserReferencesPendingRebuild();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

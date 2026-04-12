/**
 * Build references/reference_embeddings.json from PNGs in references/<category>/.
 * Run from package root: node vision/buildReferences.js
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { readdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getImageEmbedding } from "./clipEmbedder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REF_ROOT = join(ROOT, "references");
const CATEGORIES = ["terrain", "prop", "debris"];
const OUT_FILE = join(REF_ROOT, "reference_embeddings.json");

async function listPngInDir(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith(".png")) {
      out.push(join(dir, e.name));
    }
  }
  return out.sort();
}

async function main() {
  mkdirSync(REF_ROOT, { recursive: true });
  for (const cat of CATEGORIES) {
    mkdirSync(join(REF_ROOT, cat), { recursive: true });
  }

  /** @type {Record<string, number[][]>} */
  const out = {};
  for (const cat of CATEGORIES) {
    const dir = join(REF_ROOT, cat);
    const paths = await listPngInDir(dir);
    out[cat] = [];
    for (const p of paths) {
      const r = await getImageEmbedding(p);
      if (r.error) {
        console.error(`[skip] ${p}: ${r.message}`);
        continue;
      }
      out[cat].push([...r.embedding]);
    }
  }

  writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_FILE}`);
  for (const cat of CATEGORIES) {
    console.log(`  ${cat}: ${out[cat].length} vector(s)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

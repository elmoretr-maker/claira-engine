/**
 * Scan product image files under a workspace context root (category = first-level subdir).
 */

import { existsSync, readdirSync } from "fs";
import { extname, join } from "path";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".heic", ".heif"]);

/**
 * @param {string} contextRoot — absolute workspace root
 * @returns {{ categories: string[], items: Array<{ relPath: string, category: string, basename: string }> }}
 */
export function scanProductFiles(contextRoot) {
  const items = /** @type {Array<{ relPath: string, category: string, basename: string }>} */ ([]);
  const categories = /** @type {string[]} */ ([]);
  if (!existsSync(contextRoot)) {
    return { categories, items };
  }
  let top;
  try {
    top = readdirSync(contextRoot, { withFileTypes: true });
  } catch {
    return { categories, items };
  }
  for (const ent of top) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(".") || ent.name === "inbox") continue;
    const cat = ent.name;
    categories.push(cat);
    const catDir = join(contextRoot, cat);
    walkFiles(catDir, cat, "");
  }

  /**
   * @param {string} dir
   * @param {string} category
   * @param {string} relWithinCat
   */
  function walkFiles(dir, category, relWithinCat) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      const relPiece = relWithinCat ? `${relWithinCat}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walkFiles(full, category, relPiece);
        continue;
      }
      const ext = extname(e.name).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      items.push({
        category,
        basename: e.name,
        relPath: `${category}/${relPiece}`.replace(/\\/g, "/"),
      });
    }
  }

  categories.sort();
  items.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { categories, items };
}

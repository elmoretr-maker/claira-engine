/**
 * Validates structure-driven OCR hints against packs/ecommerce/structure.json.
 * Run: node dev/ecommerce_structure_hint_smoke.mjs
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { suggestLabelFromText } from "../core/textAnalysis.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STRUCT_PATH = join(__dirname, "../packs/ecommerce/structure.json");

const raw = readFileSync(STRUCT_PATH, "utf8");
const parsed = JSON.parse(raw);
const categories = parsed?.categories;
if (!categories || typeof categories !== "object") {
  console.error("FAIL: invalid ecommerce structure.json");
  process.exit(1);
}

const allowed = new Set(Object.keys(categories).map((k) => String(k).trim().toLowerCase()));

/** @type {Array<{ text: string, expect: string, note?: string }>} */
const cases = [
  { text: "Thank you for your purchase — receipt #4421", expect: "documents", note: "receipt" },
  { text: "INVOICE total due $49.99 payment terms net 30", expect: "documents", note: "invoice" },
  { text: "Order confirmation #A-88 tracking included", expect: "documents", note: "order confirmation phrase" },
  { text: "Slim fit denim jeans with stretch waist", expect: "bottoms", note: "jeans" },
  { text: "Cotton crew neck t-shirt white size M", expect: "tops", note: "t-shirt phrase" },
  { text: "Women's cocktail dress black size8", expect: "dresses", note: "cocktail dress" },
  { text: "Leather loafers men's brown casual", expect: "shoes", note: "loafers" },
  { text: "Crossbody bag leather strap adjustable", expect: "bags", note: "crossbody bag phrase" },
  { text: "Flat lay clothing photography white backdrop", expect: "product_flat", note: "flat lay clothing" },
  { text: "Fashion model wearing outfit spring collection", expect: "product_on_model", note: "model + outfit" },
  { text: "Cardboard shipping box with barcode label", expect: "packaging", note: "box + label (packaging context)" },
  { text: "Sterling silver necklace pendant chain", expect: "accessories", note: "necklace" },
  { text: "Waterproof trench coat beige belted", expect: "outerwear", note: "trench coat phrase" },
];

let failed = 0;
for (const { text, expect, note } of cases) {
  const got = suggestLabelFromText(text, { categories, allowedLabels: allowed });
  if (got !== expect) {
    console.error(`FAIL [${note ?? text.slice(0, 40)}]: expected "${expect}", got "${got}"`);
    failed += 1;
  }
}

/** Keyword coverage: no category empty, reasonable diversity */
const emptyCats = Object.entries(categories).filter(([, kws]) => !Array.isArray(kws) || kws.length === 0);
if (emptyCats.length) {
  console.error("FAIL: empty keyword lists", emptyCats.map(([k]) => k));
  failed += 1;
}

const totalKw = Object.values(categories).reduce((n, kws) => n + (Array.isArray(kws) ? kws.length : 0), 0);
console.log("Ecommerce structure:", Object.keys(categories).length, "categories,", totalKw, "keywords");

if (failed > 0) {
  console.error("ecommerce_structure_hint_smoke: FAILED", failed);
  process.exit(1);
}
console.log("ecommerce_structure_hint_smoke OK (", cases.length, "hint cases)");

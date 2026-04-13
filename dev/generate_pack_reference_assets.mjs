/**
 * Generate synthetic reference_assets (PNG images, mock JSON/txt, patterns.json) for a pack.
 * No network access — local canvas only. Run from repo root:
 *   node dev/generate_pack_reference_assets.mjs --pack medical
 *   node dev/generate_pack_reference_assets.mjs --pack ecommerce
 */
import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const IMAGES_PER_CATEGORY = 6;

/**
 * @param {string} slug
 */
function loadStructureCategories(slug) {
  const p = join(ROOT, "packs", slug, "structure.json");
  const j = JSON.parse(readFileSync(p, "utf8"));
  const c = j?.categories;
  if (!c || typeof c !== "object") return /** @type {Record<string, string[]>} */ ({});
  return /** @type {Record<string, string[]>} */ (c);
}

/**
 * @param {string} category
 * @param {number} i
 */
function variantFor(category, i) {
  const titles = [
    { title: "Clean scan", sub: "high contrast layout structured rows", bg: "#f5f5f0" },
    { title: "Office copy", sub: "slight skew mild noise fax style", bg: "#e8e4dc" },
    { title: "Mobile photo", sub: "perspective glare uneven lighting", bg: "#d4d0c8" },
    { title: "Archived print", sub: "faded toner margin notes", bg: "#dcd8d0" },
    { title: "Dense layout", sub: "multi column small type tables", bg: "#eeeae2" },
    { title: "Handwritten mix", sub: "annotations arrows sticky note area", bg: "#ebe7dd" },
  ];
  const v = titles[i % titles.length];
  return {
    ...v,
    footer: `${category.replace(/_/g, " ")} · synthetic ${i + 1}`,
  };
}

/**
 * @param {string} category
 * @param {number} index
 */
function renderPng(category, index) {
  const v = variantFor(category, index);
  const w = 384;
  const h = 512;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = v.bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#222";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText(v.title, 18, 40);

  ctx.font = "14px sans-serif";
  ctx.fillStyle = "#444";
  ctx.fillText(v.sub, 18, 68);

  ctx.strokeStyle = "#999";
  ctx.lineWidth = 1;
  ctx.strokeRect(14, 90, w - 28, h - 120);

  for (let r = 0; r < 8; r++) {
    ctx.strokeStyle = `rgba(0,0,0,${0.06 + (r % 3) * 0.04})`;
    ctx.beginPath();
    ctx.moveTo(24, 110 + r * 42);
    ctx.lineTo(w - 24, 110 + r * 42);
    ctx.stroke();
  }

  ctx.fillStyle = "#666";
  ctx.font = "11px monospace";
  ctx.fillText(v.footer, 18, h - 24);

  return canvas.toBuffer("image/png");
}

/**
 * @param {string} slug
 * @param {string} category
 */
function sampleDocumentObject(slug, category) {
  if (slug === "medical") {
    if (category === "lab_results") {
      return {
        patient: "John Doe",
        test: "CBC",
        result: "Normal",
        values: { WBC: "5.5", RBC: "4.8", PLT: "250" },
        notes: "Synthetic mock lab report for reference only.",
      };
    }
    if (category === "imaging") {
      return {
        study: "MRI brain without contrast",
        patient_id: "SYN-1001",
        findings: "No acute abnormality — mock summary.",
        modality: "MRI",
      };
    }
    return {
      category,
      patient: "Jane Sample",
      document_type: "synthetic_medical_mock",
      summary: `Representative text cues for ${category.replace(/_/g, " ")}.`,
    };
  }
  if (slug === "ecommerce") {
    return {
      sku: `SKU-${category.toUpperCase().slice(0, 6)}-001`,
      title: `Sample ${category.replace(/_/g, " ")} listing`,
      price: "29.99",
      currency: "USD",
      notes: "Synthetic catalog row for reference only.",
    };
  }
  return {
    category,
    pack: slug,
    note: "Synthetic structured mock document.",
  };
}

/**
 * @param {string} slug
 * @param {Record<string, string[]>} categories
 */
function buildPatterns(slug, categories) {
  /** @type {Record<string, object>} */
  const out = {};
  for (const [cat, kws] of Object.entries(categories)) {
    const kw = Array.isArray(kws) ? kws.slice(0, 12) : [];
    out[cat] = {
      expected_elements: ["title or header region", "primary subject block", "readable text or labels"],
      optional_elements: ["footer metadata", "logo or stamp area", "handwritten annotation"],
      visual_traits: [
        "document-style layout",
        "mixed print quality",
        slug === "ecommerce" ? "product-forward framing" : "clinical paperwork styling",
      ],
      keywords: kw,
    };
  }
  return out;
}

/**
 * @param {string} slug
 */
function runPack(slug) {
  const categories = loadStructureCategories(slug);
  const keys = Object.keys(categories);
  if (keys.length === 0) throw new Error(`No categories for pack ${slug}`);

  const base = join(ROOT, "packs", slug, "reference_assets");
  const imgRoot = join(base, "images");
  const docRoot = join(base, "documents");
  mkdirSync(imgRoot, { recursive: true });
  mkdirSync(docRoot, { recursive: true });

  for (const cat of keys) {
    const imgDir = join(imgRoot, cat);
    mkdirSync(imgDir, { recursive: true });
    for (let i = 0; i < IMAGES_PER_CATEGORY; i++) {
      const buf = renderPng(cat, i);
      writeFileSync(join(imgDir, `synthetic_${String(i + 1).padStart(2, "0")}.png`), buf);
    }
    const docDir = join(docRoot, cat);
    mkdirSync(docDir, { recursive: true });
    writeFileSync(
      join(docDir, "sample.json"),
      `${JSON.stringify(sampleDocumentObject(slug, cat), null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(docDir, "sample.txt"),
      `Synthetic reference text for ${cat} (${slug} pack).\nKeywords: ${(categories[cat] ?? []).slice(0, 8).join(", ")}\n`,
      "utf8",
    );
  }

  const patterns = buildPatterns(slug, categories);
  writeFileSync(join(base, "patterns.json"), `${JSON.stringify(patterns, null, 2)}\n`, "utf8");

  console.log(`Wrote reference_assets for ${slug}: ${keys.length} categories × ${IMAGES_PER_CATEGORY} images + documents + patterns.json`);
}

const arg = process.argv.find((a) => a.startsWith("--pack="));
const pack = arg ? arg.slice(7) : process.argv[process.argv.indexOf("--pack") + 1];
if (!pack || !/^[a-z0-9_-]+$/.test(pack)) {
  console.error("Usage: node dev/generate_pack_reference_assets.mjs --pack <medical|ecommerce|...>");
  process.exit(1);
}

runPack(pack);

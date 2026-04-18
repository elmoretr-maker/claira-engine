/**
 * Repeatable pack / category generator — only touches packs/<industry>/ (no core engine edits).
 *
 *   node dev/generate_pack_system.mjs --industry medical --category appointments
 *   node dev/generate_pack_system.mjs --industry ecommerce --category returns --group financial
 *   node dev/generate_pack_system.mjs --industry real-estate
 *
 * Industry templates: templates/<industry>.js (keyword hints, pattern structure, process copy, export const version).
 * Without a template you must pass --allow-generic; otherwise generation exits.
 *
 * Safety: refuses to overwrite an existing category; refuses to create a pack if the pack dir already exists (use --category on existing pack).
 *
 *   node dev/generate_pack_system.mjs --industry my-pack --repair-coverage [--allow-generic]
 *     Fills missing reference images/documents, merges patterns from structure, ensures processes.json entries,
 *     and expands categories below the keyword minimum (does not remove categories).
 */

import { createCanvas } from "@napi-rs/canvas";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { buildIndustryReport } from "../packs/industryAutogen/coverageEvaluator.js";
import {
  MAX_REPAIR_ITERS,
  mergeTemplateWithRepairJson,
  refineRepairLayerFromReport,
  repairTargetMet,
} from "../packs/industryAutogen/templateRepairLayer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const KEYWORD_TARGET_MIN = 10;
const KEYWORD_TARGET_MAX = 20;
const IMAGES_PER_CATEGORY = 7;

/** @typedef {{ id: string, label: string, description: string, re: RegExp }} GroupRule */

/** @type {GroupRule[]} */
const GROUP_RULES = [
  {
    id: "documents",
    label: "Documents",
    description: "Paperwork, forms, and text-heavy records.",
    re: /document|form|record|chart|referral|intake|consent|paperwork|letter|report text|summary|note/i,
  },
  {
    id: "visual",
    label: "Visual",
    description: "Imagery, scans, and visual media.",
    re: /image|photo|picture|scan|radiology|xray|x-ray|mri|ct |ultrasound|selfie|screenshot|render|texture|sprite/i,
  },
  {
    id: "financial",
    label: "Billing & Financial",
    description: "Money, claims, and payer context.",
    re: /bill|invoice|payment|insurance|claim|financial|receipt|tax|ledger|eob|premium|deductible/i,
  },
  {
    id: "clinical",
    label: "Clinical",
    description: "Diagnostics, meds, and clinical findings.",
    re: /lab|test result|specimen|pathology|prescription|rx|medication|vital|cbc|panel|culture/i,
  },
  {
    id: "scheduling",
    label: "Scheduling",
    description: "Calendars, bookings, and visit timing.",
    re: /appointment|schedul|calendar|booking|slot|reminder|check[- ]?in/i,
  },
  {
    id: "legal",
    label: "Legal & Compliance",
    description: "Contracts, policies, and audits.",
    re: /legal|contract|compliance|policy|audit|hipaa|consent form|notary/i,
  },
  {
    id: "operations",
    label: "Operations",
    description: "Inventory, logistics, and fulfillment.",
    re: /inventory|shipping|warehouse|fulfill|logistics|parcel|supply chain/i,
  },
  {
    id: "product",
    label: "Catalog & Products",
    description: "Merchandise and product imagery.",
    re: /product|sku|listing|catalog|merch|apparel|footwear|accessory|flat lay|on model/i,
  },
];

/**
 * @param {string} raw
 */
function normalizePackSlug(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

/**
 * @param {string} raw
 */
function normalizeCategoryKey(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]+/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * @param {string} catKey
 */
function humanLabel(catKey) {
  return catKey
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * @param {string} packSlug
 */
function inferIndustryFlavor(packSlug) {
  const s = packSlug.toLowerCase();
  if (/med|health|clinic|patient/.test(s)) return "medical";
  if (/shop|store|commerce|retail|catalog/.test(s)) return "ecommerce";
  if (/game|dev|asset|studio/.test(s)) return "gamedev";
  if (/real|estate|property|realt/.test(s)) return "realestate";
  return "general";
}

/**
 * @param {string} packSlug
 * @returns {Promise<{ template: object | null, version: number | null }>}
 */
async function loadIndustryTemplate(packSlug) {
  const slug = normalizePackSlug(packSlug);
  if (!slug) return { template: null, version: null };
  const fp = join(ROOT, "templates", `${slug}.js`);
  if (!existsSync(fp)) return { template: null, version: null };
  try {
    const mod = await import(pathToFileURL(fp).href);
    const ver =
      typeof mod.version === "number" && Number.isFinite(mod.version) ? Math.trunc(mod.version) : 1;
    const t = mod.default ?? {
      extraKeywordHints: mod.extraKeywordHints,
      patternStructure: mod.patternStructure,
      processIntel: mod.processIntel,
    };
    if (!t || typeof t !== "object") {
      console.warn(`Industry template invalid (${fp})`);
      return { template: null, version: null };
    }
    const merged = mergeTemplateWithRepairJson(t, slug);
    return { template: merged, version: ver };
  } catch (e) {
    console.warn(`Industry template failed to load (${fp}):`, e instanceof Error ? e.message : e);
    return { template: null, version: null };
  }
}

function hintPhrases(flavor, catKey) {
  const base = catKey.replace(/_/g, " ");
  /** @type {string[]} */
  const hints = [];
  if (flavor === "medical") {
    hints.push(
      "patient",
      "clinical",
      "medical",
      "health",
      "visit",
      "provider",
      "physician",
      "hospital",
      "clinic",
      "care",
    );
  } else if (flavor === "ecommerce") {
    hints.push("product", "order", "sku", "listing", "catalog", "store", "shop", "buy", "cart", "checkout");
  } else if (flavor === "gamedev") {
    hints.push("asset", "mesh", "texture", "sprite", "model", "level", "game", "build", "export");
  } else if (flavor === "realestate") {
    hints.push("property", "listing", "lease", "deed", "closing", "buyer", "seller", "agent", "mls");
  } else {
    hints.push("document", "file", "record", "form", "page", "scan", "office", "workflow");
  }
  hints.push(base, `${base} document`, `${base} file`, `printed ${base}`, `scanned ${base}`);
  return hints;
}

/**
 * @param {string} phrase
 */
function simplePlural(phrase) {
  if (phrase.endsWith("s")) return phrase;
  if (phrase.endsWith("y") && phrase.length > 2) return phrase.slice(0, -1) + "ies";
  return `${phrase}s`;
}

/**
 * Meaningful keyword candidates when generic "variant N" / "autogen" fillers would be weak for embeddings.
 * @param {string} catKey
 * @param {string} base — catKey with underscores → spaces
 * @param {string} label — Title Case human label
 * @param {string} flavor — inferIndustryFlavor(packSlug)
 * @returns {string[]}
 */
function buildSemanticFallbackPhrases(catKey, base, label, flavor) {
  const b = base.trim().toLowerCase();
  const seen = new Set();
  /** @type {string[]} */
  const phrases = [];
  const add = (raw) => {
    const t = String(raw).trim().toLowerCase();
    if (t.length < 2 || seen.has(t)) return;
    seen.add(t);
    phrases.push(t);
  };

  const recordLike = [
    "document",
    "file",
    "record",
    "form",
    "copy",
    "scan",
    "packet",
    "summary",
    "report",
    "page",
    "image",
    "photo",
    "pdf",
    "attachment",
    "export",
    "upload",
  ];
  const preModifiers = [
    "example",
    "sample",
    "official",
    "professional",
    "standard",
    "internal",
    "submitted",
    "completed",
    "draft",
    "final",
    "signed",
    "unsigned",
    "printed",
    "scanned",
    "digital",
    "archived",
    "certified",
    "annotated",
    "redacted",
    "updated",
    "new",
    "master",
    "working",
  ];
  const trailingContext = [
    "for review",
    "for approval",
    "with attachments",
    "master copy",
    "working copy",
    "client facing",
    "internal use",
    "on file",
    "on record",
    "in folder",
    "batch",
    "folio",
  ];
  const roleOrSetting = [
    "administrative",
    "operational",
    "compliance",
    "reference",
    "supporting",
    "primary",
    "supplemental",
    "summary sheet",
    "cover sheet",
    "detail view",
  ];

  for (const r of recordLike) add(`${b} ${r}`);
  for (const p of preModifiers) add(`${p} ${b}`);
  for (const p of preModifiers) add(`${b} ${p} copy`);
  for (const t of trailingContext) add(`${b} ${t}`);
  for (const r of roleOrSetting) add(`${b} ${r}`);

  add(`${b} workflow`);
  add(`${b} intake`);
  add(`${b} routing`);
  add(`typical ${b}`);
  add(`blank ${b}`);
  add(`filled ${b}`);

  /** CLIP-oriented capture / quality cues (image–text alignment). */
  const visualPrefix = [
    "scanned",
    "printed",
    "photocopied",
    "digitized",
    "photo of",
    "picture of",
    "image of",
    "camera photo of",
    "phone photo of",
    "mobile photo of",
    "screenshot of",
    "blurry",
    "low quality",
    "low resolution",
    "grainy",
    "noisy",
    "faded",
    "skewed",
    "crooked scan of",
    "clean scan of",
    "high contrast",
    "poor lighting",
    "overexposed",
    "underexposed",
    "handheld photo of",
    "overhead photo of",
    "close up of",
  ];
  for (const v of visualPrefix) add(`${v} ${b}`);

  /** Incomplete framing, crop, and occlusion (robustness to bad crops / partial views). */
  const visualPartialFraming = [
    "cropped",
    "partial",
    "partially visible",
    "cut off",
    "truncated",
    "clipped",
    "zoomed",
    "zoomed in",
    "close crop",
    "tight crop",
    "edge of",
    "corner of",
    "off center",
    "off frame",
    "obstructed view of",
    "occluded",
    "half visible",
    "barely visible",
  ];
  for (const v of visualPartialFraming) add(`${v} ${b}`);

  const visualCompound = [
    `${b} scan`,
    `${b} photo`,
    `${b} picture`,
    `${b} still`,
    `${b} on screen`,
    `${b} on paper`,
    `${b} full page`,
    `${b} cropped`,
    `${b} partial in frame`,
    `${b} cut off at edge`,
    `${b} only partly visible`,
    `${b} with glare`,
    `${b} with shadows`,
    `${b} fax style`,
    `${b} thumbnail`,
  ];
  for (const line of visualCompound) add(line);

  if (flavor === "ecommerce") {
    add(`flat lay ${b}`);
    add(`on model ${b}`);
    add(`white background ${b}`);
    add(`packshot ${b}`);
  } else if (flavor === "medical") {
    add(`chart photo ${b}`);
    add(`bedside ${b} photo`);
  } else if (flavor === "gamedev") {
    add(`viewport capture ${b}`);
    add(`${b} texture preview`);
    add(`${b} icon render`);
  }

  if (flavor === "medical") {
    add(`clinical ${b}`);
    add(`patient ${b}`);
    add(`${b} encounter`);
    add(`${b} visit`);
    add(`${b} care team`);
    add(`${b} chart`);
    add(`${b} clinical note`);
    add(`epic ${b}`);
    add(`${b} phi`);
  } else if (flavor === "ecommerce") {
    add(`retail ${b}`);
    add(`${b} listing`);
    add(`${b} sku`);
    add(`${b} product shot`);
    add(`catalog ${b}`);
    add(`${b} storefront`);
    add(`${b} order related`);
    add(`merchant ${b}`);
  } else if (flavor === "gamedev") {
    add(`${b} asset`);
    add(`${b} build`);
    add(`in engine ${b}`);
    add(`${b} export`);
    add(`${b} source file`);
    add(`wip ${b}`);
    add(`final ${b}`);
    add(`${b} pipeline`);
  } else if (flavor === "realestate") {
    add(`${b} listing`);
    add(`mls ${b}`);
    add(`${b} disclosure`);
    add(`${b} closing`);
    add(`buyer ${b}`);
    add(`seller ${b}`);
    add(`${b} transaction`);
  } else {
    add(`business ${b}`);
    add(`office ${b}`);
    add(`${b} correspondence`);
    add(`${b} memo`);
  }

  if (catKey.includes("_")) {
    add(catKey.replace(/_/g, "-"));
    add(catKey.replace(/_/g, ""));
  }

  return phrases;
}

/**
 * Last-resort phrases if pack-wide dedup exhausts semantic pool (still avoids "autogen N").
 * @param {string} base
 * @param {number} index — monotonic for diversity
 */
function semanticRotatingFallback(base, index) {
  const b = base.trim().toLowerCase();
  const facets = [
    "admin",
    "ops",
    "legal",
    "finance",
    "support",
    "reference",
    "archive",
    "incoming",
    "outgoing",
    "revision",
    "amendment",
    "appendix",
    "schedule",
    "ledger",
    "register",
    "index",
    "manifest",
    "transmittal",
    "brief",
    "dossier",
  ];
  const facet = facets[index % facets.length];
  const round = Math.floor(index / facets.length);
  return round === 0 ? `${b} ${facet}` : `${b} ${facet} set ${round}`;
}

/**
 * @param {string} catKey
 * @param {string} packSlug
 * @param {Record<string, string[]>} allCategories — full structure.categories (includes new)
 * @param {object | null} [template]
 */
function generateKeywords(catKey, packSlug, allCategories, template = null) {
  const flavor = inferIndustryFlavor(packSlug);
  const label = humanLabel(catKey);
  const usedGlobally = new Set();
  for (const [_otherKey, words] of Object.entries(allCategories)) {
    if (!Array.isArray(words)) continue;
    for (const w of words) {
      if (typeof w === "string" && w.trim()) usedGlobally.add(w.trim().toLowerCase());
    }
  }

  const base = catKey.replace(/_/g, " ");
  /** @type {string[]} */
  const out = [];
  const push = (s) => {
    const t = String(s).trim().toLowerCase();
    if (t.length < 2 || usedGlobally.has(t)) return;
    usedGlobally.add(t);
    out.push(t);
  };

  push(base);
  push(simplePlural(base));
  for (const h of hintPhrases(flavor, catKey)) {
    push(h);
    push(`${h} ${base}`);
    push(`${base} ${h}`);
  }

  if (template && typeof template.extraKeywordHints === "function") {
    try {
      const extra = template.extraKeywordHints(catKey, label);
      if (Array.isArray(extra)) {
        for (const h of extra) {
          push(h);
          if (typeof h === "string" && h.trim()) {
            const ht = h.trim().toLowerCase();
            push(`${ht} ${base}`);
            push(`${base} ${ht}`);
          }
        }
      }
    } catch (e) {
      console.warn("template.extraKeywordHints failed:", e instanceof Error ? e.message : e);
    }
  }

  push(`handwritten ${base}`);
  push(`blurry ${base} photo`);
  push(`crooked ${base} scan`);
  push(`low quality ${base}`);

  const semanticPool = buildSemanticFallbackPhrases(catKey, base, label, flavor);
  for (const phrase of semanticPool) {
    if (out.length >= KEYWORD_TARGET_MAX) break;
    push(phrase);
  }

  let rot = 0;
  while (out.length < KEYWORD_TARGET_MAX && rot < 600) {
    push(semanticRotatingFallback(base, rot));
    rot += 1;
  }

  rot = 0;
  while (out.length < KEYWORD_TARGET_MIN && rot < 800) {
    push(semanticRotatingFallback(base, rot));
    rot += 1;
  }

  if (out.length < KEYWORD_TARGET_MIN) {
    console.error(
      `Could not reach ${KEYWORD_TARGET_MIN} unique keywords for "${catKey}" (try different name or relax duplicates).`,
    );
    process.exit(1);
  }

  if (out.length > KEYWORD_TARGET_MAX) return out.slice(0, KEYWORD_TARGET_MAX);
  return out;
}

/**
 * @param {string} catKey
 * @param {string} label
 */
function pickGroup(catKey, label) {
  const hay = `${catKey} ${label}`;
  for (const rule of GROUP_RULES) {
    if (rule.re.test(hay)) return { id: rule.id, label: rule.label, description: rule.description };
  }
  return {
    id: "general",
    label: "General",
    description: "Mixed or uncategorized workflow items.",
  };
}

/**
 * @param {string} raw
 */
function normalizeGroupId(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]+/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * @param {string} catKey
 * @param {string} label
 * @param {string | null | undefined} groupOverride
 */
function resolveGroup(catKey, label, groupOverride) {
  if (groupOverride == null || !String(groupOverride).trim()) {
    return pickGroup(catKey, label);
  }
  const raw = String(groupOverride).trim();
  const low = raw.toLowerCase();
  const idNorm = normalizeGroupId(raw);
  for (const rule of GROUP_RULES) {
    if (rule.id === low || rule.id === idNorm) return { id: rule.id, label: rule.label, description: rule.description };
    if (rule.label.toLowerCase() === low) return { id: rule.id, label: rule.label, description: rule.description };
  }
  const id = idNorm || "general";
  const disp = humanLabel(id.replace(/_/g, " ").trim() || "general");
  return {
    id,
    label: disp,
    description: `Custom group ("${disp}") selected via --group.`,
  };
}

/**
 * @param {string} catKey
 * @param {string} packSlug
 * @param {string} groupId
 * @param {object | null} [template]
 */
function inferProcessEntry(catKey, packSlug, groupId, template = null) {
  const flavor = inferIndustryFlavor(packSlug);
  const hay = `${catKey} ${groupId}`.toLowerCase();
  let priority = "medium";
  let review_required = false;

  const critical =
    /lab|prescription|rx|billing|insurance|claim|identity|phi|legal|contract|weapon|payment|invoice/i.test(hay) ||
    (flavor === "medical" && /clinical|documents|financial/.test(groupId));

  if (critical || groupId === "clinical" || groupId === "financial") {
    priority = "high";
    review_required = true;
  } else if (groupId === "visual" && flavor === "medical") {
    priority = "high";
    review_required = true;
  } else if (groupId === "documents" && flavor === "medical") {
    priority = "high";
    review_required = true;
  } else if (groupId === "general" || groupId === "product") {
    priority = flavor === "ecommerce" && /flat|packaging/.test(catKey) ? "low" : "medium";
  }

  if (groupId === "scheduling") {
    priority = "medium";
    review_required = true;
  }

  const label = humanLabel(catKey);
  let purpose = `Operational handling for “${label}” in the **${packSlug}** workspace: validate content, apply routing, and escalate when automation is uncertain.`;
  /** @type {string[]} */
  let actions = [
    `Confirm the item is truly “${label}” using keywords, layout cues, and any OCR text before routing.`,
    "Match extracted signals to this category’s patterns and structure.json keywords to reduce mis-filing.",
    "Apply the configured destination rules only after classification confidence and margin pass policy.",
    "Send to human review when thresholds fail, routing is unknown, or process rules mark this category as sensitive.",
  ];

  if (template && typeof template.processIntel === "function") {
    try {
      const p = template.processIntel(catKey, label, groupId, packSlug);
      if (p && typeof p.purpose === "string" && p.purpose.trim()) purpose = p.purpose.trim();
      if (p && Array.isArray(p.actions) && p.actions.length >= 3) {
        actions = p.actions.map((a) => String(a).trim()).filter(Boolean);
      }
    } catch (e) {
      console.warn("template.processIntel failed:", e instanceof Error ? e.message : e);
    }
  }

  return {
    purpose,
    actions,
    priority,
    review_required,
  };
}

/**
 * @param {string} category
 * @param {number} index
 */
function renderPng(category, index) {
  const titles = [
    { title: "Clean scan", sub: "high contrast layout structured rows", bg: "#f5f5f0" },
    { title: "Office copy", sub: "slight skew mild noise fax style", bg: "#e8e4dc" },
    { title: "Mobile photo", sub: "perspective glare uneven lighting", bg: "#d4d0c8" },
    { title: "Archived print", sub: "faded toner margin notes", bg: "#dcd8d0" },
    { title: "Dense layout", sub: "multi column small type tables", bg: "#eeeae2" },
    { title: "Handwritten mix", sub: "annotations arrows sticky note area", bg: "#ebe7dd" },
    { title: "Low-light capture", sub: "noise compression artifacts", bg: "#d8d4cc" },
  ];
  const v = titles[index % titles.length];
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
  ctx.fillText(`${category.replace(/_/g, " ")} · generated ${index + 1}`, 18, h - 24);
  return canvas.toBuffer("image/png");
}

/**
 * @param {string} packSlug
 * @param {string} catKey
 * @param {string[]} keywords
 */
function sampleJson(packSlug, catKey, keywords) {
  return {
    pack: packSlug,
    category: catKey,
    generated: true,
    summary: `Synthetic structured sample for ${humanLabel(catKey)}.`,
    keyword_sample: keywords.slice(0, 8),
  };
}

/**
 * @param {Record<string, string[]>} categories
 * @param {string} catKey
 * @param {string[]} keywords
 * @param {object | null} [template]
 */
function patternEntryFor(categories, catKey, keywords, template = null) {
  const kw = keywords.slice(0, 14);
  const label = humanLabel(catKey);
  let expected_elements = [
    `title, heading, or dominant label region associated with “${label}”`,
    "primary content zone (narrative, table, form fields, or main subject)",
    "supporting identifiers such as dates, codes, parties, or version markers",
  ];
  let optional_elements = [
    "secondary sections, attachments, or continuation pages",
    "branding, watermark, or channel-specific chrome",
  ];
  let visual_traits = [
    "real-world capture or export with uneven lighting, skew, or compression",
    "business or operational layout rather than casual personal media",
  ];

  if (template && typeof template.patternStructure === "function") {
    try {
      const ps = template.patternStructure(catKey, label, keywords);
      if (ps && Array.isArray(ps.expected_elements) && ps.expected_elements.length) {
        expected_elements = ps.expected_elements.map((x) => String(x));
      }
      if (ps && Array.isArray(ps.optional_elements) && ps.optional_elements.length) {
        optional_elements = ps.optional_elements.map((x) => String(x));
      }
      if (ps && Array.isArray(ps.visual_traits) && ps.visual_traits.length) {
        visual_traits = ps.visual_traits.map((x) => String(x));
      }
    } catch (e) {
      console.warn("template.patternStructure failed:", e instanceof Error ? e.message : e);
    }
  }

  return {
    expected_elements,
    optional_elements,
    visual_traits,
    keywords: kw.length ? kw : categories[catKey] || [],
  };
}

/**
 * @param {string} packDir
 * @param {string} catKey
 * @param {string} packSlug
 * @param {string[]} keywords
 */
function writeAssetsForCategory(packDir, catKey, packSlug, keywords) {
  const base = join(packDir, "reference_assets");
  const imgDir = join(base, "images", catKey);
  const docDir = join(base, "documents", catKey);
  mkdirSync(imgDir, { recursive: true });
  mkdirSync(docDir, { recursive: true });
  for (let i = 0; i < IMAGES_PER_CATEGORY; i++) {
    writeFileSync(join(imgDir, `synthetic_${String(i + 1).padStart(2, "0")}.png`), renderPng(catKey, i));
  }
  writeFileSync(join(docDir, "sample.json"), `${JSON.stringify(sampleJson(packSlug, catKey, keywords), null, 2)}\n`, "utf8");
  writeFileSync(
    join(docDir, "sample.txt"),
    `Generated reference text for ${catKey} (${packSlug}).\nSample keywords: ${keywords.slice(0, 10).join(", ")}\n`,
    "utf8",
  );
}

/**
 * @param {string} packDir
 * @param {Record<string, string[]>} categories
 * @param {string[] | null} [onlyKeys] — if set, only add/update these categories (preserves other pattern entries).
 * @param {object | null} [template]
 */
function mergePatternsJson(packDir, categories, onlyKeys = null, template = null) {
  const path = join(packDir, "reference_assets", "patterns.json");
  /** @type {Record<string, unknown>} */
  let cur = {};
  if (existsSync(path)) {
    try {
      cur = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      cur = {};
    }
  }
  if (!cur || typeof cur !== "object" || Array.isArray(cur)) cur = {};
  const keys = onlyKeys ?? Object.keys(categories);
  for (const ck of keys) {
    const words = categories[ck];
    if (!Array.isArray(words)) continue;
    const kws = words.map((w) => String(w).trim().toLowerCase()).filter(Boolean);
    const existing = cur[ck] && typeof cur[ck] === "object" && !Array.isArray(cur[ck]) ? cur[ck] : null;
    if (existing && onlyKeys) {
      cur[ck] = {
        .../** @type {Record<string, unknown>} */ (existing),
        keywords: kws.length ? kws : /** @type {Record<string, unknown>} */ (existing).keywords,
      };
    } else {
      cur[ck] = patternEntryFor(categories, ck, kws, template);
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cur, null, 2)}\n`, "utf8");
}

/**
 * @param {string} packDir
 * @param {Record<string, unknown>} processes
 */
function writeProcessesJson(packDir, processes) {
  const path = join(packDir, "reference_assets", "processes.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(processes, null, 2)}\n`, "utf8");
}

/**
 * @param {string} packSlug
 * @param {Record<string, string[]>} categories
 * @param {Record<string, unknown>} referenceCategories
 * @param {Record<string, unknown>} groups
 * @param {Record<string, unknown>} processes
 */
/**
 * One regeneration pass: structure keywords, assets, patterns, processes (template + repair-layer merged in loader).
 * @param {string} slugNorm
 */
async function repairPackCoverageGapsOnePass(slugNorm) {
  const packDir = join(ROOT, "packs", slugNorm);
  const loaded = await loadIndustryTemplate(slugNorm);
  const template = loaded.template;
  if (!template) {
    console.error(`Template failed to load for ${slugNorm}.`);
    process.exit(1);
  }

  const structure = JSON.parse(readFileSync(join(packDir, "structure.json"), "utf8"));
  if (!structure.categories || typeof structure.categories !== "object") structure.categories = {};
  const categories = structure.categories;
  const keys = Object.keys(categories);
  let structChanged = false;

  for (const catKey of keys) {
    const words = categories[catKey];
    const kwCount = Array.isArray(words) ? words.filter((w) => String(w).trim()).length : 0;
    if (kwCount < KEYWORD_TARGET_MIN) {
      const augmented = generateKeywords(catKey, slugNorm, categories, template);
      categories[catKey] = augmented;
      structChanged = true;
    }
  }
  if (structChanged) {
    writeFileSync(join(packDir, "structure.json"), `${JSON.stringify(structure, null, 2)}\n`, "utf8");
  }

  for (const catKey of keys) {
    const words = categories[catKey];
    const kws = Array.isArray(words)
      ? words.map((w) => String(w).trim().toLowerCase()).filter(Boolean)
      : [];
    const imgDir = join(packDir, "reference_assets", "images", catKey);
    const pngCount = existsSync(imgDir)
      ? readdirSync(imgDir).filter((n) => n.toLowerCase().endsWith(".png")).length
      : 0;
    const docDir = join(packDir, "reference_assets", "documents", catKey);
    const docCount = existsSync(docDir)
      ? readdirSync(docDir).filter((n) => {
          try {
            return statSync(join(docDir, n)).isFile();
          } catch {
            return false;
          }
        }).length
      : 0;
    if (pngCount === 0 || docCount === 0) {
      writeAssetsForCategory(
        packDir,
        catKey,
        slugNorm,
        kws.length ? kws : [catKey.replace(/_/g, " ")],
      );
    }
  }

  mergePatternsJson(packDir, categories, null, template);

  /** @type {Record<string, unknown>} */
  let processes = {};
  const procPath = join(packDir, "reference_assets", "processes.json");
  if (existsSync(procPath)) {
    try {
      const raw = JSON.parse(readFileSync(procPath, "utf8"));
      processes = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch {
      processes = {};
    }
  }
  for (const catKey of keys) {
    const label = humanLabel(catKey);
    const grp = resolveGroup(catKey, label, null);
    if (!processes[catKey] || typeof processes[catKey] !== "object") {
      processes[catKey] = inferProcessEntry(catKey, slugNorm, grp.id, template);
    }
  }
  writeProcessesJson(packDir, processes);
}

/**
 * Evaluate → refine templates/<slug>.repair-layer.json → regenerate until high bar or max iterations.
 * @param {string} packSlug
 * @param {boolean} allowGeneric — ignored (repair always uses industry template + repair layer)
 */
async function repairPackCoverageGaps(packSlug, allowGeneric) {
  if (allowGeneric) {
    console.warn("[repair] --allow-generic is ignored: repair uses templates/<slug>.js + repair-layer.json only.");
  }
  const slugNorm = normalizePackSlug(packSlug);
  const packDir = join(ROOT, "packs", slugNorm);
  if (!existsSync(join(packDir, "structure.json"))) {
    console.error(`No pack at packs/${slugNorm} (missing structure.json).`);
    process.exit(1);
  }

  const templatePath = join(ROOT, "templates", `${slugNorm}.js`);
  if (!existsSync(templatePath)) {
    console.error(
      `Domain repair requires templates/${slugNorm}.js. Generic fallback is not used for --repair-coverage.`,
    );
    process.exit(1);
  }

  let lastScore = -1;
  let noProgress = 0;
  for (let iter = 0; iter < MAX_REPAIR_ITERS; iter++) {
    const report = buildIndustryReport(slugNorm);
    if (repairTargetMet(report)) {
      console.log(
        `Repair target met: ${report.overallScore}% (high ≥${report.thresholds?.highMin ?? "?"}) after ${iter} refinement iteration(s).`,
      );
      break;
    }
    if (report.overallScore <= lastScore) {
      noProgress += 1;
    } else {
      noProgress = 0;
    }
    lastScore = Math.max(lastScore, report.overallScore);
    if (noProgress >= 2) {
      console.warn("No coverage progress — stopping iterative repair.");
      break;
    }

    refineRepairLayerFromReport(slugNorm, report);
    await repairPackCoverageGapsOnePass(slugNorm);
  }

  const structureFinal = JSON.parse(readFileSync(join(packDir, "structure.json"), "utf8"));
  const catsFinal =
    structureFinal.categories && typeof structureFinal.categories === "object"
      ? structureFinal.categories
      : {};
  validatePack(slugNorm, catsFinal);
  const finalRep = buildIndustryReport(slugNorm);
  if (!repairTargetMet(finalRep)) {
    console.warn(
      `Repair stopped at ${finalRep.overallScore}% (${finalRep.rating}) — target high bar is ${finalRep.thresholds?.highMin ?? "?"}.`,
    );
  }
  console.log(`Repair complete: packs/${slugNorm}`);
}

function writePackReadme(packSlug, categories, referenceCategories, groups, processes) {
  const catKeys = Object.keys(categories).sort();
  const groupLines = Object.entries(groups)
    .map(([id, g]) => {
      const o = g && typeof g === "object" ? /** @type {Record<string, unknown>} */ (g) : {};
      const label = typeof o.label === "string" ? o.label : id;
      const cats = Array.isArray(o.categories) ? o.categories.join(", ") : "";
      return `- **${label}** (\`${id}\`): ${cats}`;
    })
    .join("\n");

  const body = `# Pack: ${packSlug}

This pack was created or extended by \`dev/generate_pack_system.mjs\`. The UI (Capability, Tunnel, ProcessIntel) reads **reference.json**, **structure.json**, and **reference_assets/** at runtime — no manual UI wiring.

## Categories (${catKeys.length})

${catKeys.map((k) => `- \`${k}\` — ${humanLabel(k)}`).join("\n")}

## Groups (UX)

${groupLines || "(none)"}

## Process intelligence

File: \`reference_assets/processes.json\` — per-category **priority**, **review_required**, **purpose**, and **actions** for workflow-aware UI (not used for classification).

${Object.keys(processes)
  .sort()
  .map((k) => {
    const p = /** @type {Record<string, unknown>} */ (processes[k]);
    const pr = p?.priority != null ? String(p.priority) : "?";
    const rv = p?.review_required === true ? "yes" : "no";
    return `- \`${k}\`: priority **${pr}**, review **${rv}**`;
  })
  .join("\n")}

## Reference assets

- \`reference_assets/images/<category>/\` — synthetic PNGs (CLIP)
- \`reference_assets/documents/<category>/\` — mock JSON/txt
- \`reference_assets/patterns.json\` — metadata for suggestions / UX

## Load pack

\`\`\`bash
node -e "import('./packs/loadIndustryPack.js').then(m => m.loadIndustryPack('${packSlug}'))"
\`\`\`

Or use the in-app industry selector.
`;
  writeFileSync(join(ROOT, "packs", packSlug, "README.md"), body, "utf8");
}

/**
 * @param {string} packSlug
 */
function ensureEmptyPack(packSlug) {
  const packDir = join(ROOT, "packs", packSlug);
  if (existsSync(packDir)) {
    console.error(`Pack directory already exists: ${packDir}`);
    console.error("Refusing to create a duplicate industry pack. Use --category to add categories.");
    process.exit(1);
  }
  mkdirSync(packDir, { recursive: true });
  writeFileSync(join(packDir, "structure.json"), `${JSON.stringify({ categories: {} }, null, 2)}\n`, "utf8");
  writeFileSync(
    join(packDir, "reference.json"),
    `${JSON.stringify({ version: 1, categories: {}, groups: {} }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(packDir, "reference_embeddings.json"), "{}\n", "utf8");
  mkdirSync(join(packDir, "reference_assets"), { recursive: true });
  writeFileSync(join(packDir, "reference_assets", "patterns.json"), "{}\n", "utf8");
  writeFileSync(join(packDir, "reference_assets", "processes.json"), "{}\n", "utf8");
  writePackReadme(packSlug, {}, {}, {}, {});
  console.log(`Created empty pack: ${packSlug}`);
}

/**
 * @param {string} packSlug
 * @param {string} catKey
 * @param {{ group?: string | null, allowGeneric?: boolean }} [options]
 */
async function addCategoryToPack(packSlug, catKey, options = {}) {
  const slugNorm = normalizePackSlug(packSlug);
  const templatePath = join(ROOT, "templates", `${slugNorm}.js`);
  const templateOnDisk = existsSync(templatePath);

  /** @type {object | null} */
  let template = null;
  /** @type {number | null} */
  let templateVersion = null;

  if (!templateOnDisk) {
    console.warn(`Missing template for ${slugNorm}`);
    if (!options.allowGeneric) {
      console.error("Refusing to generate without a template. Add templates/<industry>.js or pass --allow-generic.");
      process.exit(1);
    }
    console.log("Using generic fallback (allowed)");
  } else {
    const loaded = await loadIndustryTemplate(packSlug);
    if (!loaded.template) {
      console.error(`Template file exists but did not load: ${templatePath}`);
      process.exit(1);
    }
    template = loaded.template;
    templateVersion = loaded.version;
    console.log(`Using template: ${slugNorm} v${templateVersion}`);
  }

  const packDir = join(ROOT, "packs", packSlug);
  if (!existsSync(packDir)) {
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, "structure.json"), `${JSON.stringify({ categories: {} }, null, 2)}\n`, "utf8");
    writeFileSync(
      join(packDir, "reference.json"),
      `${JSON.stringify({ version: 1, categories: {}, groups: {} }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(join(packDir, "reference_embeddings.json"), "{}\n", "utf8");
    mkdirSync(join(packDir, "reference_assets"), { recursive: true });
    writeFileSync(join(packDir, "reference_assets", "patterns.json"), "{}\n", "utf8");
    writeFileSync(join(packDir, "reference_assets", "processes.json"), "{}\n", "utf8");
    console.log(`Initialized new pack directory: ${packSlug}`);
  }

  const structPath = join(packDir, "structure.json");
  const refPath = join(packDir, "reference.json");

  const structure = JSON.parse(readFileSync(structPath, "utf8"));
  if (!structure.categories || typeof structure.categories !== "object") structure.categories = {};

  if (structure.categories[catKey]) {
    console.error(`Category "${catKey}" already exists in structure.json. Refusing to overwrite.`);
    process.exit(1);
  }

  const allPreview = { ...structure.categories };
  const keywords = generateKeywords(catKey, packSlug, allPreview, template);
  structure.categories[catKey] = keywords;
  writeFileSync(structPath, `${JSON.stringify(structure, null, 2)}\n`, "utf8");

  const ref = JSON.parse(readFileSync(refPath, "utf8"));
  if (!ref.categories || typeof ref.categories !== "object") ref.categories = {};
  if (!ref.groups || typeof ref.groups !== "object") ref.groups = {};
  if (ref.categories[catKey]) {
    console.error(`Category "${catKey}" already exists in reference.json. Refusing to overwrite.`);
    process.exit(1);
  }

  const label = humanLabel(catKey);
  ref.categories[catKey] = {
    label,
    description: `Upload and organize ${label.toLowerCase()} for this workspace.`,
    examples: keywords.slice(0, Math.min(24, keywords.length)),
    subcategories: {},
    templateVersion: templateVersion !== null ? templateVersion : null,
  };

  const grp = resolveGroup(catKey, label, options.group);
  if (!ref.groups[grp.id]) {
    ref.groups[grp.id] = {
      label: grp.label,
      description: grp.description,
      categories: [],
    };
  }
  const g = ref.groups[grp.id];
  if (typeof g === "object" && g != null && Array.isArray(g.categories)) {
    if (!g.categories.includes(catKey)) g.categories.push(catKey);
  }

  writeFileSync(refPath, `${JSON.stringify(ref, null, 2)}\n`, "utf8");

  /** @type {Record<string, unknown>} */
  let processes = {};
  const procPath = join(packDir, "reference_assets", "processes.json");
  if (existsSync(procPath)) {
    try {
      processes = JSON.parse(readFileSync(procPath, "utf8"));
    } catch {
      processes = {};
    }
  }
  if (!processes || typeof processes !== "object" || Array.isArray(processes)) processes = {};
  processes[catKey] = inferProcessEntry(catKey, packSlug, grp.id, template);
  writeProcessesJson(packDir, processes);

  writeAssetsForCategory(packDir, catKey, packSlug, keywords);
  mergePatternsJson(packDir, structure.categories, [catKey], template);

  writePackReadme(packSlug, structure.categories, ref.categories, ref.groups, processes);

  console.log(`Added category "${catKey}" to pack "${packSlug}" (group: ${grp.id}).`);
}

/**
 * @param {string} packSlug
 * @param {Record<string, string[]>} categories
 */
function validatePack(packSlug, categories) {
  const packDir = join(ROOT, "packs", packSlug);
  const errors = [];
  const keys = Object.keys(categories);
  const allKw = new Set();
  for (const [k, words] of Object.entries(categories)) {
    if (!Array.isArray(words)) {
      errors.push(`Category ${k}: keywords not an array`);
      continue;
    }
    if (words.length < KEYWORD_TARGET_MIN) {
      errors.push(`Category ${k}: fewer than ${KEYWORD_TARGET_MIN} keywords (${words.length})`);
    }
    for (const w of words) {
      const low = String(w).trim().toLowerCase();
      if (!low) continue;
      if (allKw.has(low)) errors.push(`Duplicate keyword across pack: "${low}"`);
      allKw.add(low);
    }
  }
  const refPath = join(packDir, "reference.json");
  const ref = JSON.parse(readFileSync(refPath, "utf8"));
  for (const k of keys) {
    if (!ref.categories?.[k]) errors.push(`reference.json missing category: ${k}`);
  }
  const procPath = join(packDir, "reference_assets", "processes.json");
  const proc = existsSync(procPath) ? JSON.parse(readFileSync(procPath, "utf8")) : {};
  for (const k of keys) {
    if (!proc[k]) errors.push(`processes.json missing category: ${k}`);
    const imgDir = join(packDir, "reference_assets", "images", k);
    if (!existsSync(imgDir)) errors.push(`Missing images dir: ${k}`);
    else {
      const names = readdirSync(imgDir);
      if (names.filter((n) => n.endsWith(".png")).length === 0) errors.push(`No PNG assets: ${k}`);
    }
  }
  if (errors.length) {
    console.error("Validation issues:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log("Validation OK: keywords unique, reference + processes + assets present.");
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ industry: string, category: string | null, group: string | null, allowGeneric: boolean, repairCoverage: boolean }} */
  const out = { industry: "", category: null, group: null, allowGeneric: false, repairCoverage: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--industry" && argv[i + 1]) {
      out.industry = argv[++i];
    } else if (a === "--category" && argv[i + 1]) {
      out.category = argv[++i];
    } else if (a === "--group" && argv[i + 1]) {
      out.group = argv[++i];
    } else if (a === "--repair-coverage") {
      out.repairCoverage = true;
    } else if (a === "--allow-generic") {
      out.allowGeneric = true;
    } else if (a.startsWith("--industry=")) {
      out.industry = a.slice(11);
    } else if (a.startsWith("--category=")) {
      out.category = a.slice(11);
    } else if (a.startsWith("--group=")) {
      out.group = a.slice(8);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const packSlug = normalizePackSlug(args.industry);
  if (!packSlug) {
    console.error("Usage:");
    console.error(
      "  node dev/generate_pack_system.mjs --industry <slug> [--category <name>] [--group <id>] [--allow-generic] [--repair-coverage]",
    );
    console.error("Examples:");
    console.error("  node dev/generate_pack_system.mjs --industry medical --category appointments");
    console.error("  node dev/generate_pack_system.mjs --industry ecommerce --category returns --group financial");
    console.error("  node dev/generate_pack_system.mjs --industry unknown-industry --category x --allow-generic");
    console.error("  node dev/generate_pack_system.mjs --industry real-estate");
    console.error("  node dev/generate_pack_system.mjs --industry my-pack --repair-coverage --allow-generic");
    process.exit(1);
  }

  if (args.repairCoverage) {
    await repairPackCoverageGaps(packSlug, args.allowGeneric);
    return;
  }

  if (args.category != null && String(args.category).trim()) {
    const catKey = normalizeCategoryKey(args.category);
    if (!catKey) {
      console.error("Invalid category name.");
      process.exit(1);
    }
    await addCategoryToPack(packSlug, catKey, { group: args.group, allowGeneric: args.allowGeneric });
    const structure = JSON.parse(readFileSync(join(ROOT, "packs", packSlug, "structure.json"), "utf8"));
    validatePack(packSlug, structure.categories || {});
  } else {
    ensureEmptyPack(packSlug);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Watch New_Arrival/ for new PNGs, classify with Claira, move into output/<category>/ from config/structure.json.
 */

import chalk from "chalk";
import chokidar from "chokidar";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "fs";
import { basename, dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { analyzeImageFile, clearReferenceEmbeddingsCache } from "./clairaImagePipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LOG_DIR = join(ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "moves.log");
mkdirSync(LOG_DIR, { recursive: true });

const NEW_ARRIVAL = join(ROOT, "New_Arrival");
const OUTPUT_DIR = join(ROOT, "output");
const STRUCTURE_PATH = join(ROOT, "config", "structure.json");
const REFERENCE_EMBEDDINGS_PATH = join(ROOT, "references", "reference_embeddings.json");
const UNKNOWN_CATEGORY = "unknown";

/**
 * @param {string} title
 */
function logSection(title) {
  console.log("\n" + chalk.yellow.bold("=== " + title + " ==="));
}

/** @type {{ categories: Record<string, string[]> }} */
let CATEGORY_MAP = { categories: {} };

/**
 * @param {string} str
 */
function normalize(str) {
  return str.toLowerCase().replace(/[_-]/g, " ").trim();
}

/**
 * @returns {{ keywordNorm: string, category: string }[]}
 */
function buildCategoryKeywords() {
  /** @type {{ keywordNorm: string, category: string }[]} */
  const list = [];
  const cats = CATEGORY_MAP.categories;
  if (!cats || typeof cats !== "object") return list;
  for (const [category, labels] of Object.entries(cats)) {
    if (!category || typeof category !== "string") continue;
    if (!Array.isArray(labels)) continue;
    for (const raw of labels) {
      if (typeof raw !== "string") continue;
      const keywordNorm = normalize(raw);
      if (!keywordNorm) continue;
      list.push({ keywordNorm, category });
    }
  }
  return list;
}

/** @type {{ keywordNorm: string, category: string }[]} */
let categoryKeywords = buildCategoryKeywords();

function loadStructureConfig() {
  try {
    if (!existsSync(STRUCTURE_PATH)) {
      console.warn("Watcher: config missing —", STRUCTURE_PATH, "(all files will go to output/" + UNKNOWN_CATEGORY + "/)");
      CATEGORY_MAP = { categories: {} };
      categoryKeywords = buildCategoryKeywords();
      return;
    }
    const raw = readFileSync(STRUCTURE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const categories = parsed?.categories;
    if (!categories || typeof categories !== "object") {
      console.warn("Watcher: config has no valid categories object — using empty map");
      CATEGORY_MAP = { categories: {} };
    } else {
      CATEGORY_MAP = { categories: /** @type {Record<string, string[]>} */ ({ ...categories }) };
    }
    categoryKeywords = buildCategoryKeywords();
    console.log(
      "Watcher: loaded structure config —",
      categoryKeywords.length,
      "keywords (exact + partial) from",
      STRUCTURE_PATH,
    );
  } catch (err) {
    console.warn("Watcher: could not load structure config —", err instanceof Error ? err.message : err);
    CATEGORY_MAP = { categories: {} };
    categoryKeywords = buildCategoryKeywords();
  }
}

/**
 * @param {string} filePath
 */
function isPngFile(filePath) {
  return extname(filePath).toLowerCase() === ".png";
}

/**
 * @param {string} absPath
 */
function isUnderNewArrival(absPath) {
  const f = resolve(absPath);
  const base = resolve(NEW_ARRIVAL);
  const fl = f.toLowerCase();
  const bl = base.toLowerCase();
  return fl === bl || fl.startsWith(bl + "\\") || fl.startsWith(bl + "/");
}

/**
 * @param {unknown} result
 */
function labelFromClassification(result) {
  if (result == null || typeof result !== "object") return "";
  if ("label" in result && /** @type {{ label?: string }} */ (result).label === "error") {
    return "error";
  }
  const cls = /** @type {{ classification?: { predicted_label?: string | null } }} */ (result).classification;
  if (cls && typeof cls.predicted_label === "string" && cls.predicted_label.length) {
    return cls.predicted_label;
  }
  return "";
}

/**
 * @param {string} label — Claira predicted_label
 * @returns {{ category: string, matchKind: "exact" | "partial" | "none" }}
 */
function categoryForPredictedLabel(label) {
  const raw = String(label ?? "").trim();
  if (!raw || normalize(raw) === "error") {
    return { category: UNKNOWN_CATEGORY, matchKind: "none" };
  }
  const normalizedLabel = normalize(raw);
  if (!normalizedLabel) {
    return { category: UNKNOWN_CATEGORY, matchKind: "none" };
  }

  for (const { keywordNorm, category } of categoryKeywords) {
    if (keywordNorm === normalizedLabel) {
      return { category, matchKind: "exact" };
    }
  }
  for (const { keywordNorm, category } of categoryKeywords) {
    if (normalizedLabel.includes(keywordNorm) || keywordNorm.includes(normalizedLabel)) {
      return { category, matchKind: "partial" };
    }
  }
  return { category: UNKNOWN_CATEGORY, matchKind: "none" };
}

/**
 * @param {string} destDir
 * @param {string} filename
 */
function uniqueDestPath(destDir, filename) {
  let dest = join(destDir, filename);
  if (!existsSync(dest)) return dest;
  const ext = extname(filename);
  const base = basename(filename, ext);
  return join(destDir, `${base}_${Date.now()}${ext}`);
}

/** @type {Set<string>} */
const inFlight = new Set();

/**
 * @param {string} filePath
 */
async function handleNewPng(filePath) {
  const abs = resolve(filePath);
  if (!existsSync(abs)) return;

  const key = abs.toLowerCase();
  if (inFlight.has(key)) return;
  if (!isPngFile(abs)) return;
  if (!isUnderNewArrival(abs)) return;

  inFlight.add(key);
  try {
    logSection("NEW IMAGE");
    console.log("Path:", abs);

    const result = await analyzeImageFile(abs);
    const label = labelFromClassification(result) || "unknown";
    const { category, matchKind } = categoryForPredictedLabel(label);

    logSection("ROUTING");
    console.log("Match:", matchKind);
    console.log("Label:", label);
    console.log("Category:", category);

    const destDir = join(OUTPUT_DIR, category);
    mkdirSync(destDir, { recursive: true });

    const filename = basename(abs);
    const dest = uniqueDestPath(destDir, filename);

    if (!existsSync(abs)) {
      return;
    }

    renameSync(abs, dest);

    try {
      mkdirSync(LOG_DIR, { recursive: true });

      const logEntry = [
        `TIME: ${new Date().toISOString()}`,
        `FROM: ${abs}`,
        `TO: ${dest}`,
        `LABEL: ${label}`,
        `CATEGORY: ${category}`,
        ``,
      ].join("\n");

      appendFileSync(LOG_FILE, logEntry, "utf8");
    } catch (err) {
      console.warn("Log write failed:", err instanceof Error ? err.message : err);
    }

    logSection("MOVE");
    console.log("From:", abs);
    console.log("To:", dest);
    // Source path is gone after rename; duplicate "add" no-ops at the initial existsSync guard.
  } catch (err) {
    console.error("Watcher error (non-fatal):", err);
  } finally {
    inFlight.delete(key);
  }
}

loadStructureConfig();

mkdirSync(NEW_ARRIVAL, { recursive: true });
mkdirSync(OUTPUT_DIR, { recursive: true });

console.log("Claira watcher — watching:", NEW_ARRIVAL);
console.log("Output root:", OUTPUT_DIR);

const watcher = chokidar.watch(NEW_ARRIVAL, {
  ignored: /(^|[/\\])\../,
  ignoreInitial: false,
  depth: 99,
  persistent: true,
  awaitWriteFinish: {
    stabilityThreshold: 1000,
    pollInterval: 100,
  },
});

watcher.on("add", handleNewPng);

watcher.on("ready", () => {
  console.log("Watcher ready.");
});

watcher.on("error", (err) => {
  console.error("Chokidar error (non-fatal):", err);
});

chokidar.watch(STRUCTURE_PATH, { ignoreInitial: true }).on("change", () => {
  loadStructureConfig();
  clearReferenceEmbeddingsCache();
});

if (existsSync(REFERENCE_EMBEDDINGS_PATH)) {
  chokidar.watch(REFERENCE_EMBEDDINGS_PATH, { ignoreInitial: true }).on("change", () => {
    clearReferenceEmbeddingsCache();
  });
}

const USER_REF_ROOT = join(ROOT, "references", "user");
const BASE_REF_ROOT = join(ROOT, "references", "base");
for (const p of [USER_REF_ROOT, BASE_REF_ROOT]) {
  if (existsSync(p)) {
    chokidar.watch(p, { ignoreInitial: true, depth: 2 }).on("all", () => {
      clearReferenceEmbeddingsCache();
    });
  }
}

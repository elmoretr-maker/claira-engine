/**
 * Watch New_Arrival/ for new PNGs, classify with Claira, move into Assets/<category>/.
 */

import chokidar from "chokidar";
import { existsSync, mkdirSync, renameSync } from "fs";
import { basename, dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { analyzeImageFile } from "./clairaImagePipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const NEW_ARRIVAL = join(ROOT, "New_Arrival");
const ASSETS = join(ROOT, "Assets");

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
 * @param {string} label
 */
function categoryDirForLabel(label) {
  const L = String(label).toLowerCase();
  if (L.includes("weapon")) return join(ASSETS, "weapons");
  if (L.includes("character")) return join(ASSETS, "characters");
  if (L.includes("environment")) return join(ASSETS, "environment");
  return join(ASSETS, "misc");
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
  const key = abs.toLowerCase();

  if (inFlight.has(key)) return;
  if (!isPngFile(abs)) return;
  if (!isUnderNewArrival(abs)) return;
  if (!existsSync(abs)) return;

  inFlight.add(key);
  try {
    console.log("New image detected:", abs);

    const result = await analyzeImageFile(abs);
    const label = labelFromClassification(result) || "unknown";
    const destDir = categoryDirForLabel(label);
    mkdirSync(destDir, { recursive: true });

    const filename = basename(abs);
    const dest = uniqueDestPath(destDir, filename);

    if (!existsSync(abs)) {
      console.log("Skip move (file gone):", abs);
      return;
    }

    renameSync(abs, dest);
    console.log("Moved:", abs, "→", dest, "| label:", label);
  } catch (err) {
    console.error("Watcher error (non-fatal):", err);
  } finally {
    inFlight.delete(key);
  }
}

mkdirSync(NEW_ARRIVAL, { recursive: true });
mkdirSync(ASSETS, { recursive: true });

console.log("Claira watcher — watching:", NEW_ARRIVAL);
console.log("Assets root:", ASSETS);

const watcher = chokidar.watch(NEW_ARRIVAL, {
  ignored: /(^|[/\\])\../,
  ignoreInitial: false,
  depth: 99,
  persistent: true,
  awaitWriteFinish: {
    stabilityThreshold: 600,
    pollInterval: 100,
  },
});

watcher.on("add", (path) => {
  void handleNewPng(path);
});

watcher.on("ready", () => {
  console.log("Watcher ready.");
});

watcher.on("error", (err) => {
  console.error("Chokidar error (non-fatal):", err);
});

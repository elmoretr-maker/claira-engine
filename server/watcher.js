/**
 * Watch New_Arrival/ for new images and run the same pipeline as processFolder (runProcessItemsPipeline).
 */

import chalk from "chalk";
import chokidar from "chokidar";
import { existsSync, mkdirSync } from "fs";
import { basename, dirname, join, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { isSupportedImageFilename } from "../adapters/supportedImages.js";
import { runProcessItemsPipeline } from "../interfaces/processFolderPipeline.js";
import { clearReferenceEmbeddingsCache } from "./clairaImagePipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const NEW_ARRIVAL = join(ROOT, "New_Arrival");
const STRUCTURE_PATH = join(ROOT, "config", "structure.json");
const REFERENCE_EMBEDDINGS_PATH = join(ROOT, "references", "reference_embeddings.json");

/**
 * @param {string} title
 */
function logSection(title) {
  console.log("\n" + chalk.yellow.bold("=== " + title + " ==="));
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

/** @type {Set<string>} */
const inFlight = new Set();

/**
 * @param {string} filePath
 */
async function handleNewImage(filePath) {
  const abs = resolve(filePath);
  if (!existsSync(abs)) return;

  const key = abs.toLowerCase();
  if (inFlight.has(key)) return;
  if (!isSupportedImageFilename(basename(abs))) return;
  if (!isUnderNewArrival(abs)) return;

  inFlight.add(key);
  try {
    logSection("NEW IMAGE");
    console.log("Path:", abs);

    const rel = relativePosixFromRoot(abs);
    const item = { skip: false, absPath: abs, rel };
    const out = await runProcessItemsPipeline([item], { cwd: ROOT, runtimeContext: {} });

    logSection("PIPELINE RESULT");
    console.log(chalk.dim("processed:"), out.processed, "moved:", out.moved, "review:", out.review);
    const row = out.results?.[0];
    if (row && typeof row === "object") {
      console.log(chalk.dim("row:"), JSON.stringify(row, null, 0).slice(0, 500));
    }
  } catch (err) {
    console.error("Watcher error (non-fatal):", err);
  } finally {
    inFlight.delete(key);
  }
}

/**
 * @param {string} absolutePath
 */
function relativePosixFromRoot(absolutePath) {
  const rootNorm = resolve(ROOT);
  const fileNorm = resolve(absolutePath);
  const prefix = rootNorm.endsWith(sep) ? rootNorm : rootNorm + sep;
  if (fileNorm.startsWith(prefix)) {
    return fileNorm.slice(prefix.length).replace(/\\/g, "/");
  }
  return basename(absolutePath);
}

mkdirSync(NEW_ARRIVAL, { recursive: true });

console.log("Claira watcher — watching:", NEW_ARRIVAL);
console.log("Uses runProcessItemsPipeline (same as processFolder).");

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

watcher.on("add", handleNewImage);

watcher.on("ready", () => {
  console.log("Watcher ready.");
});

watcher.on("error", (err) => {
  console.error("Chokidar error (non-fatal):", err);
});

chokidar.watch(STRUCTURE_PATH, { ignoreInitial: true }).on("change", () => {
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

/**
 * Shared Claira image → embedding → analyze (used by HTTP /run and folder watcher).
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { extname, join, resolve } from "path";
import chalk from "chalk";
import { analyze } from "../index.js";
import { loadAllReferenceEmbeddings } from "../interfaces/referenceLoader.js";
import { getImageEmbedding } from "../vision/clipEmbedder.js";

export { clearReferenceEmbeddingsCache } from "../interfaces/referenceLoader.js";

/** Single call site: {@link runClairaOnDiskPath}. Dedupe suppresses rapid double-runs for the same path/URL. */
let lastClairaLogKey = "";
let lastClairaLogAt = 0;
const CLAIRA_LOG_DEDUPE_MS = 1000;

/**
 * @param {unknown} result
 * @param {string} logicalFile — path or URL (same key as passed to analyze `file`)
 */
function logClairaResult(result, logicalFile) {
  const now = Date.now();
  const key = typeof logicalFile === "string" ? logicalFile : "";
  if (key && key === lastClairaLogKey && now - lastClairaLogAt < CLAIRA_LOG_DEDUPE_MS) {
    return;
  }
  if (key) {
    lastClairaLogKey = key;
    lastClairaLogAt = now;
  }

  console.log("");
  console.log(chalk.yellow.bold("=== CLAIRA ANALYSIS ==="));

  if (result == null || typeof result !== "object") {
    console.log(chalk.dim("(invalid result)"), result);
    console.log(chalk.dim("=== end ===\n"));
    return;
  }

  const cls = /** @type {{ classification?: object }} */ (result).classification;
  if (cls == null || typeof cls !== "object") {
    console.log(chalk.dim("(no classification)"));
  } else {
    const c = /** @type {{ predicted_label?: unknown, second_label?: unknown, confidence?: unknown, softmaxTop3?: unknown, match_source?: unknown }} */ (cls);
    const src = typeof c.match_source === "string" ? c.match_source : "";
    const cosineConf = typeof c.confidence === "number" ? c.confidence : null;
    if (c.predicted_label != null && cosineConf != null && src) {
      console.log(
        chalk.bold(
          `Match: ${String(c.predicted_label)} (${cosineConf.toFixed(2)}) via ${src}`,
        ),
      );
    } else {
      console.log("Label: ", c.predicted_label ?? "—");
    }
    console.log("Second label: ", c.second_label ?? "—");
    const softmaxTop = Array.isArray(c.softmaxTop3) ? c.softmaxTop3 : null;
    const top1 = softmaxTop && softmaxTop[0] && typeof softmaxTop[0] === "object" ? softmaxTop[0] : null;
    const conf =
      top1 && "confidence" in top1 && typeof /** @type {{ confidence: unknown }} */ (top1).confidence === "number"
        ? /** @type {{ confidence: number }} */ (top1).confidence
        : typeof c.confidence === "number"
          ? c.confidence
          : null;
    console.log("Confidence: ", conf != null ? conf : "—");
  }

  if (process.env.CLAIRA_DEBUG) {
    console.log(chalk.dim("\n--- full JSON (CLAIRA_DEBUG) ---"));
    console.log(JSON.stringify(result, null, 2));
  }

  console.log(chalk.dim("=== end ===\n"));
}

/**
 * @param {string} url
 */
function extensionFromImageUrl(url) {
  try {
    const ext = extname(new URL(url).pathname).toLowerCase();
    return ext && ext.length <= 8 ? ext : ".img";
  } catch {
    return ".img";
  }
}

/**
 * @param {string} absolutePath
 * @param {string} logicalFile — URL or path for ledger / logs
 */
async function runClairaOnDiskPath(absolutePath, logicalFile) {
  const embRes = await getImageEmbedding(absolutePath);
  if ("error" in embRes) {
    throw new Error(embRes.message ?? "embedding_failed");
  }
  const inputEmbedding = new Float32Array(embRes.embedding);
  const referenceEmbeddingsByLabel = await loadAllReferenceEmbeddings();
  const result = await analyze({
    inputEmbedding,
    referenceEmbeddingsByLabel,
    file: logicalFile,
  });

  logClairaResult(result, logicalFile);

  return result;
}

/**
 * Remote image URL → temp file → Claira.
 * @param {string} url
 */
export async function analyzeImage(url) {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      throw new Error(`image fetch failed: ${res.status} ${res.statusText}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const tmpDir = mkdtempSync(join(tmpdir(), "claira-img-"));
    const tmpPath = join(tmpDir, `input${extensionFromImageUrl(url)}`);
    writeFileSync(tmpPath, buf);
    try {
      return await runClairaOnDiskPath(tmpPath, url);
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup errors */
      }
    }
  } catch (err) {
    console.error("Claira analysis error:", err);

    return {
      label: "error",
      confidence: 0,
    };
  }
}

/**
 * Local PNG (or image) path → Claira.
 * @param {string} absolutePath
 */
export async function analyzeImageFile(absolutePath) {
  try {
    const resolved = resolve(absolutePath);
    if (!existsSync(resolved)) {
      throw new Error(`File not found: ${resolved}`);
    }
    return await runClairaOnDiskPath(resolved, resolved);
  } catch (err) {
    console.error("Claira analysis error:", err);

    return {
      label: "error",
      confidence: 0,
    };
  }
}

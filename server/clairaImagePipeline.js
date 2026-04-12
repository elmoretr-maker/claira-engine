/**
 * Shared Claira image → embedding → analyze (used by HTTP /run and folder watcher).
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { extname, join, resolve } from "path";
import { analyze } from "../index.js";
import { loadProcessFolderReferenceEmbeddings } from "../interfaces/processFolderPipeline.js";
import { getImageEmbedding } from "../vision/clipEmbedder.js";

/** @type {Map<string, Float32Array[]> | null} */
let referenceEmbeddingsByLabelCache = null;

function getReferenceEmbeddingsByLabel() {
  if (referenceEmbeddingsByLabelCache == null) {
    referenceEmbeddingsByLabelCache = loadProcessFolderReferenceEmbeddings();
  }
  return referenceEmbeddingsByLabelCache;
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
  console.log("Analyzing with Claira:", logicalFile);

  const embRes = await getImageEmbedding(absolutePath);
  if ("error" in embRes) {
    throw new Error(embRes.message ?? "embedding_failed");
  }
  const inputEmbedding = new Float32Array(embRes.embedding);
  const result = await analyze({
    inputEmbedding,
    referenceEmbeddingsByLabel: getReferenceEmbeddingsByLabel(),
    file: logicalFile,
  });

  console.log("Claira result:", JSON.stringify(result, null, 2));

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

/**
 * Exact duplicates by SHA-256; optional near-duplicate via image diff score (read-only).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertCapabilityModule } from "./capabilityContract.js";
import { imageDiffModule } from "./imageDiffModule.js";
import { getCachedFileHash } from "./capabilitySessionCache.js";

/**
 * @param {string} filePath
 */
function fileHash(filePath) {
  return getCachedFileHash(filePath, () => {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  });
}

export const assetDeduplicationModule = {
  id: "asset_deduplication",
  name: "Asset deduplication",
  description: "Group identical files by hash; optional near-duplicate pair check (read-only).",
  supportedIntents: ["duplicate", "dedup", "deduplication", "near duplicate", "duplicate files"],

  /**
   * @param {Record<string, unknown>} input
   * @param {import("./capabilityContract.js").CapabilityRunContext} context
   */
  async run(input, context) {
    const cwd = String(input.cwd ?? context.inputData?.cwd ?? process.cwd());
    const fileListRaw = Array.isArray(input.fileList)
      ? input.fileList
      : Array.isArray(context.inputData?.fileList)
        ? context.inputData.fileList
        : [];
    const rawPaths = input.paths ?? input.filePaths;
    const pathsExtra = Array.isArray(rawPaths) ? rawPaths.map((p) => String(p).trim()).filter(Boolean) : [];
    const single = String(input.sourcePath ?? context.inputData?.sourcePath ?? "").trim();
    const merged =
      fileListRaw.length > 0
        ? fileListRaw.map((p) => String(p).trim()).filter(Boolean)
        : pathsExtra.length > 0
          ? pathsExtra
          : single
            ? [single]
            : [];
    const resolved = merged.map((p) => (path.isAbsolute(p) ? p : path.resolve(cwd, p)));

    if (resolved.length === 0) {
      return {
        groups: [],
        nearDuplicatePairs: [],
        summary: "No file paths: fileList empty and no sourcePath on row.",
      };
    }

    /** @type {Map<string, string[]>} */
    const byHash = new Map();
    for (const p of resolved) {
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
      const h = fileHash(p);
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(p);
    }

    const groups = [...byHash.entries()]
      .filter(([, arr]) => arr.length > 1)
      .map(([hash, files]) => ({ hash, files: [...files].sort((a, b) => a.localeCompare(b)) }));

    /** @type {Array<{ pathA: string, pathB: string, differenceScore: number | null }>} */
    const nearDuplicatePairs = [];
    if (resolved.length === 2 && groups.length === 0) {
      const a = resolved[0];
      const b = resolved[1];
      const diff = await imageDiffModule.run(
        { pathA: a, pathB: b, cwd },
        { ...context, inputData: { ...context.inputData, cwd } },
      );
      if (diff && typeof diff === "object" && "differenceScore" in diff) {
        const ds = /** @type {{ differenceScore?: number | null }} */ (diff).differenceScore;
        if (typeof ds === "number" && ds > 0 && ds < 0.15) {
          nearDuplicatePairs.push({ pathA: a, pathB: b, differenceScore: ds });
        }
      }
    }

    return {
      groups,
      nearDuplicatePairs,
      summary: groups.length ? `${groups.length} duplicate group(s)` : "No exact duplicates in sample.",
    };
  },
};

assertCapabilityModule(assetDeduplicationModule, "assetDeduplicationModule");

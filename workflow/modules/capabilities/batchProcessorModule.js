/**
 * Simulated batch rename + organize (dry-run only).
 */

import path from "node:path";
import { assertCapabilityModule } from "./capabilityContract.js";

/**
 * @param {string} s
 */
function slug(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

export const batchProcessorModule = {
  id: "batch_processor",
  name: "Batch processor",
  description: "Simulated batch rename and folder placement (dry-run).",
  supportedIntents: ["batch", "bulk", "process many", "mass rename", "batch organize"],

  /**
   * @param {Record<string, unknown>} input
   * @param {import("./capabilityContract.js").CapabilityRunContext} context
   */
  run(input, context) {
    const cwd = String(input.cwd ?? context.inputData?.cwd ?? "").replace(/\\/g, "/");
    const fromList = Array.isArray(input.fileList)
      ? input.fileList.map((p) => String(p))
      : Array.isArray(context.inputData?.fileList)
        ? context.inputData.fileList.map((p) => String(p))
        : [];
    const paths = fromList.length
      ? fromList
      : Array.isArray(input.paths)
        ? input.paths.map((p) => String(p))
        : context.inputData?.sourcePath
          ? [String(context.inputData.sourcePath)]
          : [];
    const cat = context.refinedCategory != null ? slug(String(context.refinedCategory)) : "asset";
    /** @type {Array<{ from: string, suggestedRename: string, suggestedFolder: string }>} */
    const operations = [];
    for (const p of paths) {
      const base = path.basename(p);
      const suggestedRename = `${cat}_${base}`;
      const suggestedFolder = path.posix.join("assets", cat);
      operations.push({ from: p, suggestedRename, suggestedFolder });
    }
    return {
      simulation: true,
      operations,
      summary:
        operations.length > 0
          ? `${operations.length} file(s) simulated (no writes).`
          : "No paths in fileList — run a multi-file session or provide fileList.",
    };
  },
};

assertCapabilityModule(batchProcessorModule, "batchProcessorModule");

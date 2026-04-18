/**
 * Map category → suggested folder path (dry-run).
 */

import { assertCapabilityModule } from "./capabilityContract.js";
import { getDomainDefinition } from "./domainRegistry.js";
import { basenameFromPath, extractTaxHintsFromBasename } from "./taxFilenameHints.js";

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

export const folderStructureModule = {
  id: "folder_structure",
  name: "Folder structure",
  description: "Suggested folder path from category (dry-run, no filesystem writes).",
  supportedIntents: ["folder", "organize", "directory", "path", "structure", "sort into folder"],

  /**
   * @param {Record<string, unknown>} input
   * @param {import("./capabilityContract.js").CapabilityRunContext} context
   */
  run(input, context) {
    const dm =
      context.inputData != null &&
      typeof context.inputData === "object" &&
      !Array.isArray(context.inputData) &&
      typeof /** @type {{ domainMode?: string }} */ (context.inputData).domainMode === "string"
        ? String(/** @type {{ domainMode?: string }} */ (context.inputData).domainMode).trim()
        : "";
    if (getDomainDefinition(dm).id === "tax") {
      const path =
        typeof input.primaryFile === "string" && input.primaryFile.trim()
          ? input.primaryFile
          : typeof input.sourcePath === "string"
            ? input.sourcePath
            : "";
      const hints = extractTaxHintsFromBasename(basenameFromPath(path));
      const root =
        String(input.rootFolder ?? "Clients").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || "Clients";
      const yearSeg = slug(hints.year) || "unknown_year";
      const docSeg = slug(hints.documentType) || "document";
      const suggestedFolderPath = `${root}/${hints.clientSlug}/${yearSeg}/${docSeg}`;
      return {
        suggestedFolderPath,
        summary: `Would place under ${suggestedFolderPath}/ (dry-run).`,
      };
    }

    const cat = context.refinedCategory != null ? String(context.refinedCategory) : "general";
    const s = slug(cat) || "general";
    const root = String(input.rootFolder ?? "assets").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || "assets";
    const suggestedFolderPath = `${root}/${s}`;
    return {
      suggestedFolderPath,
      summary: `Would place under ${suggestedFolderPath}/ (dry-run).`,
    };
  },
};

assertCapabilityModule(folderStructureModule, "folderStructureModule");

/**
 * Suggest filename from category + intent (dry-run string only).
 */

import { assertCapabilityModule } from "./capabilityContract.js";
import { getDomainDefinition } from "./domainRegistry.js";
import { basenameFromPath, extractTaxHintsFromBasename, fileExtensionFromPath } from "./taxFilenameHints.js";
import { extractFitnessHintsFromPaths } from "./fitnessFilenameHints.js";

/**
 * @param {string} s
 */
function slug(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

export const smartRenameModule = {
  id: "smart_rename",
  name: "Smart rename",
  description: "Suggested filename from refined category and intent labels (dry-run).",
  supportedIntents: ["rename", "filename", "suggest name", "file name", "naming"],

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
      const ext = fileExtensionFromPath(path);
      const hints = extractTaxHintsFromBasename(basenameFromPath(path));
      const suggestedFilename = `${hints.clientSlug}_${hints.year}_${hints.documentType}${ext}`;
      return {
        suggestedFilename,
        baseSlug: hints.clientSlug,
        summary: `Suggested: ${suggestedFilename}`,
      };
    }

    if (getDomainDefinition(dm).id === "fitness") {
      const path =
        typeof input.primaryFile === "string" && input.primaryFile.trim()
          ? input.primaryFile
          : typeof input.sourcePath === "string"
            ? input.sourcePath
            : "";
      const ext = fileExtensionFromPath(path);
      const hints = extractFitnessHintsFromPaths(path.replace(/\\/g, "/"));
      const suggestedFilename = `${hints.clientSlug}_${hints.stageSlug}_${hints.bodyView}${ext}`;
      return {
        suggestedFilename,
        baseSlug: hints.clientSlug,
        summary: `Suggested: ${suggestedFilename}`,
      };
    }

    const cat = context.refinedCategory != null ? String(context.refinedCategory) : "";
    const base = slug(cat) || "asset";
    const topIntent =
      context.intentCandidates.length > 0 && typeof context.intentCandidates[0]?.label === "string"
        ? slug(context.intentCandidates[0].label).slice(0, 40)
        : "";
    const suggestedFilename = topIntent && topIntent !== base ? `${base}__${topIntent}.png` : `${base}_claira.png`;
    return {
      suggestedFilename,
      baseSlug: base,
      summary: `Suggested: ${suggestedFilename}`,
    };
  },
};

assertCapabilityModule(smartRenameModule, "smartRenameModule");

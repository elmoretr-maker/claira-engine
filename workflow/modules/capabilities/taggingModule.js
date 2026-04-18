/**
 * Derive tag list from category + intent candidates (deterministic).
 */

import { assertCapabilityModule } from "./capabilityContract.js";
import { getDomainDefinition } from "./domainRegistry.js";
import { basenameFromPath, extractTaxHintsFromBasename } from "./taxFilenameHints.js";
import { extractFitnessHintsFromPaths } from "./fitnessFilenameHints.js";
import { extractContractorHintsFromPaths } from "./contractorFilenameHints.js";

/**
 * @param {string} s
 */
function tokenize(s) {
  return String(s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2)
    .slice(0, 12);
}

export const taggingModule = {
  id: "tagging",
  name: "Tagging",
  description: "Tag list from refined category and intent labels (deterministic).",
  supportedIntents: ["tags", "keywords", "labels", "hashtags", "classify tags"],

  /**
   * @param {Record<string, unknown>} input
   * @param {import("./capabilityContract.js").CapabilityRunContext} context
   */
  run(input, context) {
    /** @type {Set<string>} */
    const tags = new Set();
    const cat = context.refinedCategory != null ? String(context.refinedCategory).trim() : "";
    if (cat) tags.add(cat.toLowerCase().replace(/\s+/g, "-"));
    for (const c of context.intentCandidates) {
      for (const w of tokenize(c.label)) tags.add(w);
    }

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
      const base = basenameFromPath(path);
      const hints = extractTaxHintsFromBasename(base);
      tags.add(`client_name:${hints.clientSlug}`);
      tags.add(`tax_year:${hints.year}`);
      tags.add(`document_type:${hints.documentType}`);
    }

    if (getDomainDefinition(dm).id === "fitness") {
      const path =
        typeof input.primaryFile === "string" && input.primaryFile.trim()
          ? input.primaryFile
          : typeof input.sourcePath === "string"
            ? input.sourcePath
            : "";
      if (path) {
        const hints = extractFitnessHintsFromPaths(path.replace(/\\/g, "/"));
        tags.add(`client_name:${hints.clientSlug}`);
        tags.add(`stage:${hints.stageSlug}`);
        tags.add(`body_view:${hints.bodyView}`);
      }
    }

    if (getDomainDefinition(dm).id === "contractor") {
      const path =
        typeof input.primaryFile === "string" && input.primaryFile.trim()
          ? input.primaryFile
          : typeof input.sourcePath === "string"
            ? input.sourcePath
            : "";
      if (path) {
        const hints = extractContractorHintsFromPaths(path.replace(/\\/g, "/"));
        tags.add(`project_name:${hints.projectSlug}`);
        tags.add(`room:${hints.roomSlug}`);
        tags.add(`stage:${hints.stageSlug}`);
      }
    }

    const list = [...tags].sort((a, b) => a.localeCompare(b));
    return {
      tags: list,
      suggestedTags: list,
      summary: list.length ? list.join(", ") : "no tags",
    };
  },
};

assertCapabilityModule(taggingModule, "taggingModule");

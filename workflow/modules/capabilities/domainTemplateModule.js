/**
 * Domain presets — configuration data only (no I/O).
 */

import { assertCapabilityModule } from "./capabilityContract.js";

/** @type {Record<string, { modules: string[], configuration: Record<string, unknown> }>} */
const PRESETS = {
  "game-dev": {
    modules: ["metadata_extractor", "tagging", "asset_deduplication", "folder_structure"],
    configuration: { packStyle: "sprites", reviewThreshold: 0.55 },
  },
  business: {
    modules: ["metadata_extractor", "tagging", "review", "smart_rename"],
    configuration: { packStyle: "documents", reviewThreshold: 0.72 },
  },
  general: {
    modules: ["metadata_extractor", "tagging", "timer"],
    configuration: { packStyle: "general", reviewThreshold: 0.65 },
  },
};

/**
 * @param {import("./capabilityContract.js").CapabilityRunContext} context
 */
function pickPreset(context) {
  const text = [
    ...context.intentCandidates.map((c) => c.label),
    context.refinedCategory != null ? String(context.refinedCategory) : "",
  ]
    .join(" ")
    .toLowerCase();
  if (/game|sprite|texture|unity|unreal/.test(text)) return "game-dev";
  if (/business|invoice|pdf|office|doc/.test(text)) return "business";
  return "general";
}

export const domainTemplateModule = {
  id: "domain_template",
  name: "Domain template",
  description: "Preset module lists and configuration for game-dev, business, or general.",
  supportedIntents: [
    "template",
    "domain",
    "preset",
    "game-dev",
    "business",
    "general",
    "industry pack",
  ],

  /**
   * @param {Record<string, unknown>} input
   * @param {import("./capabilityContract.js").CapabilityRunContext} context
   */
  run(input, context) {
    const forced = typeof input.preset === "string" ? input.preset.trim().toLowerCase() : "";
    const key =
      forced === "game-dev" || forced === "business" || forced === "general"
        ? forced
        : pickPreset(context);
    const preset = PRESETS[key] ?? PRESETS.general;
    return {
      preset: key,
      selectedModules: [...preset.modules],
      configuration: { ...preset.configuration },
      summary: `Preset "${key}" with ${preset.modules.length} suggested capabilities.`,
    };
  },
};

assertCapabilityModule(domainTemplateModule, "domainTemplateModule");

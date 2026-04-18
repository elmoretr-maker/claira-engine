/**
 * Domain modes for controlled capability planning (deterministic; no runtime mutation).
 */

/** @typedef {{ id: string, purpose?: string, allowedModules: string[], preferredModules: string[], defaultFlow: string[], tagHints?: string[] }} DomainDefinition */

/**
 * @param {string} s
 */
function normDomainKey(s) {
  const k = String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (k === "gamedev" || k === "game dev") return "game-dev";
  return k;
}

/** @type {Record<string, DomainDefinition>} */
const DOMAINS = {
  general: {
    id: "general",
    purpose: "Default asset processing and organization.",
    allowedModules: [
      "image_diff",
      "asset_deduplication",
      "metadata_extractor",
      "smart_rename",
      "folder_structure",
      "tagging",
      "review",
      "batch_processor",
      "timer",
      "domain_template",
      "receipt_tracking",
    ],
    preferredModules: ["metadata_extractor", "tagging", "smart_rename", "folder_structure"],
    defaultFlow: ["metadata_extractor", "tagging", "smart_rename", "folder_structure"],
  },
  "game-dev": {
    id: "game-dev",
    purpose: "Batch assets, engine-ready naming, template hints.",
    allowedModules: [
      "metadata_extractor",
      "tagging",
      "smart_rename",
      "folder_structure",
      "batch_processor",
      "domain_template",
      "asset_deduplication",
      "image_diff",
      "review",
      "timer",
    ],
    preferredModules: ["metadata_extractor", "batch_processor", "domain_template", "tagging"],
    defaultFlow: ["metadata_extractor", "tagging", "batch_processor", "domain_template"],
  },
  fitness: {
    id: "fitness",
    purpose: "Client transformations, progress photos, and timeline-based fitness journeys.",
    allowedModules: [
      "metadata_extractor",
      "tagging",
      "smart_rename",
      "folder_structure",
      "fitness_image_comparison",
    ],
    preferredModules: ["tagging", "smart_rename", "folder_structure"],
    defaultFlow: ["tagging", "smart_rename", "folder_structure"],
    tagHints: ["client_name", "stage", "body_view"],
  },
  tax: {
    id: "tax",
    purpose:
      "Track client financial files, organize yearly returns, monitor income-related documents (dry-run metadata and paths only).",
    allowedModules: [
      "metadata_extractor",
      "tagging",
      "smart_rename",
      "folder_structure",
      "review",
      "tax_document_comparison",
      "receipt_tracking",
    ],
    preferredModules: ["metadata_extractor", "tagging", "smart_rename", "folder_structure"],
    defaultFlow: ["metadata_extractor", "tagging", "smart_rename", "folder_structure"],
    tagHints: ["client_name", "tax_year", "document_type"],
  },
  contractor: {
    id: "contractor",
    purpose: "Construction projects, room-based timelines, and budget tracking (no tax/PDF pipelines).",
    allowedModules: [
      "metadata_extractor",
      "tagging",
      "smart_rename",
      "folder_structure",
      "fitness_image_comparison",
      "contractor_cost_tracking",
      "receipt_tracking",
    ],
    preferredModules: ["tagging", "smart_rename", "folder_structure"],
    defaultFlow: ["tagging", "smart_rename", "folder_structure"],
    tagHints: ["project_name", "room", "stage"],
  },
};

/**
 * @returns {string[]}
 */
export function listDomainIds() {
  return ["general", "game-dev", "fitness", "tax", "contractor"];
}

/**
 * True when domainMode maps to an explicit domain key (not a fallback to general).
 * @param {string | null | undefined} domainMode
 * @returns {boolean}
 */
export function domainModeIsRegistered(domainMode) {
  const key = normDomainKey(domainMode ?? "");
  return Boolean(key && DOMAINS[key]);
}

/**
 * @param {string | null | undefined} domainMode
 * @returns {DomainDefinition}
 */
export function getDomainDefinition(domainMode) {
  const key = normDomainKey(domainMode ?? "");
  if (key && DOMAINS[key]) return DOMAINS[key];
  return DOMAINS.general;
}

/**
 * @param {string} moduleId
 * @param {string | null | undefined} domainMode
 * @returns {boolean}
 */
export function isModuleAllowedInDomain(moduleId, domainMode) {
  const d = getDomainDefinition(domainMode);
  const id = String(moduleId ?? "").trim();
  if (!id) return false;
  if (!Array.isArray(d.allowedModules) || d.allowedModules.length === 0) return true;
  return d.allowedModules.includes(id);
}

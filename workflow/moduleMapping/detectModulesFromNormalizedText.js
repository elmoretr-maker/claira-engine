import { REGISTERED_WORKFLOW_MODULE_IDS } from "../validation/workflowTemplateContract.js";
import { MODULE_KEYWORD_MAP } from "./moduleKeywordMap.js";

/**
 * Keyword hits only (high-confidence detection). Never throws; may return [].
 * @param {string} normalizedText — trimmed lowercased (industryName + " " + buildIntent)
 * @returns {string[]} module ids in contract order
 */
export function getKeywordDetectedModules(normalizedText) {
  const text = String(normalizedText ?? "").trim().toLowerCase();
  if (!text) return [];

  /** @type {Set<string>} */
  const hit = new Set();
  for (const mid of REGISTERED_WORKFLOW_MODULE_IDS) {
    const entry = MODULE_KEYWORD_MAP[mid];
    if (!entry || !Array.isArray(entry.keywords)) continue;
    for (const kw of entry.keywords) {
      if (typeof kw === "string" && kw && text.includes(kw.toLowerCase())) {
        hit.add(mid);
        break;
      }
    }
  }

  return REGISTERED_WORKFLOW_MODULE_IDS.filter((id) => hit.has(id));
}

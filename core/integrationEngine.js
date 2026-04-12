/**
 * Mock integration payloads and lightweight analysis (no external APIs).
 */

import { registerSimulation } from "./simulationRegistry.js";
import { SYSTEM_MODE } from "./systemMode.js";

/**
 * @param {unknown} systemType
 * @returns {{
 *   system: string,
 *   items: Array<{ name: string, category: string | null, tags?: string[] }>,
 *   __simulated: true,
 * }}
 */
export function simulateIntegration(systemType) {
  if (SYSTEM_MODE !== "simulation") {
    throw new Error("Simulation is disabled in real mode");
  }

  const key = String(systemType ?? "generic")
    .toLowerCase()
    .trim();

  if (key === "shopify") {
    return {
      system: "shopify",
      items: [
        { name: "Product A", category: null },
        { name: "Product B", category: "Shoes" },
      ],
      __simulated: true,
    };
  }

  if (key === "wix") {
    return {
      system: "wix",
      items: [
        { name: "Site Product A", category: null },
        { name: "Site Product B", category: "Accessories", tags: ["new", "NEW"] },
      ],
      __simulated: true,
    };
  }

  return {
    system: "generic",
    items: [
      { name: "Item 1", category: null },
      { name: "Item 2", category: "Uncategorized" },
    ],
    __simulated: true,
  };
}

/**
 * @param {unknown} data
 * @returns {{ issues: string[], suggestions: string[] }}
 */
export function analyzeIntegrationData(data) {
  /** @type {string[]} */
  const issues = [];
  /** @type {string[]} */
  const suggestions = [];

  const items = data != null && typeof data === "object" && Array.isArray(/** @type {{ items?: unknown }} */ (data).items)
    ? /** @type {{ items: unknown[] }} */ (data).items
    : [];

  if (items.length === 0) {
    return {
      issues: ["No items in preview payload"],
      suggestions: ["Connect a live integration to import items"],
    };
  }

  const missingCategory = items.some((it) => {
    if (it == null || typeof it !== "object") return true;
    const c = /** @type {{ category?: unknown }} */ (it).category;
    return c == null || String(c).trim() === "";
  });
  const hasCategory = items.some((it) => {
    if (it == null || typeof it !== "object") return false;
    const c = /** @type {{ category?: unknown }} */ (it).category;
    return c != null && String(c).trim() !== "";
  });

  if (missingCategory) {
    issues.push("Products missing categories");
    suggestions.push("Auto-categorize products");
  }

  let tagInconsistent = false;
  for (const it of items) {
    if (it == null || typeof it !== "object") continue;
    const tags = /** @type {{ tags?: unknown }} */ (it).tags;
    if (!Array.isArray(tags) || tags.length === 0) continue;
    const strs = tags.map((t) => String(t));
    const lowered = strs.map((t) => t.toLowerCase());
    if (new Set(lowered).size < strs.length) tagInconsistent = true;
    const hasSaleMix = strs.some((t) => t === "sale") && strs.some((t) => t === "SALE");
    if (hasSaleMix) tagInconsistent = true;
  }

  if (missingCategory && hasCategory) {
    if (!issues.includes("Inconsistent tagging")) issues.push("Inconsistent tagging");
    if (!suggestions.includes("Normalize tags")) suggestions.push("Normalize tags");
  }

  if (tagInconsistent) {
    if (!issues.includes("Inconsistent tagging")) issues.push("Inconsistent tagging");
    if (!suggestions.includes("Normalize tags")) suggestions.push("Normalize tags");
  }

  if (issues.length === 0) {
    issues.push("No blocking issues detected (preview)");
    suggestions.push("Review catalog periodically");
  }

  return { issues, suggestions };
}

/**
 * Map integration suggestions to expectation lines for workflow comparison.
 * @param {string[]} suggestions
 * @returns {string[]}
 */
export function suggestionsToExpectedItems(suggestions) {
  if (!Array.isArray(suggestions)) return [];
  return [...new Set(suggestions.map((s) => String(s).trim()).filter(Boolean))];
}

registerSimulation({
  name: "integration_preview",
  location: "core/integrationEngine.js",
  description: "Simulated external API data (Shopify/Wix)",
  replaceWith: "Real API integration (Shopify/Wix REST APIs)",
});

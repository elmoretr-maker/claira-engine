/**
 * Phase 9 — Config-driven routing from classifier output (category + labels only).
 * No filename/path logic here; callers must not pass paths into matching.
 */

/**
 * @typedef {{
 *   match: { categories?: string[], labels?: string[] },
 *   destination: string,
 * }} AssetRoutingRule
 */

/**
 * @typedef {{
 *   routes: AssetRoutingRule[],
 *   defaultDestination?: string,
 * }} AssetRoutingConfig
 */

/** @type {AssetRoutingConfig} */
export const DEFAULT_ASSET_ROUTING_CONFIG = {
  routes: [
    {
      match: {
        categories: ["review"],
        labels: ["review", "needs review", "manual review"],
      },
      destination: "Review",
    },
    {
      match: {
        categories: ["video game asset"],
        labels: ["video game asset"],
      },
      destination: "Game",
    },
    {
      match: {
        categories: ["ui element"],
        labels: ["ui element", "ui"],
      },
      destination: "UI",
    },
    {
      match: {
        categories: ["document"],
        labels: ["document"],
      },
      destination: "Documents",
    },
    {
      match: {
        categories: ["photograph"],
        labels: ["photograph", "photo"],
      },
      destination: "Reference",
    },
  ],
  defaultDestination: "Other",
};

/**
 * @param {string} s
 */
function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Deduplicated normalized labels for routing (lowercase, trimmed).
 * @param {unknown} labels
 * @returns {string[]}
 */
export function normalizeAnalysisLabels(labels) {
  if (!Array.isArray(labels)) return [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const x of labels) {
    const n = norm(x);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Match classifier output to a destination using config only (category + labels).
 * @param {{ category?: string, labels?: string[] }} analysis
 * @param {AssetRoutingConfig} config
 * @returns {{ destination: string, matchedBy: "category" | "label" | "default", matchedKey: string }}
 */
export function resolveRoutingDestination(analysis, config) {
  const cat = norm(analysis?.category);
  const labels = normalizeAnalysisLabels(analysis?.labels);
  const routes = Array.isArray(config?.routes) ? config.routes : [];

  for (const route of routes) {
    if (route == null || typeof route !== "object") continue;
    const dest = typeof route.destination === "string" ? route.destination.trim() : "";
    if (!dest) continue;
    const m = route.match;
    if (m == null || typeof m !== "object") continue;

    const cats = Array.isArray(m.categories) ? m.categories.map(norm).filter(Boolean) : [];
    for (const c of cats) {
      if (c && cat === c) {
        return { destination: dest, matchedBy: "category", matchedKey: cat };
      }
    }

    const lblRules = Array.isArray(m.labels) ? m.labels.map(norm).filter(Boolean) : [];
    for (const needle of lblRules) {
      if (!needle) continue;
      for (const L of labels) {
        if (L === needle || L.includes(needle)) {
          return { destination: dest, matchedBy: "label", matchedKey: needle };
        }
      }
      if (cat && (cat === needle || cat.includes(needle))) {
        return { destination: dest, matchedBy: "label", matchedKey: needle };
      }
    }
  }

  const fallback =
    typeof config?.defaultDestination === "string" && config.defaultDestination.trim()
      ? config.defaultDestination.trim()
      : "Other";
  return { destination: fallback, matchedBy: "default", matchedKey: "" };
}

/**
 * Label → destination path resolution (config-driven, no filesystem, no synthetic fallbacks).
 */

/**
 * @param {unknown} p
 * @returns {string|null}
 */
function normalizePath(p) {
  if (p == null || p === "") return null;
  return String(p)
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "");
}

/**
 * @param {Record<string, string> | undefined} obj
 * @returns {Record<string, string>}
 */
function asStringMap(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  return obj;
}

/**
 * Resolve a label to a destination path using categories and optional aliases.
 * Aliases map raw label → category key; category keys map to path strings.
 *
 * @param {string|null|undefined} label
 * @param {{ categories?: Record<string, string>, aliases?: Record<string, string> }} config
 * @returns {string|null}
 */
export function resolveDestination(label, config) {
  const categories = asStringMap(config?.categories);
  const aliases = asStringMap(config?.aliases);
  const key = String(label ?? "").trim();
  if (!key) return null;

  if (Object.prototype.hasOwnProperty.call(categories, key)) {
    return normalizePath(categories[key]);
  }

  if (Object.prototype.hasOwnProperty.call(aliases, key)) {
    const target = String(aliases[key] ?? "").trim();
    if (!target) return null;
    if (Object.prototype.hasOwnProperty.call(categories, target)) {
      return normalizePath(categories[target]);
    }
    return null;
  }

  return null;
}

/**
 * Routing priority:
 * 1. If predicted_label resolves → use it as proposed_destination (always).
 * 2. Else → walk cosine-ranked candidates in order for first valid path + alternatives.
 * Only resolved paths; no synthetic folders; no implicit fallback to predicted after cosine pass.
 *
 * @param {{
 *   predicted_label: string | null,
 *   visualCosineTop3?: Array<{ id: string, cosine: number }>,
 *   confidence: number
 * }} classificationResult
 * @param {{ categories?: Record<string, string>, aliases?: Record<string, string> }} config
 * @returns {{
 *   proposed_destination: string | null,
 *   routing_label: string | null,
 *   alternative_destinations: Array<{ label: string, destination: string, score: number }>
 * }}
 */
export function buildDestinations(classificationResult, config) {
  const top = classificationResult.visualCosineTop3 ?? [];
  const predicted = classificationResult.predicted_label;
  const predictedDest = predicted ? resolveDestination(predicted, config) : null;

  if (predictedDest) {
    const alternative_destinations = [];
    const seenDest = new Set([predictedDest]);

    for (const { id, cosine } of top) {
      if (id === predicted) continue;
      const dest = resolveDestination(id, config);
      if (!dest || seenDest.has(dest)) continue;
      seenDest.add(dest);
      alternative_destinations.push({
        label: id,
        destination: dest,
        score: Number(Number(cosine).toFixed(6)),
      });
    }

    return {
      proposed_destination: predictedDest,
      routing_label: predicted,
      alternative_destinations,
    };
  }

  const rows = [];
  const seenDest = new Set();
  for (const { id, cosine } of top) {
    const dest = resolveDestination(id, config);
    if (!dest) continue;
    if (seenDest.has(dest)) continue;
    seenDest.add(dest);
    rows.push({
      label: id,
      destination: dest,
      score: Number(Number(cosine).toFixed(6)),
    });
  }

  return {
    proposed_destination: rows[0]?.destination ?? null,
    routing_label: rows[0]?.label ?? null,
    alternative_destinations: rows.slice(1),
  };
}

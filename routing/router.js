/**
 * Label → destination path resolution (room-driven; categories in engine.config are ignored here).
 */

import { loadRooms } from "../rooms/index.js";

/** @type {ReturnType<typeof loadRooms> | null} */
let cachedRooms = null;

function getRooms() {
  if (!cachedRooms) {
    cachedRooms = loadRooms();
  }
  return cachedRooms;
}

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
 * Resolve a label to a destination path using `rooms/` (see loadRooms) and optional aliases.
 * Aliases map raw label → room key; room keys must exist under `rooms/<name>/`.
 *
 * @param {string|null|undefined} label
 * @param {{ categories?: Record<string, string>, aliases?: Record<string, string> }} config
 * @returns {string|null}
 */
export function resolveDestination(label, config) {
  const rooms = getRooms();
  const aliases = asStringMap(config?.aliases);
  const key = String(label ?? "").trim();
  if (!key) return null;

  const room = rooms[key];
  if (room?.config?.destination != null) {
    return normalizePath(room.config.destination);
  }

  if (Object.prototype.hasOwnProperty.call(aliases, key)) {
    const target = String(aliases[key] ?? "").trim();
    if (!target) return null;
    const via = rooms[target];
    if (via?.config?.destination != null) {
      return normalizePath(via.config.destination);
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

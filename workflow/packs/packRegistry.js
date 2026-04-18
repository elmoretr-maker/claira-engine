/**
 * Built-in category pack catalog (display + domainMode only). Behavior lives in domainRegistry.
 */

import { readCustomPackEntries } from "./customPacksStore.js";

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   domainMode: string,
 *   description?: string,
 *   inputVerb?: string,
 * }} PackCatalogEntry
 */

/** @type {PackCatalogEntry[]} */
export const BUILTIN_PACK_REGISTRY = [
  {
    id: "ecommerce",
    name: "Ecommerce",
    domainMode: "general",
    description: "Product imagery and catalog organization.",
    inputVerb: "Add products or images",
  },
  {
    id: "game-dev",
    name: "Game development",
    domainMode: "game-dev",
    description: "Game art and asset pipelines.",
    inputVerb: "Add game art or assets",
  },
  {
    id: "medical",
    name: "Medical",
    domainMode: "general",
    description: "Clinical documents and imaging.",
    inputVerb: "Add clinical files or images",
  },
  {
    id: "tax",
    name: "Tax Management",
    domainMode: "tax",
    description: "Organize, track, and manage client tax documents and yearly returns",
    inputVerb: "Add tax documents or client files",
  },
  {
    id: "fitness",
    name: "Fitness Tracking",
    domainMode: "fitness",
    description: "Track client transformations, progress photos, and fitness journeys",
    inputVerb: "Add progress photos or client folders",
  },
  {
    id: "contractor",
    name: "General Contractor",
    domainMode: "contractor",
    description: "Track construction projects, progress, and costs",
    inputVerb: "Add project photos or site folders",
  },
];

/**
 * @returns {PackCatalogEntry[]}
 */
export function getAllPackRegistryEntries() {
  const builtinIds = new Set(BUILTIN_PACK_REGISTRY.map((p) => p.id));
  const custom = readCustomPackEntries().filter((c) => !builtinIds.has(c.id));
  return [...BUILTIN_PACK_REGISTRY, ...custom].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {string} rawId
 * @returns {PackCatalogEntry | undefined}
 */
export function getPackRegistryEntry(rawId) {
  const id = String(rawId ?? "")
    .trim()
    .toLowerCase();
  if (!id) return undefined;
  return getAllPackRegistryEntries().find((p) => p.id === id);
}

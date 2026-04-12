/**
 * Central list of simulated (non-production) capabilities for audit and replacement planning.
 */

/**
 * @typedef {{
 *   name: string,
 *   location: string,
 *   description: string,
 *   replaceWith: string,
 * }} SimulatedFeature
 */

/** @type {SimulatedFeature[]} */
const simulatedFeatures = [];

/**
 * @param {Partial<SimulatedFeature> & { name?: unknown }} feature
 */
export function registerSimulation(feature) {
  if (feature == null || typeof feature !== "object") return;
  const name = feature.name;
  if (typeof name !== "string" || !name.trim()) return;
  if (simulatedFeatures.some((f) => f.name === name)) return;

  const location = typeof feature.location === "string" ? feature.location : "";
  const description = typeof feature.description === "string" ? feature.description : "";
  const replaceWith = typeof feature.replaceWith === "string" ? feature.replaceWith : "";

  simulatedFeatures.push({
    name,
    location,
    description,
    replaceWith,
  });
}

/**
 * @returns {ReadonlyArray<SimulatedFeature>}
 */
export function getSimulations() {
  return [...simulatedFeatures];
}

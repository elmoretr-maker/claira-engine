/**
 * Closed vocabulary of pipeline artifact kinds (data contract tokens).
 * Modules may only declare consumes/produces using these kinds.
 */

/** @type {readonly string[]} */
export const ARTIFACT_KINDS = Object.freeze([
  "entity",
  "event",
  "asset",
  "analysis",
  "aggregate",
  "deliverable",
  "ui_model",
]);

const SET = new Set(ARTIFACT_KINDS);

/**
 * @param {string} kind
 * @returns {boolean}
 */
export function isRegisteredArtifactKind(kind) {
  return typeof kind === "string" && SET.has(kind);
}

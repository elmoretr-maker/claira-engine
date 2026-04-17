/**
 * Structural lifecycle mode for each produces entry (behavior not implemented in Phase 1).
 */

/** @typedef {"create" | "extend" | "derive" | "replace"} ProduceMode */

/** @type {readonly ProduceMode[]} */
export const PRODUCE_MODES = Object.freeze(
  /** @type {ProduceMode[]} */ (["create", "extend", "derive", "replace"]),
);

const MODE_SET = new Set(PRODUCE_MODES);

/**
 * @param {unknown} m
 * @returns {m is ProduceMode}
 */
export function isProduceMode(m) {
  return typeof m === "string" && MODE_SET.has(m);
}

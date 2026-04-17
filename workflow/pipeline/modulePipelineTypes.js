/**
 * Pipeline role of a module — used for ordering and connection validation only.
 */

/** @typedef {"input" | "processing" | "tracking" | "aggregation" | "output" | "presentation"} ModulePipelineType */

/** @type {readonly ModulePipelineType[]} */
export const MODULE_PIPELINE_TYPES = Object.freeze(
  /** @type {ModulePipelineType[]} */ ([
    "input",
    "processing",
    "tracking",
    "aggregation",
    "output",
    "presentation",
  ]),
);

const TYPE_SET = new Set(MODULE_PIPELINE_TYPES);

/**
 * @param {unknown} t
 * @returns {t is ModulePipelineType}
 */
export function isModulePipelineType(t) {
  return typeof t === "string" && TYPE_SET.has(t);
}

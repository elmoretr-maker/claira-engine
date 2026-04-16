/**
 * Sealed engine output handoff: deep-clone then deep-freeze so modules cannot mutate pipeline results.
 * Boundary-safe, read-only contract for ModuleHost → modules.
 *
 * @typedef {Readonly<Record<string, unknown>>} SealedEngineOutput
 */

/**
 * Freeze children first so nested objects are not skipped (frozen parents make props non-configurable).
 * @param {unknown} o
 * @returns {unknown}
 */
function deepFreeze(o) {
  if (o === null || typeof o !== "object") return o;
  for (const k of Reflect.ownKeys(o)) {
    const v = /** @type {Record<string | symbol, unknown>} */ (o)[k];
    if (v && typeof v === "object" && !Object.isFrozen(v)) deepFreeze(v);
  }
  return Object.freeze(o);
}

/**
 * @param {unknown} engineOutput — return value from runProcessItemsPipeline / runProcessFolderPipeline
 * @returns {SealedEngineOutput}
 */
export function createSealedEngineOutput(engineOutput) {
  const cloned = structuredClone(engineOutput);
  deepFreeze(cloned);
  return /** @type {SealedEngineOutput} */ (cloned);
}

/**
 * Dev-only: throws if a sealed output can be mutated (run in validation scripts).
 */
export function devAssertSealedEngineOutputImmutable() {
  let mutationSucceeded = false;
  try {
    const probe = createSealedEngineOutput({ results: [{ x: 1 }], processed: 0 });
    probe.results[0].x = 99;
    mutationSucceeded = true;
  } catch {
    /* TypeError expected */
  }
  if (mutationSucceeded) {
    throw new Error("SealedEngineOutput must be immutable (deep-cloned and deep-frozen)");
  }
}

/**
 * Output routing for processed results.
 */

import { SYSTEM_MODE } from "../core/systemMode.js";
import { exportToFile } from "./fileOutput.js";
import { exportToExternal as exportToExternalSimulated } from "./externalOutput.js";
import * as realExternalOutput from "./realExternalOutput.js";

/**
 * @param {unknown} results
 * @param {string} [externalTarget]
 */
function exportExternalResolved(results, externalTarget) {
  if (SYSTEM_MODE === "simulation") {
    return exportToExternalSimulated(results, externalTarget);
  }
  if (!realExternalOutput.REAL_EXTERNAL_OUTPUT_READY) {
    throw new Error("Real external output not implemented. Cannot proceed in real mode.");
  }
  return realExternalOutput.exportToExternal(results, externalTarget);
}

/**
 * @param {{
 *   target: string,
 *   results: unknown,
 *   cwd?: string,
 *   split?: boolean,
 *   externalTarget?: string
 * }} args
 * @returns {Record<string, unknown>}
 */
export function sendOutput(args) {
  const target = args?.target;
  const results = args?.results;
  const t = String(target ?? "").toLowerCase();

  if (t === "file") {
    return exportToFile(results, { cwd: args.cwd, split: args.split });
  }

  if (t === "external") {
    return exportExternalResolved(results, args.externalTarget);
  }

  throw new Error(`sendOutput: unknown target "${String(target)}" (expected file | external)`);
}

/**
 * @param {unknown} results
 * @param {string} [target]
 */
export function exportToExternal(results, target) {
  return exportExternalResolved(results, target);
}

export { exportToFile } from "./fileOutput.js";

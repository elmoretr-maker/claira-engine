/**
 * Output routing for processed results.
 */

import { exportToFile } from "./fileOutput.js";
import { exportToExternal } from "./externalOutput.js";

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
    return exportToExternal(results, args.externalTarget);
  }

  throw new Error(`sendOutput: unknown target "${String(target)}" (expected file | external)`);
}

export { exportToFile } from "./fileOutput.js";
export { exportToExternal } from "./externalOutput.js";

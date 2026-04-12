/**
 * Adapter registry for ingestion sources.
 */

import { SYSTEM_MODE } from "../core/systemMode.js";
import * as fileAdapter from "./fileAdapter.js";
import * as documentAdapter from "./documentAdapter.js";
import * as mockExternalAdapter from "./mockExternalAdapter.js";
import * as realExternalAdapter from "./realExternalAdapter.js";

/** @typedef {"file" | "document" | "external"} AdapterType */

/**
 * @param {string} type
 * @returns {typeof fileAdapter | typeof documentAdapter | typeof mockExternalAdapter}
 */
export function getAdapter(type) {
  const t = String(type).toLowerCase();
  if (t === "file") return fileAdapter;
  if (t === "document") return documentAdapter;
  if (t === "external") {
    if (SYSTEM_MODE === "simulation") {
      return mockExternalAdapter;
    }
    if (!realExternalAdapter.REAL_EXTERNAL_ADAPTER_READY) {
      throw new Error("Real external adapter not implemented. Cannot proceed in real mode.");
    }
    return realExternalAdapter;
  }
  throw new Error(`adapter: unknown source "${type}" (expected file | document | external)`);
}

/**
 * @returns {Promise<import("./baseAdapter.js").StandardInput[]>}
 */
export async function fetchExternalData() {
  return getAdapter("external").fetchExternalData();
}

export { normalizeInput } from "./baseAdapter.js";
export { ingestFiles } from "./fileAdapter.js";
export { ingestDocuments } from "./documentAdapter.js";

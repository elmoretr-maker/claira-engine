/**
 * Adapter registry for ingestion sources.
 */

import * as fileAdapter from "./fileAdapter.js";
import * as documentAdapter from "./documentAdapter.js";
import * as mockExternalAdapter from "./mockExternalAdapter.js";

/** @typedef {"file" | "document" | "external"} AdapterType */

/**
 * @param {string} type
 * @returns {typeof fileAdapter | typeof documentAdapter | typeof mockExternalAdapter}
 */
export function getAdapter(type) {
  const t = String(type).toLowerCase();
  if (t === "file") return fileAdapter;
  if (t === "document") return documentAdapter;
  if (t === "external") return mockExternalAdapter;
  throw new Error(`adapter: unknown source "${type}" (expected file | document | external)`);
}

export { normalizeInput } from "./baseAdapter.js";
export { ingestFiles } from "./fileAdapter.js";
export { ingestDocuments } from "./documentAdapter.js";
export { fetchExternalData } from "./mockExternalAdapter.js";

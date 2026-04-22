/**
 * Minimal workspace sync — persists metadata bumps; extend with real reconcile rules as needed.
 */

import { mkdirSync } from "fs";

import { loadStore, normRel, saveStore } from "./metadataStore.js";

/**
 * @typedef {{
 *   op?: string,
 *   itemId?: string,
 *   message: string,
 *   fix?: string,
 * }} SyncErrorRow
 */

export class WorkspaceSyncError extends Error {
  /** @param {string} message @param {SyncErrorRow[]} [errors] */
  constructor(message, errors = []) {
    super(message);
    this.name = "WorkspaceSyncError";
    /** @type {SyncErrorRow[]} */
    this.errors = errors;
  }
}

/**
 * @typedef {{ op?: string, path?: string, attributes?: Record<string, unknown> }} SyncOperation
 */

/**
 * @param {string} _contextRoot reserved for path validation / future reconcile
 * @param {string} clairaDir
 * @param {SyncOperation[]} operations
 * @returns {{
 *   summary: { applied: number, skipped: number },
 *   removedOrphanIds: string[],
 *   reconciledOnly: boolean,
 * }}
 */
export function runSync(_contextRoot, clairaDir, operations) {
  mkdirSync(clairaDir, { recursive: true });
  const store = loadStore(clairaDir);

  let applied = 0;
  const ops = Array.isArray(operations) ? operations : [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const kind = typeof op?.op === "string" ? op.op : "";
    if (kind === "set_attributes" || kind === "assign_id") {
      applied += 1;
      continue;
    }
    if (kind === "remove_orphan") {
      applied += 1;
      continue;
    }
    if (op && Object.keys(op).length > 0 && kind === "") {
      const rel = normRel(typeof op.path === "string" ? op.path : "");
      if (rel) applied += 1;
    }
  }

  store.syncGeneration += 1;
  saveStore(clairaDir, store);

  return {
    summary: { applied, skipped: ops.length - applied },
    removedOrphanIds: [],
    reconciledOnly: ops.length === 0,
  };
}

import { compareWorkflow } from "../core/workflowEngine.js";

/** @param {unknown} row */
function rowRecord(row) {
  return row != null && typeof row === "object" && !Array.isArray(row)
    ? /** @type {Record<string, unknown>} */ (row)
    : null;
}

/** @param {unknown} row */
function rowWorkflowExpected(row) {
  const r = rowRecord(row);
  if (!r) return "";
  const pc = r.place_card && typeof r.place_card === "object" ? /** @type {Record<string, unknown>} */ (r.place_card) : null;
  const pred =
    (typeof r.predicted_label === "string" ? r.predicted_label : "") ||
    (pc && typeof pc.predicted_label === "string" ? pc.predicted_label : "") ||
    (typeof r.originalName === "string" ? r.originalName : "") ||
    (typeof r.rel === "string" ? r.rel : "");
  return pred;
}

/** @param {unknown} row */
function rowWorkflowActual(row) {
  const r = rowRecord(row);
  if (!r) return "";
  const pc = r.place_card && typeof r.place_card === "object" ? /** @type {Record<string, unknown>} */ (r.place_card) : null;
  const dest =
    (typeof r.moved_to === "string" ? r.moved_to : "") ||
    (typeof r.proposed_destination === "string" ? r.proposed_destination : "") ||
    (pc && pc.proposed_destination != null ? String(pc.proposed_destination) : "");
  return dest;
}

/**
 * Same workflow comparison as Session Report (user expectations vs row-derived fallback).
 * @param {string[]} expectedItems
 * @param {unknown[]} results
 * @returns {{
 *   matched: Array<{ expected: unknown, actual: unknown }>,
 *   missing: Array<{ expected: unknown }>,
 *   conflicting: Array<{ expected: unknown, actual: unknown }>,
 *   uncertain: Array<{ expected: unknown, actual?: unknown }>,
 * }}
 */
export function compareSessionWorkflow(expectedItems, results) {
  const list = Array.isArray(results) ? results : [];
  const hasRows = list.length > 0;
  const userExpected = Array.isArray(expectedItems)
    ? expectedItems.filter((s) => typeof s === "string" && s.trim().length > 0)
    : [];
  const rowExpected = hasRows ? list.map((r) => rowWorkflowExpected(r)) : [];
  const expected = userExpected.length > 0 ? userExpected : rowExpected;
  const actual = hasRows ? list.map((r) => rowWorkflowActual(r)) : [];
  const runWorkflow = userExpected.length > 0 || hasRows;
  return runWorkflow
    ? compareWorkflow(expected, actual)
    : { matched: [], missing: [], conflicting: [], uncertain: [] };
}

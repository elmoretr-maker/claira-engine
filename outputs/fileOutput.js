/**
 * Filesystem export for pipeline / adapter result rows.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";

/**
 * @param {unknown} r
 * @returns {boolean}
 */
function isMovedRow(r) {
  return r != null && typeof r === "object" && "moved_to" in r && r.moved_to != null;
}

/**
 * Aligns with review-queue style rows (and move failures / adapter errors).
 * @param {unknown} item
 * @returns {boolean}
 */
function isReviewRow(item) {
  if (item == null || typeof item !== "object") return false;
  const r = /** @type {Record<string, unknown>} */ (item);
  if (r.room_validation != null) return true;
  if (r.priority != null) return true;
  if (typeof r.move_error === "string" && r.move_error.length) return true;
  if (typeof r.error === "string" && r.error.length) return true;
  const pc = r.place_card;
  if (pc && typeof pc === "object") {
    const decReason = String(/** @type {Record<string, unknown>} */ (pc).reason ?? "");
    if (decReason === "rejected_by_room") return true;
  }
  return false;
}

/**
 * @param {unknown} results
 * @param {{ cwd?: string, split?: boolean }} [options]
 * @returns {{ ok: true, resultsPath: string, movedPath?: string, reviewPath?: string, split: boolean }}
 */
export function exportToFile(results, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const split = options.split === true;
  const outDir = resolve(cwd, "output");
  mkdirSync(outDir, { recursive: true });

  const arr = Array.isArray(results) ? results : [];
  const resultsPath = join(outDir, "results.json");
  writeFileSync(resultsPath, JSON.stringify(arr, null, 2), "utf8");

  /** @type {{ ok: true, resultsPath: string, movedPath?: string, reviewPath?: string, split: boolean }} */
  const out = { ok: true, resultsPath, split };

  if (split) {
    const moved = arr.filter(isMovedRow);
    const review = arr.filter(isReviewRow);
    out.movedPath = join(outDir, "moved.json");
    out.reviewPath = join(outDir, "review.json");
    writeFileSync(out.movedPath, JSON.stringify(moved, null, 2), "utf8");
    writeFileSync(out.reviewPath, JSON.stringify(review, null, 2), "utf8");
  }

  return out;
}

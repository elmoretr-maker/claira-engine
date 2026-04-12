/**
 * Pattern detection on exemption logs — rule candidates only; no writes, no routing changes.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXEMPTIONS_PATH = join(__dirname, "exemptions.json");

function loadExemptions() {
  try {
    const raw = readFileSync(EXEMPTIONS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.exemptions)) return parsed.exemptions;
  } catch {
    /* missing or invalid */
  }
  return [];
}

/**
 * Returns exemption pairs that occurred at least `threshold` times (candidates for formal rules).
 * Sorted by `count` descending. Read-only.
 *
 * @param {number} [threshold=3]
 * @returns {Array<{ predicted: string, selected: string, count: number, lastUsed: string }>}
 */
export function getExemptionPatterns(threshold = 3) {
  const t = Number(threshold);
  const min = Number.isFinite(t) && t > 0 ? t : 3;

  const rows = loadExemptions()
    .map((e) => ({
      predicted: String(e?.predicted ?? "").trim(),
      selected: String(e?.selected ?? "").trim(),
      count: Number(e?.count ?? 0),
      lastUsed: typeof e?.lastUsed === "string" ? e.lastUsed : "",
    }))
    .filter((e) => e.predicted && e.selected && e.count >= min)
    .sort((a, b) => b.count - a.count);

  return rows;
}

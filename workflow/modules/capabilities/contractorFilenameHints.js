/**
 * Contractor-oriented hints from path + basename (no fitness/tax leakage).
 */

import { basenameFromPath } from "./taxFilenameHints.js";

/**
 * @param {string} s
 */
function slug(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

/**
 * Infer project, room, and timeline stage from `Projects/{Project}/Rooms/{Room}/Timeline/{Stage}/...` or basename tokens.
 * @param {string} rawPath — absolute or relative path
 * @returns {{ projectSlug: string, roomSlug: string, stageSlug: string }}
 */
export function extractContractorHintsFromPaths(rawPath) {
  const norm = String(rawPath ?? "").replace(/\\/g, "/").trim();
  const parts = norm.toLowerCase().split("/").filter((p) => p.length > 0);

  let projectSlug = "project";
  let roomSlug = "room";
  let stageSlug = "stage";

  const pi = parts.indexOf("projects");
  if (pi >= 0 && parts[pi + 1]) projectSlug = slug(parts[pi + 1]) || projectSlug;
  const ri = parts.indexOf("rooms");
  if (ri >= 0 && parts[ri + 1]) roomSlug = slug(parts[ri + 1]) || roomSlug;
  const ti = parts.indexOf("timeline");
  if (ti >= 0 && parts[ti + 1]) stageSlug = slug(parts[ti + 1]) || stageSlug;

  const base = basenameFromPath(norm);
  const stem = base.replace(/\.[^.]+$/i, "");
  const tokens = stem
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);

  if (pi < 0 && ri < 0 && ti < 0 && tokens.length >= 3) {
    projectSlug = slug(tokens[0]) || projectSlug;
    roomSlug = slug(tokens[1]) || roomSlug;
    stageSlug = slug(tokens[2]) || stageSlug;
  } else if (pi < 0 && ri < 0 && ti < 0 && tokens.length === 2) {
    projectSlug = slug(tokens[0]) || projectSlug;
    roomSlug = slug(tokens[1]) || roomSlug;
  }

  return { projectSlug, roomSlug, stageSlug };
}

export { basenameFromPath };

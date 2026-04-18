/**
 * Fitness-oriented hints from path + basename (no tax field maps).
 */

import { basenameFromPath, fileExtensionFromPath } from "./taxFilenameHints.js";

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

const VIEW_WORDS = ["front", "side", "back", "rear", "three_quarter", "threequarter", "3_4", "34"];

/**
 * Infer client, stage, and body_view from full file path (folder context) and basename tokens.
 * @param {string} rawPath — absolute or relative path
 * @returns {{ clientSlug: string, stageSlug: string, bodyView: string }}
 */
export function extractFitnessHintsFromPaths(rawPath) {
  const norm = String(rawPath ?? "").replace(/\\/g, "/").trim();
  const base = basenameFromPath(norm);
  const stem = base.replace(/\.[^.]+$/i, "");
  const tokens = stem
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);

  let clientSlug = "client";
  let stageSlug = "stage";
  const lowerParts = norm.toLowerCase()
    .split("/")
    .filter((p) => p.length > 0);
  const ti = lowerParts.indexOf("timeline");
  const ci = lowerParts.indexOf("clients");
  if (ci >= 0 && lowerParts[ci + 1]) clientSlug = slug(lowerParts[ci + 1]) || clientSlug;
  if (ti >= 0 && lowerParts[ti + 1]) stageSlug = slug(lowerParts[ti + 1]) || stageSlug;
  if (ti < 0 && ci < 0 && tokens.length >= 3) {
    clientSlug = slug(tokens[0]) || clientSlug;
    stageSlug = slug(tokens[1]) || stageSlug;
  } else if (ti < 0 && ci < 0 && tokens.length === 2) {
    clientSlug = slug(tokens[0]) || clientSlug;
    stageSlug = slug(tokens[1]) || stageSlug;
  }

  /** @type {string} */
  let bodyView = "front";
  for (const t of tokens) {
    if (VIEW_WORDS.includes(t)) {
      if (t === "rear") bodyView = "back";
      else if (t === "three_quarter" || t === "threequarter" || t === "3_4" || t === "34") bodyView = "three_quarter";
      else bodyView = t;
      break;
    }
  }

  return { clientSlug, stageSlug, bodyView };
}

export { basenameFromPath, fileExtensionFromPath };

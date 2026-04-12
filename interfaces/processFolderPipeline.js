/**
 * Shared process-folder pipeline (no console). Used by interfaces/api.js and cli/claira.mjs.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { readdir, stat } from "fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import {
  analyze,
  generatePlaceCard,
  generateSessionReport,
  resetSessionLedger,
} from "../index.js";
import { getImageEmbedding } from "../vision/clipEmbedder.js";
import { loadRooms } from "../rooms/index.js";
import { validatePlacement } from "../rooms/validator.js";
import { assignPriority } from "./reviewQueue.js";
import { isSupportedImageFilename } from "../adapters/supportedImages.js";
import {
  analyzeTextAgainstLabel,
  detectInsights,
  suggestDestinationFromText,
  suggestLabelFromText,
} from "../core/textAnalysis.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REF_EMBEDDINGS_JSON = join(__dirname, "..", "references", "reference_embeddings.json");

/**
 * @param {unknown} obj
 * @returns {Map<string, Float32Array[]>}
 */
function parseReferenceEmbeddingsByLabel(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("references: expected object of label → vectors");
  }
  const m = new Map();
  for (const [label, val] of Object.entries(obj)) {
    if (!Array.isArray(val) || val.length === 0) continue;
    if (typeof val[0] === "number") {
      m.set(label, [new Float32Array(/** @type {number[]} */ (val))]);
    } else {
      const vecs = val.map((row) => {
        if (!Array.isArray(row)) throw new Error(`references.${label}: expected number[][]`);
        return new Float32Array(row);
      });
      m.set(label, vecs);
    }
  }
  if (m.size === 0) throw new Error("references: no label pools found");
  return m;
}

function loadProcessFolderReferenceEmbeddings() {
  if (!existsSync(REF_EMBEDDINGS_JSON)) {
    throw new Error(
      "process-folder: missing references/reference_embeddings.json — add PNGs to references/<category>/ and run: node vision/buildReferences.js",
    );
  }
  const raw = readFileSync(REF_EMBEDDINGS_JSON, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`process-folder: invalid references/reference_embeddings.json (${msg})`);
  }
  try {
    return parseReferenceEmbeddingsByLabel(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `process-folder: ${msg}. Add PNGs under references/terrain|prop|debris/, then run: node vision/buildReferences.js`,
    );
  }
}

async function collectRasterImageFilesRecursive(rootDir) {
  /** @type {string[]} */
  const out = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const full = join(current, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && isSupportedImageFilename(e.name)) out.push(full);
    }
  }
  await walk(rootDir);
  return out.sort();
}

function displayRelative(inputRootResolved, absolutePath) {
  return relative(inputRootResolved, absolutePath).replace(/\\/g, "/");
}

function normalizePathForCompare(p) {
  if (p == null || p === "") return null;
  return String(p)
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "");
}

function findRoomByDestination(rooms, proposedDestination) {
  const n = normalizePathForCompare(proposedDestination);
  if (!n) return null;
  for (const room of Object.values(rooms)) {
    if (normalizePathForCompare(room?.config?.destination) === n) return room;
  }
  return null;
}

function uniqueDestPath(destDir, fileName) {
  const ext = extname(fileName);
  const base = basename(fileName, ext);
  let candidate = join(destDir, fileName);
  if (!existsSync(candidate)) return candidate;
  let n = 1;
  while (n < 100000) {
    candidate = join(destDir, `${base}_${n}${ext}`);
    if (!existsSync(candidate)) return candidate;
    n += 1;
  }
  throw new Error("uniqueDestPath: could not allocate filename");
}

function bumpPriorityCount(counts, p) {
  if (p === "high") counts.high += 1;
  else if (p === "medium") counts.medium += 1;
  else counts.low += 1;
}

/**
 * @typedef {{ skip: true, row: Record<string, unknown> } | { skip: false, absPath: string, rel: string, extractedText?: string }} ProcessPipelineItem
 */

/**
 * @param {ProcessPipelineItem & { skip?: false }} item
 * @param {{ classification?: { predicted_label?: string | null } | null, decision?: { decision?: string } | null }} result
 * @returns {{
 *   text_analysis?: object,
 *   text_mismatch?: boolean,
 *   text_label_suggestion?: { suggested_label: string, matches_prediction: boolean },
 *   text_label_conflict?: boolean,
 *   text_insights?: { insights: string[] },
 *   text_insight_flag?: boolean,
 * }}
 */
function textAwareParts(item, result) {
  if (typeof item.extractedText !== "string" || !item.extractedText.trim()) {
    return {};
  }

  /** @type {{ text_analysis?: object, text_mismatch?: boolean, text_label_suggestion?: { suggested_label: string, matches_prediction: boolean }, text_label_conflict?: boolean, text_insights?: { insights: string[] }, text_insight_flag?: boolean }} */
  const out = {};

  const ta = analyzeTextAgainstLabel(item.extractedText, result.classification?.predicted_label);
  if (ta) {
    out.text_analysis = ta;
    if (!ta.matches && result.decision?.decision === "auto") {
      out.text_mismatch = true;
    }
  }

  const suggested = suggestLabelFromText(item.extractedText);
  if (suggested != null) {
    const norm = (s) => String(s ?? "").trim().toLowerCase();
    const matches_prediction = norm(suggested) === norm(result.classification?.predicted_label);
    if (!matches_prediction) {
      out.text_label_suggestion = { suggested_label: suggested, matches_prediction: false };
      if (result.decision?.decision === "auto") {
        out.text_label_conflict = true;
      }
    }
  }

  const { insights } = detectInsights(item.extractedText);
  if (insights.length > 0) {
    out.text_insights = { insights: [...insights] };
    if (result.decision?.decision === "auto") {
      out.text_insight_flag = true;
    }
  }

  return out;
}

/**
 * After routing (place card): OCR destination hints vs proposed_destination only.
 * @param {ProcessPipelineItem & { skip?: false }} item
 * @param {{ proposed_destination?: string | null } | null | undefined} placeCard
 * @param {string | undefined} dec
 * @returns {{
 *   text_destination_suggestion?: { suggested_destination: string, matches_routing: boolean },
 *   text_routing_conflict?: boolean,
 * }}
 */
function textRoutingAwareParts(item, placeCard, dec) {
  if (typeof item.extractedText !== "string" || !item.extractedText.trim()) {
    return {};
  }

  const suggestedDest = suggestDestinationFromText(item.extractedText);
  if (suggestedDest == null) return {};

  const proposedRaw =
    placeCard?.proposed_destination != null ? String(placeCard.proposed_destination).trim() : "";
  const nProposed = normalizePathForCompare(proposedRaw);
  const nSuggested = normalizePathForCompare(suggestedDest);
  const matches_routing =
    nProposed != null &&
    nSuggested != null &&
    nProposed.toLowerCase() === nSuggested.toLowerCase();

  /** @type {{ text_destination_suggestion?: { suggested_destination: string, matches_routing: boolean }, text_routing_conflict?: boolean }} */
  const out = {};
  if (!matches_routing) {
    out.text_destination_suggestion = {
      suggested_destination: suggestedDest,
      matches_routing: false,
    };
    if (dec === "auto") {
      out.text_routing_conflict = true;
    }
  }

  return out;
}

/**
 * Waiting-room flags for text mismatch (only when nothing else already sent the row to review).
 * @param {{ text_mismatch?: boolean }} parts
 * @returns {Record<string, unknown>}
 */
function textMismatchReviewFields(parts) {
  if (parts.text_mismatch !== true) return {};
  return {
    text_mismatch: true,
    reason: "text_mismatch",
    priority: assignPriority({ reason: "text_mismatch" }).priority,
  };
}

/**
 * @param {{ text_label_conflict?: boolean }} parts
 * @returns {Record<string, unknown>}
 */
function textLabelConflictReviewFields(parts) {
  if (parts.text_label_conflict !== true) return {};
  return {
    reason: "text_label_conflict",
    priority: assignPriority({ reason: "text_label_conflict" }).priority,
  };
}

/**
 * @param {{ text_routing_conflict?: boolean }} parts
 * @returns {Record<string, unknown>}
 */
function textRoutingConflictReviewFields(parts) {
  if (parts.text_routing_conflict !== true) return {};
  return {
    reason: "text_routing_conflict",
    priority: assignPriority({ reason: "text_routing_conflict" }).priority,
  };
}

/**
 * @param {{ text_insight_flag?: boolean }} parts
 * @returns {Record<string, unknown>}
 */
function textInsightReviewFields(parts) {
  if (parts.text_insight_flag !== true) return {};
  return {
    reason: "text_insight_flag",
    priority: assignPriority({ reason: "text_insight_flag" }).priority,
  };
}

/**
 * @param {Record<string, unknown>} parts — merged text + routing text fields
 * @returns {Record<string, unknown>}
 */
function textReviewFieldsForAutoPath(parts) {
  /** @type {Record<string, unknown>} */
  const merged = { ...textMismatchReviewFields(parts) };
  if (!merged.reason) {
    Object.assign(merged, textLabelConflictReviewFields(parts));
  }
  if (!merged.reason) {
    Object.assign(merged, textRoutingConflictReviewFields(parts));
  }
  if (!merged.reason) {
    Object.assign(merged, textInsightReviewFields(parts));
  }
  return merged;
}

/**
 * Run the same classify / route / validate / move pipeline as process-folder for a prepared item list.
 * @param {ProcessPipelineItem[]} items
 * @param {{ cwd?: string }} [options]
 */
export async function runProcessItemsPipeline(items, options = {}) {
  const cwd = options.cwd ?? process.cwd();

  resetSessionLedger();

  const rooms = loadRooms();
  const referenceEmbeddingsByLabel = loadProcessFolderReferenceEmbeddings();
  /** @type {Array<Record<string, unknown>>} */
  const resultsArray = [];
  const reviewPriorityCounts = { high: 0, medium: 0, low: 0 };

  let movedCount = 0;
  let reviewCount = 0;

  for (const item of items) {
    if (item.skip) {
      resultsArray.push(item.row);
      continue;
    }
    const { absPath, rel } = item;
    const embRes = await getImageEmbedding(absPath);
    if (embRes.error) {
      resultsArray.push({ rel, place_card: null, error: "embedding_failed" });
      continue;
    }
    const inputEmbedding = new Float32Array(embRes.embedding);
    const result = await analyze({
      inputEmbedding,
      referenceEmbeddingsByLabel,
      file: absPath,
    });

    if (result.error) {
      const reason = String(result.error);
      const { priority } = assignPriority({ reason });
      bumpPriorityCount(reviewPriorityCounts, priority);
      reviewCount += 1;
      resultsArray.push({ rel, place_card: null, priority, reason });
      continue;
    }

    const textParts = textAwareParts(item, result);

    const { placeCard } = await generatePlaceCard(result);
    const dec = result.decision?.decision;
    Object.assign(textParts, textRoutingAwareParts(item, placeCard, dec));

    let roomValidation = null;
    let rejectedByRoom = false;
    /** @type {{ config: object, referencePath: string } | null} */
    let matchedRoom = null;
    if (dec === "auto" && placeCard?.proposed_destination) {
      matchedRoom = findRoomByDestination(rooms, placeCard.proposed_destination);
      if (matchedRoom) {
        const label =
          result.routing?.routing_label ?? result.classification?.predicted_label ?? "";
        roomValidation = await validatePlacement(label, inputEmbedding, matchedRoom);
        if (!roomValidation.accepted) {
          rejectedByRoom = true;
        }
      }
    }

    if (rejectedByRoom && roomValidation) {
      const { priority } = assignPriority({ reason: "rejected_by_room" });
      bumpPriorityCount(reviewPriorityCounts, priority);
      reviewCount += 1;
      resultsArray.push({
        rel,
        place_card: placeCard ?? null,
        priority,
        room_validation: roomValidation,
        ...textParts,
      });
    } else if (dec === "auto") {
      /** @type {string | null} */
      let movedTo = null;
      /** @type {string | null} */
      let moveError = null;
      if (matchedRoom && roomValidation?.accepted && matchedRoom.config?.destination != null) {
        try {
          const destRoot = resolve(cwd, String(matchedRoom.config.destination));
          mkdirSync(destRoot, { recursive: true });
          const fileName = basename(absPath);
          const destPath = uniqueDestPath(destRoot, fileName);
          renameSync(absPath, destPath);
          movedTo = destPath;
          movedCount += 1;
        } catch (e) {
          moveError = e instanceof Error ? e.message : String(e);
        }
      }
      /** @type {Record<string, unknown>} */
      const textReview = textReviewFieldsForAutoPath(textParts);
      const okRow = { rel, place_card: placeCard ?? null, ...textParts, ...textReview };
      if (movedTo != null) okRow.moved_to = movedTo;
      if (moveError != null) okRow.move_error = moveError;
      if (textReview.priority != null) {
        bumpPriorityCount(
          reviewPriorityCounts,
          /** @type {"high"|"medium"|"low"} */ (textReview.priority),
        );
      }
      resultsArray.push(okRow);
    } else {
      const reason = placeCard?.reason ?? result.decision?.reason ?? "review";
      const { priority } = assignPriority({ reason: String(reason) });
      bumpPriorityCount(reviewPriorityCounts, priority);
      reviewCount += 1;
      resultsArray.push({ rel, place_card: placeCard ?? null, priority, reason, ...textParts });
    }
  }

  const outDir = resolve(cwd, "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "results.json");
  writeFileSync(outPath, JSON.stringify(resultsArray, null, 2), "utf8");

  generateSessionReport();

  const processed = items.filter((i) => !i.skip).length;

  return {
    processed,
    moved: movedCount,
    review: reviewCount,
    results: resultsArray,
    reviewPriorityCounts,
  };
}

/**
 * @param {string} inputRootAbsolute — resolved absolute path to folder
 * @param {{ cwd?: string }} [options]
 */
export async function runProcessFolderPipeline(inputRootAbsolute, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const inputRoot = resolve(inputRootAbsolute);

  try {
    const st = await stat(inputRoot);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`process-folder: cannot read folder ${inputRoot}`);
  }

  const imageFiles = await collectRasterImageFilesRecursive(inputRoot);
  /** @type {ProcessPipelineItem[]} */
  const items = imageFiles.map((absPath) => ({
    skip: false,
    absPath,
    rel: displayRelative(inputRoot, absPath),
  }));
  return runProcessItemsPipeline(items, { cwd });
}

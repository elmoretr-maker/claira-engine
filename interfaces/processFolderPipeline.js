/**
 * Shared process-folder pipeline (no console). Used by interfaces/api.js and cli/claira.mjs.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from "fs";
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
import { buildClassificationConflictPayload } from "../core/oversightProfile.js";
import { loadAllReferenceEmbeddings } from "./referenceLoader.js";
import { loadRooms } from "../rooms/index.js";
import { validatePlacement } from "../rooms/validator.js";
import { persistReferenceLearning } from "../learning/addUserReference.js";
import { assignPriority } from "./reviewQueue.js";
import { isSupportedImageFilename } from "../adapters/supportedImages.js";
import {
  analyzeTextAgainstLabel,
  detectInsights,
  suggestDestinationFromText,
  suggestLabelFromText,
} from "../core/textAnalysis.js";
import { cleanupTunnelStagingCategoryDir } from "./tunnelStaging.js";
import {
  applyUserControlAfterDecision,
  appendBypassReviewLogEntry,
} from "../policies/userControl.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

/**
 * @param {unknown} raw
 */
function normalizeExpectedCategory(raw) {
  if (typeof raw !== "string") return "";
  return String(raw).trim().toLowerCase();
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
 * @param {{ cwd?: string, runtimeContext?: {
 *   appMode?: string,
 *   oversightLevel?: string,
 *   expectedCategory?: string,
 *   autoMove?: boolean,
 *   strictValidation?: boolean,
 *   reviewThreshold?: number,
 * } }} [options]
 */
export async function runProcessItemsPipeline(items, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const runtimeContext = options.runtimeContext ?? {};
  const autoMove = runtimeContext.autoMove !== false;
  const roomStrict = runtimeContext.strictValidation === true;

  resetSessionLedger();

  const rooms = loadRooms();
  const referenceEmbeddingsByLabel = await loadAllReferenceEmbeddings();
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
      resultsArray.push({ rel, filePath: absPath, place_card: null, error: "embedding_failed" });
      continue;
    }
    const inputEmbedding = new Float32Array(embRes.embedding);
    let result = await analyze({
      inputEmbedding,
      referenceEmbeddingsByLabel,
      file: absPath,
      extractedText: item.extractedText,
      runtimeContext,
    });

    if (result.error) {
      const reason = String(result.error);
      const { priority } = assignPriority({ reason });
      bumpPriorityCount(reviewPriorityCounts, priority);
      reviewCount += 1;
      resultsArray.push({ rel, filePath: absPath, place_card: null, priority, reason });
      continue;
    }

    const expectedCat = normalizeExpectedCategory(runtimeContext.expectedCategory);
    if (expectedCat) {
      const predicted = normalizeExpectedCategory(result.classification?.predicted_label);
      if (!predicted || predicted === "unknown" || predicted !== expectedCat) {
        result = {
          ...result,
          decision: { decision: "review", reason: "tunnel_expected_category_mismatch" },
        };
      }
    }

    applyUserControlAfterDecision(result);

    const textParts = textAwareParts(item, result);

    const { placeCard } = await generatePlaceCard(result, { autoMove });
    const dec = result.decision?.decision;
    const bypassAuto =
      dec === "review" &&
      result.execution?.user_override === "bypass_review" &&
      result.execution?.execution_intent === "auto";
    const treatAsAutoPath = dec === "auto" || bypassAuto;
    const decForText = treatAsAutoPath ? "auto" : dec;
    Object.assign(textParts, textRoutingAwareParts(item, placeCard, decForText));

    let roomValidation = null;
    let rejectedByRoom = false;
    /** @type {{ config: object, referencePath: string } | null} */
    let matchedRoom = null;
    if (treatAsAutoPath && placeCard?.proposed_destination) {
      matchedRoom = findRoomByDestination(rooms, placeCard.proposed_destination);
      if (matchedRoom) {
        const label =
          result.routing?.routing_label ?? result.classification?.predicted_label ?? "";
        roomValidation = await validatePlacement(label, inputEmbedding, matchedRoom, {
          strictValidation: roomStrict,
        });
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
        filePath: absPath,
        place_card: placeCard ?? null,
        priority,
        room_validation: roomValidation,
        ...textParts,
      });
    } else if (treatAsAutoPath) {
      if (bypassAuto) {
        appendBypassReviewLogEntry({
          original_decision: "review",
          user_override: "bypass_review",
          predicted_label: String(result.classification?.predicted_label ?? ""),
          destination: String(result.routing?.proposed_destination ?? ""),
          timestamp: Date.now(),
        });
      }
      /** @type {Record<string, unknown> | undefined} */
      let reference_learning;
      if (expectedCat) {
        const pred = normalizeExpectedCategory(result.classification?.predicted_label);
        if (pred === expectedCat) {
          const lr = persistReferenceLearning(absPath, expectedCat);
          reference_learning = { ...lr };
          if (!lr.ok) {
            console.error(`[learning] expectedCategory auto-learn failed: ${lr.reason} (${rel})`);
          } else if (lr.skipped) {
            console.log(`[learning] expectedCategory auto-learn deduped: ${lr.reason} (${rel})`);
          }
        }
      }
      /** @type {string | null} */
      let movedTo = null;
      /** @type {string | null} */
      let moveError = null;
      if (
        autoMove &&
        matchedRoom &&
        roomValidation?.accepted &&
        matchedRoom.config?.destination != null
      ) {
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
      const finalPath = movedTo ?? absPath;
      /** @type {Record<string, unknown>} */
      const okRow = {
        rel,
        filePath: finalPath,
        place_card: placeCard ?? null,
        ...textParts,
        ...textReview,
      };
      if (movedTo != null) okRow.moved_to = movedTo;
      if (moveError != null) okRow.move_error = moveError;
      if (reference_learning != null) okRow.reference_learning = reference_learning;
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
      /** @type {Record<string, unknown>} */
      const reviewRow = { rel, filePath: absPath, place_card: placeCard ?? null, priority, reason, ...textParts };
      const cc = buildClassificationConflictPayload(result, absPath, runtimeContext);
      if (cc) reviewRow.classification_conflict = cc;
      resultsArray.push(reviewRow);
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
 * @param {{ cwd?: string, runtimeContext?: {
 *   appMode?: string,
 *   oversightLevel?: string,
 *   expectedCategory?: string,
 *   autoMove?: boolean,
 *   strictValidation?: boolean,
 *   reviewThreshold?: number,
 * } }} [options]
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
  try {
    return await runProcessItemsPipeline(items, { cwd, runtimeContext: options.runtimeContext });
  } finally {
    cleanupTunnelStagingCategoryDir(inputRoot);
  }
}

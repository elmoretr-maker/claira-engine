/**
 * Unified programmatic API for Claira Engine (no console output).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { extname, join, resolve } from "path";
import { getAdapter, normalizeInput } from "../adapters/index.js";
import { sendOutput } from "../outputs/index.js";
import { generateSessionReport } from "./sessionLedger.js";
import { generateSuggestions } from "./suggestionEngine.js";
import { assignPriority } from "./reviewQueue.js";
import { captureUserDecision } from "./decisionCapture.js";
import { loadRooms } from "../rooms/index.js";
import { runProcessFolderPipeline, runProcessItemsPipeline } from "./processFolderPipeline.js";

/**
 * @param {string} inputPath — folder path (relative to cwd or absolute)
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<{
 *   processed: number,
 *   moved: number,
 *   review: number,
 *   results: unknown[],
 *   reviewPriorityCounts: { high: number, medium: number, low: number }
 * }>}
 */
export async function processFolder(inputPath, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const abs = resolve(cwd, inputPath);
  const out = await runProcessFolderPipeline(abs, { cwd });
  return {
    processed: out.processed,
    moved: out.moved,
    review: out.review,
    results: out.results,
    reviewPriorityCounts: out.reviewPriorityCounts,
  };
}

/**
 * @returns {{ rooms: Array<{ name: string, destination: string, config: object }> }}
 */
export function getRooms() {
  const loaded = loadRooms();
  const rooms = Object.values(loaded).map((r) => ({
    name: String(r.config?.name ?? ""),
    destination: String(r.config?.destination ?? ""),
    config: r.config,
  }));
  return { rooms };
}

function reviewReasonForItem(item) {
  if (item.room_validation != null) return "rejected_by_room";
  if (typeof item.reason === "string" && item.reason.length) return item.reason;
  const pc = item.place_card;
  if (pc && typeof pc === "object" && pc.reason != null) return String(pc.reason);
  return "review";
}

function isReviewQueueItem(item) {
  if (item == null || typeof item !== "object") return false;
  if (item.room_validation != null) return true;
  if (item.text_mismatch === true) return true;
  if (item.text_label_conflict === true) return true;
  if (item.text_routing_conflict === true) return true;
  if (item.text_insight_flag === true) return true;
  if (item.priority != null) return true;
  if (item.error === "embedding_failed") return true;
  const pc = item.place_card;
  if (!pc) return false;
  const decReason = String(pc.reason ?? "");
  if (decReason === "rejected_by_room") return true;
  return false;
}

/**
 * @param {{ cwd?: string }} [options]
 * @returns {{
 *   high: unknown[],
 *   medium: unknown[],
 *   low: unknown[]
 * }}
 */
export function getReviewQueue(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const path = join(cwd, "output", "results.json");
  if (!existsSync(path)) {
    return { high: [], medium: [], low: [] };
  }
  let rows;
  try {
    rows = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { high: [], medium: [], low: [] };
  }
  if (!Array.isArray(rows)) return { high: [], medium: [], low: [] };

  const high = [];
  const medium = [];
  const low = [];

  for (const item of rows) {
    if (!isReviewQueueItem(item)) continue;
    const reason = reviewReasonForItem(item);
    const { priority } = assignPriority({ reason });
    const enriched = { ...item, priority, review_reason: reason };

    if (priority === "high") high.push(enriched);
    else if (priority === "medium") medium.push(enriched);
    else low.push(enriched);
  }

  return { high, medium, low };
}

/**
 * @param {{
 *   file?: string | null,
 *   selected_room: string,
 *   decision_type: "learning" | "express_pass" | "exemption",
 *   predicted_label?: string | null,
 *   confidence?: number
 * }} payload
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function submitDecision(payload) {
  return captureUserDecision(payload);
}

/**
 * @returns {ReturnType<typeof generateSessionReport>}
 */
export function getSessionSummary() {
  return generateSessionReport();
}

/**
 * @returns {ReturnType<typeof generateSuggestions>}
 */
export function getSuggestions() {
  return generateSuggestions();
}

/**
 * Export result rows to a configured target (filesystem or simulated external).
 * @param {{
 *   target: string,
 *   results: unknown,
 *   cwd?: string,
 *   split?: boolean,
 *   externalTarget?: string
 * }} payload
 * @returns {{ ok: true, target: string } & Record<string, unknown> | { ok: false, target?: string, error: string }}
 */
export function exportData(payload = {}) {
  const target = payload?.target;
  const results = payload?.results;
  const cwd = payload?.cwd;
  const split = payload?.split;
  const externalTarget = payload?.externalTarget;

  try {
    const status = sendOutput({
      target,
      results,
      cwd,
      split,
      externalTarget,
    });
    return { ok: true, target: String(target ?? ""), ...status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, target: target != null ? String(target) : undefined, error: msg };
  }
}

/**
 * @param {string} url
 * @param {string} destDir
 * @param {number} index
 * @returns {Promise<string>} absolute path to written file
 */
async function fetchUrlToTempFile(url, destDir, index) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const lower = url.toLowerCase();
  const ext = lower.includes(".png")
    ? ".png"
    : lower.includes(".webp")
      ? ".webp"
      : lower.includes(".jpg") || lower.includes(".jpeg")
        ? ".jpg"
        : "";
  const name = `url_${index}${ext || ".bin"}`;
  const p = join(destDir, name);
  writeFileSync(p, buf);
  return p;
}

/**
 * @param {{ source: string, input?: unknown, ocr?: boolean }} args — `ocr: true` runs OCR for source `"file"` only (default off)
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<{ source: string, items: unknown[] }>}
 */
export async function ingestData(args, options = {}) {
  const source = args?.source;
  const input = args?.input;
  const cwd = options.cwd ?? process.cwd();
  const s = String(source ?? "").toLowerCase();

  if (s === "file") {
    if (typeof input !== "string" || !input.length) {
      throw new Error('ingestData: source "file" requires input (folder path string)');
    }
    const { ingestFiles } = getAdapter("file");
    const ocr = args?.ocr === true;
    const items = await ingestFiles(input, { cwd, ocr });
    return { source: "file", items };
  }

  if (s === "document") {
    if (typeof input !== "string" || !input.length) {
      throw new Error('ingestData: source "document" requires input (folder path string)');
    }
    const { ingestDocuments } = getAdapter("document");
    const items = await ingestDocuments(input, { cwd });
    return { source: "document", items };
  }

  if (s === "external") {
    const { fetchExternalData } = getAdapter("external");
    const items = await fetchExternalData();
    return { source: "external", items };
  }

  getAdapter(String(source));
  throw new Error("ingestData: unreachable");
}

/**
 * Run the process-folder pipeline on normalized adapter items (images only; other types yield skip rows).
 * @param {unknown[]} normalizedData
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<{
 *   processed: number,
 *   moved: number,
 *   review: number,
 *   results: unknown[],
 *   reviewPriorityCounts: { high: number, medium: number, low: number }
 * }>}
 */
export async function processData(normalizedData, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  if (!Array.isArray(normalizedData)) {
    throw new Error("processData: expected array of normalized inputs");
  }

  const tmpBase = mkdtempSync(join(tmpdir(), "claira-adapter-"));
  let urlIndex = 0;

  /** @type {import("./processFolderPipeline.js").ProcessPipelineItem[]} */
  const pipelineItems = [];

  try {
    for (let i = 0; i < normalizedData.length; i++) {
      const norm = normalizeInput(normalizedData[i]);
      const rel = norm.metadata.originalName;

      if (norm.type !== "image") {
        pipelineItems.push({
          skip: true,
          row: { rel, error: "unsupported_type", item_type: norm.type },
        });
        continue;
      }

      if (norm.data.filePath) {
        const absPath = resolve(cwd, norm.data.filePath);
        const pi =
          typeof norm.metadata.extractedText === "string" && norm.metadata.extractedText.length
            ? { skip: false, absPath, rel, extractedText: norm.metadata.extractedText }
            : { skip: false, absPath, rel };
        pipelineItems.push(pi);
        continue;
      }

      if (norm.data.buffer) {
        const buf = Buffer.isBuffer(norm.data.buffer)
          ? norm.data.buffer
          : Buffer.from(/** @type {Uint8Array} */ (norm.data.buffer));
        const ext = extname(norm.metadata.originalName);
        const safeExt = ext && ext.length <= 8 ? ext : ".png";
        const name = `buffer_${i}${safeExt}`.replace(/[^a-zA-Z0-9._-]/g, "_");
        const p = join(tmpBase, name || `buffer_${i}.png`);
        writeFileSync(p, buf);
        const pi =
          typeof norm.metadata.extractedText === "string" && norm.metadata.extractedText.length
            ? { skip: false, absPath: p, rel, extractedText: norm.metadata.extractedText }
            : { skip: false, absPath: p, rel };
        pipelineItems.push(pi);
        continue;
      }

      if (norm.data.url) {
        try {
          const absPath = await fetchUrlToTempFile(norm.data.url, tmpBase, urlIndex++);
          const pi =
            typeof norm.metadata.extractedText === "string" && norm.metadata.extractedText.length
              ? { skip: false, absPath, rel, extractedText: norm.metadata.extractedText }
              : { skip: false, absPath, rel };
          pipelineItems.push(pi);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          pipelineItems.push({
            skip: true,
            row: { rel, error: "ingest_fetch_failed", message: msg },
          });
        }
        continue;
      }

      pipelineItems.push({
        skip: true,
        row: { rel, error: "no_usable_input" },
      });
    }

    return await runProcessItemsPipeline(pipelineItems, { cwd });
  } finally {
    try {
      rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

#!/usr/bin/env node
/**
 * Claira Engine — Stage 4 CLI (wraps index.js; no core logic here).
 * Usage: node cli/claira.mjs <command> [options]
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  analyze,
  applyDecision,
  classify,
  generatePlaceCard,
  generateSessionReport,
  getLearningStats,
  getSuggestions,
  resetSessionLedger,
} from "../index.js";
import { getImageEmbedding } from "../vision/clipEmbedder.js";
import { processFolder, getSessionSummary } from "../interfaces/api.js";
import { parseReferenceEmbeddingsFromJson } from "../interfaces/referenceLoader.js";

const CLI_DIR = dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log(`claira — Claira Engine CLI

Commands:
  analyze           Full pipeline: classify → route → decide (session ledger updated)
  classify          Classification only
  place-card        Place-card summary from a prior analyze result JSON
  suggestions       Ranked cosine/softmax suggestions from result JSON
  apply-decision    Record human correction (predicted vs selected)
  session-report    Write data/session_report.json and print report JSON
  reset-session     Clear session ledger (in-memory)
  learning-stats    Print learning stats for (predicted_label [, selected_label])
  process-folder    Recursively process all PNGs in a folder (placeholder embeddings)

Embedding inputs (analyze / classify):
  --embedding <file>       JSON: number[] or { "data": number[] }
  --references <file>      JSON: { "label": [n,...] | [[n,...], ...], ... }
  --file <path>            Optional logical file path for ledger / place-card

Options:
  --softmax-temperature N  Override config softmax temperature
  --stdin                  Read analyze result JSON from stdin (place-card, suggestions)
  --result <file>          Read analyze result JSON from file
  --predicted <label>      apply-decision / learning-stats
  --selected <label>       apply-decision / learning-stats
  --confidence <n>         apply-decision optional model confidence
  --scope global|single    apply-decision: global = learn rule (default), single = one-off
  --file <path>            apply-decision: local PNG to copy into references/user/<selected>/

Examples:
  node cli/claira.mjs analyze --embedding emb.json --references refs.json --file ./asset.png
  node cli/claira.mjs place-card --result out.json
  cat out.json | node cli/claira.mjs place-card --stdin
  node cli/claira.mjs process-folder ./test-images
`);
}

function parseArgs(argv) {
  /** @type {string[]} */
  const positional = [];
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      flags.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !String(next).startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function readJsonPath(p) {
  const abs = resolve(p);
  const raw = readFileSync(abs, "utf8");
  return JSON.parse(raw);
}

/**
 * @param {unknown} data
 * @returns {Float32Array}
 */
function parseInputEmbedding(data) {
  if (Array.isArray(data) && data.length && typeof data[0] === "number") {
    return new Float32Array(data);
  }
  if (data && typeof data === "object" && Array.isArray(/** @type {{ data?: number[] }} */ (data).data)) {
    return new Float32Array(/** @type {{ data: number[] }} */ (data).data);
  }
  throw new Error("embedding: expected number[] or { data: number[] }");
}

function readAnalyzeResult(flags) {
  if (flags.stdin) {
    if (process.stdin.isTTY) {
      throw new Error("--stdin requires piped input");
    }
    const s = readFileSync(0, "utf8").trim();
    if (!s) throw new Error("stdin empty");
    return JSON.parse(s);
  }
  if (flags.result && typeof flags.result === "string") {
    return readJsonPath(flags.result);
  }
  throw new Error("provide --result <file> or --stdin with analyze JSON");
}

function outJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

async function cmdAnalyze(flags) {
  const embPath = flags.embedding;
  const refPath = flags.references;
  if (!embPath || !refPath) throw new Error("analyze requires --embedding and --references");
  const embRaw = readJsonPath(String(embPath));
  const refRaw = readJsonPath(String(refPath));
  const inputEmbedding = parseInputEmbedding(embRaw);
  const referenceEmbeddingsByLabel = parseReferenceEmbeddingsFromJson(refRaw);
  const file = flags.file != null ? String(flags.file) : null;
  let softmaxTemperature;
  if (flags["softmax-temperature"] != null) {
    softmaxTemperature = Number(flags["softmax-temperature"]);
    if (!Number.isFinite(softmaxTemperature)) throw new Error("invalid --softmax-temperature");
  }
  const input = {
    inputEmbedding,
    referenceEmbeddingsByLabel,
    file,
    ...(softmaxTemperature != null ? { softmaxTemperature } : {}),
  };
  const result = await analyze(input);
  if (result.error) {
    outJson(result);
    process.exitCode = 1;
    return;
  }
  outJson(result);
}

async function cmdClassify(flags) {
  const embPath = flags.embedding;
  const refPath = flags.references;
  if (!embPath || !refPath) throw new Error("classify requires --embedding and --references");
  const embRaw = readJsonPath(String(embPath));
  const refRaw = readJsonPath(String(refPath));
  const inputEmbedding = parseInputEmbedding(embRaw);
  const referenceEmbeddingsByLabel = parseReferenceEmbeddingsFromJson(refRaw);
  let softmaxTemperature;
  if (flags["softmax-temperature"] != null) {
    softmaxTemperature = Number(flags["softmax-temperature"]);
    if (!Number.isFinite(softmaxTemperature)) throw new Error("invalid --softmax-temperature");
  }
  const input = {
    inputEmbedding,
    referenceEmbeddingsByLabel,
    ...(softmaxTemperature != null ? { softmaxTemperature } : {}),
  };
  const result = await classify(input);
  if (result.error) {
    outJson(result);
    process.exitCode = 1;
    return;
  }
  outJson(result);
}

async function cmdPlaceCard(flags) {
  const result = readAnalyzeResult(flags);
  const { placeCard } = await generatePlaceCard(result);
  outJson({ placeCard });
}

async function cmdSuggestions(flags) {
  const result = readAnalyzeResult(flags);
  const r = await getSuggestions(result);
  outJson(r);
}

async function cmdApplyDecision(flags) {
  const predicted = flags.predicted != null ? String(flags.predicted) : "";
  const selected = flags.selected != null ? String(flags.selected) : "";
  if (!predicted || !selected) throw new Error("apply-decision requires --predicted and --selected");
  let confidence;
  if (flags.confidence != null) {
    confidence = Number(flags.confidence);
    if (!Number.isFinite(confidence)) throw new Error("invalid --confidence");
  }
  const file = flags.file != null ? String(flags.file) : undefined;
  let scope;
  if (flags.scope != null) {
    const s = String(flags.scope).toLowerCase();
    if (s !== "global" && s !== "single") throw new Error("invalid --scope (use global or single)");
    scope = s;
  }
  const r = await applyDecision({
    predicted_label: predicted,
    selected_label: selected,
    confidence,
    file,
    scope,
  });
  outJson(r);
}

function cmdSessionReport() {
  const rep = generateSessionReport();
  outJson(rep);
}

function cmdResetSession() {
  resetSessionLedger();
  outJson({ ok: true, reset: "session_ledger" });
}

function cmdLearningStats(flags) {
  const predicted = flags.predicted != null ? String(flags.predicted) : "";
  if (!predicted) throw new Error("learning-stats requires --predicted");
  const selected = flags.selected != null ? String(flags.selected) : null;
  const stats = getLearningStats(predicted, selected);
  outJson({ predicted_label: predicted, selected_label: selected, stats });
}

/** @param {"high" | "medium" | "low"} priority */
function reviewBracketTag(priority) {
  const p = String(priority).toLowerCase();
  if (p === "high") return "[HIGH]";
  if (p === "medium") return "[MEDIUM]";
  return "[LOW]";
}

async function cmdProcessFolder(positional) {
  const folderArg = positional[1];
  if (!folderArg) throw new Error("process-folder requires a folder path");
  const out = await processFolder(folderArg);

  for (const row of out.results) {
    const rel = row.rel;
    if (row.error === "embedding_failed") {
      console.log(`[ERROR] ${rel} → embedding_failed`);
      continue;
    }
    if (row.room_validation && row.priority) {
      const rv = row.room_validation;
      console.log(
        `[REVIEW]${reviewBracketTag(row.priority)} ${rel} → rejected_by_room (score: ${rv.score})`,
      );
      continue;
    }
    if (row.priority && row.place_card === null) {
      console.log(`[REVIEW]${reviewBracketTag(row.priority)} ${rel} → ${row.reason}`);
      continue;
    }
    if (row.priority && row.place_card) {
      console.log(`[REVIEW]${reviewBracketTag(row.priority)} ${rel} → ${row.reason}`);
      continue;
    }
    const pc = row.place_card;
    const conf =
      pc?.confidence != null && Number.isFinite(Number(pc.confidence))
        ? Number(pc.confidence).toFixed(4)
        : String(pc?.confidence ?? "?");
    const dest = pc?.proposed_destination ?? "(none)";
    console.log(`[OK] ${rel} → ${dest} (confidence: ${conf})`);
    if (row.move_error) {
      console.log(`[ERROR] ${rel} → move_failed (${row.move_error})`);
    } else if (row.moved_to) {
      const destLabel = String(pc?.proposed_destination ?? "").replace(/\\/g, "/") || "(none)";
      console.log(`[MOVED] ${rel} → ${destLabel}`);
    }
  }

  const rep = getSessionSummary();
  console.log("\n--- session summary ---");
  console.log(JSON.stringify(rep.summary, null, 2));
  const rpc = out.reviewPriorityCounts;
  console.log(`High priority: ${rpc.high}`);
  console.log(`Medium priority: ${rpc.medium}`);
  console.log(`Low priority: ${rpc.low}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const { positional, flags } = parseArgs(argv);
  if (flags.help || positional.length === 0) {
    printHelp();
    return;
  }
  const cmd = positional[0];
  try {
    switch (cmd) {
      case "analyze":
        await cmdAnalyze(flags);
        break;
      case "classify":
        await cmdClassify(flags);
        break;
      case "place-card":
        await cmdPlaceCard(flags);
        break;
      case "suggestions":
        await cmdSuggestions(flags);
        break;
      case "apply-decision":
        await cmdApplyDecision(flags);
        break;
      case "session-report":
        cmdSessionReport();
        break;
      case "reset-session":
        cmdResetSession();
        break;
      case "learning-stats":
        cmdLearningStats(flags);
        break;
      case "process-folder":
        await cmdProcessFolder(positional);
        break;
      default:
        console.error(`Unknown command: ${cmd}`);
        printHelp();
        process.exitCode = 1;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ error: "cli", message: msg }, null, 2));
    process.exitCode = 1;
  }
}

main();

/**
 * Session ledger — in-memory aggregates + end-of-session report (no prompts).
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));

/** Ledger flag: top-2 cosines very close (no label-pair table). */
function isNarrowMarginAmbiguity(classification) {
  const m = classification?.margin;
  return typeof m === "number" && m < 0.012;
}

let totalProcessed = 0;
let totalReviewItems = 0;
/** @type {Array<UnresolvedEntry>} */
const unresolvedSnapshots = [];
/** @type {Map<string, number>} */
const sessionCorrectionPairCounts = new Map();
/** @type {Map<string, number>} */
const highConflictPairHits = new Map();

/**
 * @typedef {{
 *   at: string,
 *   file: string | null,
 *   predicted_label: string | null,
 *   routing_label: string | null,
 *   proposed_destination: string | null,
 *   decision: string,
 *   reason: string | null,
 *   confidence: number | null,
 *   margin: number | null,
 *   high_conflict_cosine: boolean,
 * }} UnresolvedEntry
 */

function normPairKey(a, b) {
  if (a == null || b == null) return null;
  return [String(a).toLowerCase(), String(b).toLowerCase()].sort().join("|");
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * @param {{ predicted_label?: string | null, second_label?: string | null }} classification
 */
function observeHighConflictCosine(classification) {
  if (!isNarrowMarginAmbiguity(classification)) return;
  const top1 = classification?.predicted_label;
  const top2 = classification?.second_label;
  const k = normPairKey(top1, top2);
  if (k) bump(highConflictPairHits, k);
}

/**
 * Call after a full analyze() pipeline (valid input).
 * @param {{
 *   file?: string | null,
 *   classification: object,
 *   routing: object,
 *   decision: { decision: string, reason?: string },
 * }} payload
 */
export function recordAnalyzeOutcome(payload) {
  const { classification, routing, decision, file = null } = payload;
  totalProcessed += 1;

  observeHighConflictCosine(classification);

  const dec = decision?.decision;
  if (dec === "review") {
    totalReviewItems += 1;
  }

  if (dec === "review" || dec === "error") {
    const highCos = isNarrowMarginAmbiguity(classification);
    unresolvedSnapshots.push({
      at: new Date().toISOString(),
      file: file ?? null,
      predicted_label: classification?.predicted_label ?? null,
      routing_label: routing?.routing_label ?? null,
      proposed_destination: routing?.proposed_destination ?? null,
      decision: dec,
      reason: decision?.reason ?? null,
      confidence:
        classification?.confidence != null ? Number(classification.confidence) : null,
      margin: classification?.margin != null ? Number(classification.margin) : null,
      high_conflict_cosine: highCos,
    });
  }
}

/**
 * @param {{
 *   predicted_label?: string | null,
 *   selected_label?: string | null,
 *   correctionRecorded: boolean,
 * }} payload
 */
export function recordApplyDecisionOutcome(payload) {
  if (!payload.correctionRecorded) return;
  const pred = String(payload.predicted_label ?? "").trim();
  const sel = String(payload.selected_label ?? "").trim();
  if (!pred || !sel) return;
  const k = `${pred}→${sel}`;
  bump(sessionCorrectionPairCounts, k);
}

function buildIssues() {
  /** @type {Array<Record<string, unknown>>} */
  const issues = [];

  for (const [pair, seen] of highConflictPairHits) {
    issues.push({
      kind: "high_conflict_label_pair",
      pair,
      occurrences: seen,
    });
  }

  for (const [pair, count] of sessionCorrectionPairCounts) {
    if (count >= 2) {
      issues.push({
        kind: "repeated_correction",
        pair,
        sessionCount: count,
      });
    }
  }

  issues.sort((a, b) => String(a.kind).localeCompare(String(b.kind)));
  return issues;
}

/**
 * Build report object, write `claira-engine/data/session_report.json`, return the same object.
 * @returns {{
 *   generatedAt: string,
 *   summary: {
 *     totalProcessed: number,
 *     totalReviewItems: number,
 *     unresolvedCount: number,
 *     repeatedCorrectionPairs: number,
 *     highConflictLabelPairHits: number,
 *     highConflictPairTypesObserved: number,
 *   },
 *   issues: Array<Record<string, unknown>>,
 *   unresolvedItems: typeof unresolvedSnapshots,
 * }}
 */
export function generateSessionReport() {
  const repeatedCorrectionPairs = [...sessionCorrectionPairCounts.values()].filter((n) => n >= 2)
    .length;
  let highConflictObservationTotal = 0;
  for (const n of highConflictPairHits.values()) highConflictObservationTotal += n;

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalProcessed,
      totalReviewItems,
      unresolvedCount: unresolvedSnapshots.length,
      repeatedCorrectionPairs,
      highConflictLabelPairHits: highConflictObservationTotal,
      highConflictPairTypesObserved: highConflictPairHits.size,
    },
    issues: buildIssues(),
    unresolvedItems: unresolvedSnapshots.map((u) => ({ ...u })),
  };

  const dataDir = join(__dirname, "..", "data");
  mkdirSync(dataDir, { recursive: true });
  const outPath = join(dataDir, "session_report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  return report;
}

/** Clear ledger (e.g. tests or new session). */
export function resetSessionLedger() {
  totalProcessed = 0;
  totalReviewItems = 0;
  unresolvedSnapshots.length = 0;
  sessionCorrectionPairCounts.clear();
  highConflictPairHits.clear();
}

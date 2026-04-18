/**
 * Tax PDF comparison — analysis only, read-only, deterministic.
 * Supports 2–5 documents, multi-year value arrays, trends, and anomaly flags.
 */

import { assertCapabilityModule } from "./capabilityContract.js";
import { getDomainDefinition } from "./domainRegistry.js";
import {
  TAX_FIELD_SYNONYMS,
  bestSynonymScoreForField,
  extractNumberFromLine,
  listTaxComparisonFieldIds,
  taxFieldDisplayLabel,
} from "./taxFieldMap.js";
import {
  computeTrendAndAvgGrowth,
  detectSeriesAnomaly,
  firstLastDelta,
} from "./taxComparisonAnalytics.js";
import { synonymLearningBoostForLine } from "./taxComparisonLearning.js";
import { assertPdfPathUnderCwd } from "./taxPathUnderCwd.js";
import { extractPdfTextFromFile } from "./taxPdfExtract.js";

const MIN_DOCS = 2;
const MAX_DOCS = 5;

/**
 * @param {string} text
 * @returns {string[]}
 */
function linesFromText(text) {
  return String(text ?? "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * @param {string} text
 * @param {string} fieldId
 * @returns {{ fieldId: string, value: number | null, confidence: number, sourceText: string }}
 */
function bestFieldMatchInText(text, fieldId) {
  if (!TAX_FIELD_SYNONYMS[fieldId]) {
    return { fieldId, value: null, confidence: 0, sourceText: "" };
  }
  const lines = linesFromText(text);
  /** @type {{ score: number, value: number | null, sourceText: string, conf: number } | null} */
  let best = null;
  for (const line of lines) {
    const syn = bestSynonymScoreForField(line, fieldId);
    const learn = synonymLearningBoostForLine(line, fieldId);
    const adjSyn = Math.min(1, syn + learn);
    if (adjSyn < 0.12) continue;
    const { value } = extractNumberFromLine(line);
    const conf = Math.min(0.98, 0.15 + adjSyn * 0.75 + (value != null ? 0.18 : 0));
    if (!best || conf > best.conf) {
      best = { score: adjSyn, value: value ?? null, sourceText: line.slice(0, 480), conf };
    }
  }
  if (!best) {
    return { fieldId, value: null, confidence: 0, sourceText: "" };
  }
  return {
    fieldId,
    value: best.value,
    confidence: Number(best.conf.toFixed(4)),
    sourceText: best.sourceText,
  };
}

/**
 * Preserve first-seen order while deduping string paths.
 * @param {unknown[]} rawList
 * @returns {string[]}
 */
function uniquePathsInOrder(rawList) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const x of rawList) {
    const s = String(x ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * @typedef {object} TaxDocumentComparisonRunInput
 * @property {string[]} fileList Absolute paths to 2–5 PDFs (staging or workspace paths).
 * @property {string} [cwd] Workspace root for PDF path checks.
 * @property {string[]} [selectedFields] Optional list of tax field ids to prioritize in the report.
 * @property {number} [anomalyThresholdPct] Optional finite threshold for year-over-year anomaly highlighting.
 */

export const taxDocumentComparisonModule = {
  id: "tax_document_comparison",
  name: "Tax document comparison",
  description:
    "Extract tax-related fields from 2–5 PDFs and compare values (read-only, no filesystem writes).",
  supportedIntents: [
    "compare tax pdf",
    "tax pdf compare",
    "year over year tax",
    "multi year tax",
    "field comparison",
    "compare returns",
    "tax document diff",
  ],

  /**
   * @param {TaxDocumentComparisonRunInput} input
   * @param {import("./capabilityContract.js").CapabilityRunContext} context
   */
  async run(input, context) {
    const dm =
      context.inputData != null &&
      typeof context.inputData === "object" &&
      !Array.isArray(context.inputData) &&
      typeof /** @type {{ domainMode?: string }} */ (context.inputData).domainMode === "string"
        ? String(/** @type {{ domainMode?: string }} */ (context.inputData).domainMode).trim()
        : "";
    if (getDomainDefinition(dm).id !== "tax") {
      return {
        error: true,
        message: "tax_document_comparison: requires domainMode tax",
        summary: "Switch capability domain to Tax to use this module.",
      };
    }

    const cwd =
      typeof input.cwd === "string" && input.cwd.trim()
        ? input.cwd.trim()
        : typeof context.inputData?.cwd === "string"
          ? String(context.inputData.cwd).trim()
          : process.cwd();

    const rawList = Array.isArray(input.fileList) ? input.fileList : [];
    const paths = uniquePathsInOrder(rawList);
    if (paths.length < MIN_DOCS) {
      return {
        error: true,
        message: "tax_document_comparison: fileList must contain at least two distinct PDF paths",
        summary: "Provide two or more PDF paths under your workspace.",
      };
    }
    if (paths.length > MAX_DOCS) {
      return {
        error: true,
        message: `tax_document_comparison: at most ${MAX_DOCS} PDF paths`,
        summary: `Select between ${MIN_DOCS} and ${MAX_DOCS} PDFs.`,
      };
    }

    let anomalyThresholdPct = 50;
    if (
      typeof input.anomalyThresholdPct === "number" &&
      Number.isFinite(input.anomalyThresholdPct) &&
      input.anomalyThresholdPct > 0
    ) {
      anomalyThresholdPct = input.anomalyThresholdPct;
    }

    const selectedRaw = Array.isArray(input.selectedFields) ? input.selectedFields : null;
    const allIds = listTaxComparisonFieldIds();
    /** @type {string[]} */
    const fieldIds =
      selectedRaw && selectedRaw.length > 0
        ? [...new Set(selectedRaw.map((x) => String(x ?? "").trim()).filter((id) => TAX_FIELD_SYNONYMS[id]))]
        : allIds;

    /** @type {string[]} */
    const resolved = [];
    for (const p of paths) {
      const { absPath } = assertPdfPathUnderCwd(cwd, p);
      if (resolved.includes(absPath)) continue;
      resolved.push(absPath);
    }
    if (resolved.length < MIN_DOCS) {
      return {
        error: true,
        message: "tax_document_comparison: need two distinct valid PDF files",
        summary: "Select two or more different PDFs under the workspace.",
      };
    }

    /** @type {{ text: string, pageCount: number }[]} */
    const texts = [];
    for (const path of resolved) {
      texts.push(await extractPdfTextFromFile(path));
    }

    /** @type {Array<Record<string, unknown>>} */
    const comparisons = [];
    let pagesRead = 0;
    for (const t of texts) pagesRead += t.pageCount;

    for (const fid of fieldIds) {
      /** @type {(number | null)[]} */
      const values = [];
      /** @type {unknown[]} */
      const documents = [];
      for (let i = 0; i < resolved.length; i++) {
        const m = bestFieldMatchInText(texts[i].text, fid);
        values.push(m.value);
        documents.push({
          path: resolved[i],
          value: m.value,
          confidence: m.confidence,
          sourceText: m.sourceText,
        });
      }

      const { trend, avgGrowth } = computeTrendAndAvgGrowth(values);
      const { anomaly, message } = detectSeriesAnomaly(values, anomalyThresholdPct);
      const { delta, percentChange } = firstLastDelta(values);

      comparisons.push({
        fieldId: fid,
        label: taxFieldDisplayLabel(fid),
        values,
        documents,
        trend,
        avgGrowth,
        anomaly,
        message,
        delta,
        percentChange,
      });
    }

    return {
      summary: `Compared ${resolved.length} PDFs · ${fieldIds.length} field(s) · ${pagesRead} pages read`,
      paths: resolved,
      pageCounts: texts.map((t) => t.pageCount),
      anomalyThresholdPct,
      fields: fieldIds,
      comparisons,
    };
  },
};

assertCapabilityModule(taxDocumentComparisonModule, "taxDocumentComparisonModule");

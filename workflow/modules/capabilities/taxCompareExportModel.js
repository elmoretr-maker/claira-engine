/**
 * Client-year grouping and export payloads for tax comparison UI (deterministic, no I/O).
 */

import { computeTrendAndAvgGrowth, detectSeriesAnomaly, firstLastDelta } from "./taxComparisonAnalytics.js";
import { taxFieldDisplayLabel } from "./taxFieldMap.js";

/**
 * @param {unknown} raw
 * @returns {number | null}
 */
export function parseTaxYearInput(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} filename
 * @returns {number | null}
 */
export function guessTaxYearFromFilename(filename) {
  const m = String(filename ?? "").match(/(19|20)\d{2}/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} row
 * @returns {{ fieldId: string, label: string, values: (number|null)[], mapToFieldId: string } | null}
 */
function rowDraftSnapshot(row, draft) {
  if (row == null || typeof row !== "object" || Array.isArray(row)) return null;
  const rec = /** @type {Record<string, unknown>} */ (row);
  const fieldId = typeof rec.fieldId === "string" ? rec.fieldId : "";
  if (!fieldId) return null;
  const d = draft[fieldId];
  if (!d || !Array.isArray(d.values)) return null;
  const baseVals = Array.isArray(rec.values) ? rec.values : [];
  if (d.values.length !== baseVals.length) return null;
  const vals = d.values;
  const label = taxFieldDisplayLabel(d.mapToFieldId);
  return { fieldId, label, values: vals, mapToFieldId: d.mapToFieldId };
}

/**
 * @param {{ client: string, year: string }[]} docMeta
 * @param {unknown[]} comparisons
 * @param {Record<string, { values: (number | null)[], mapToFieldId: string }>} draft
 * @param {string[]} orderedFieldIds
 * @param {number} anomalyThreshold
 * @returns {{ client: string, years: (number | null)[], fields: Record<string, unknown>[] }[]}
 */
export function buildTaxClientAggregation(docMeta, comparisons, draft, orderedFieldIds, anomalyThreshold) {
  const n = docMeta.length;
  if (n < 2) return [];

  /** @type {Map<string, number[]>} */
  const byClient = new Map();
  for (let i = 0; i < n; i++) {
    const client = String(docMeta[i]?.client ?? "").trim() || "Unassigned";
    if (!byClient.has(client)) byClient.set(client, []);
    /** @type {number[]} */ (byClient.get(client)).push(i);
  }

  /** @type {{ client: string, years: (number | null)[], fields: Record<string, unknown>[] }[]} */
  const out = [];

  for (const [client, indices] of byClient.entries()) {
    const sorted = [...indices].sort((a, b) => {
      const ya = parseTaxYearInput(docMeta[a]?.year);
      const yb = parseTaxYearInput(docMeta[b]?.year);
      if (ya != null && yb != null && ya !== yb) return ya - yb;
      if (ya != null && yb == null) return -1;
      if (ya == null && yb != null) return 1;
      return a - b;
    });

    const years = sorted.map((i) => parseTaxYearInput(docMeta[i]?.year));
    /** @type {Record<string, unknown>[]} */
    const fields = [];

    for (const fid of orderedFieldIds) {
      const row = comparisons.find(
        (r) => r && typeof r === "object" && !Array.isArray(r) && String(/** @type {Record<string, unknown>} */ (r).fieldId) === fid,
      );
      const snap = rowDraftSnapshot(row, draft);
      if (!snap) continue;
      const vals = sorted.map((idx) => snap.values[idx] ?? null);
      const { trend, avgGrowth } = computeTrendAndAvgGrowth(vals);
      const { anomaly, message } = detectSeriesAnomaly(vals, anomalyThreshold);
      const { delta, percentChange } = firstLastDelta(vals);
      fields.push({
        fieldId: snap.mapToFieldId,
        sourceFieldId: snap.fieldId,
        label: taxFieldDisplayLabel(snap.mapToFieldId),
        values: vals,
        trend,
        avgGrowth,
        delta,
        percentChange,
        anomaly,
        message,
      });
    }

    out.push({ client, years, fields });
  }

  return out.sort((a, b) => a.client.localeCompare(b.client));
}

/**
 * @param {unknown} result
 * @param {Record<string, { values: (number | null)[], mapToFieldId: string }>} draft
 * @param {{ client: string, year: string }[]} docMeta
 * @param {string[]} orderedFieldIds
 * @param {number} anomalyThreshold
 * @param {string[]} fileNames
 * @param {string} viewMode
 */
export function buildTaxCompareExportPayload(result, draft, docMeta, orderedFieldIds, anomalyThreshold, fileNames, viewMode) {
  const r = result && typeof result === "object" && !Array.isArray(result) ? /** @type {Record<string, unknown>} */ (result) : null;
  const comparisons = r && Array.isArray(r.comparisons) ? r.comparisons : [];
  const paths = r && Array.isArray(r.paths) ? r.paths.map((x) => String(x)) : [];

  /** @type {Record<string, unknown>[]} */
  const documentRows = [];
  for (const fid of orderedFieldIds) {
    const row = comparisons.find(
      (x) => x && typeof x === "object" && String(/** @type {Record<string, unknown>} */ (x).fieldId) === fid,
    );
    const snap = rowDraftSnapshot(row, draft);
    if (!snap) continue;
    const vals = snap.values;
    const { trend, avgGrowth } = computeTrendAndAvgGrowth(vals);
    const { anomaly, message } = detectSeriesAnomaly(vals, anomalyThreshold);
    const { delta, percentChange } = firstLastDelta(vals);
    documentRows.push({
      fieldId: snap.fieldId,
      label: snap.label,
      mapToFieldId: snap.mapToFieldId,
      values: vals,
      delta,
      percentChange,
      trend,
      avgGrowth,
      anomaly,
      message,
    });
  }

  const clientAggregation = buildTaxClientAggregation(docMeta, comparisons, draft, orderedFieldIds, anomalyThreshold);

  return {
    exportedAt: new Date().toISOString(),
    viewMode,
    anomalyThresholdPct: anomalyThreshold,
    summary: r?.summary != null ? String(r.summary) : "",
    paths,
    fileNames,
    documentMeta: docMeta.map((m, i) => ({
      index: i,
      client: String(m?.client ?? "").trim() || "Unassigned",
      year: parseTaxYearInput(m?.year),
      yearRaw: String(m?.year ?? ""),
      path: paths[i] ?? "",
      fileName: fileNames[i] ?? "",
    })),
    documentView: documentRows,
    clientView: clientAggregation,
  };
}

/**
 * @param {string} cell
 */
function csvEscape(cell) {
  const s = String(cell ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {Record<string, unknown>} payload from buildTaxCompareExportPayload
 */
export function taxComparePayloadToCsv(payload) {
  const lines = [];
  lines.push("# tax_compare_export");
  lines.push(`# exportedAt,${csvEscape(payload.exportedAt)}`);
  lines.push("section,field_id,label,map_to_field_id,client,years,values,delta,percent_change,trend,avg_growth,anomaly,anomaly_message");

  const docRows = Array.isArray(payload.documentView) ? payload.documentView : [];
  for (const row of docRows) {
    const rec = row && typeof row === "object" && !Array.isArray(row) ? /** @type {Record<string, unknown>} */ (row) : {};
    const vals = Array.isArray(rec.values) ? rec.values.map((v) => (v == null ? "" : String(v))).join("|") : "";
    lines.push(
      [
        "document",
        csvEscape(rec.fieldId),
        csvEscape(rec.label),
        csvEscape(rec.mapToFieldId),
        "",
        "",
        csvEscape(vals),
        csvEscape(rec.delta == null ? "" : rec.delta),
        csvEscape(rec.percentChange == null ? "" : rec.percentChange),
        csvEscape(rec.trend),
        csvEscape(rec.avgGrowth == null ? "" : rec.avgGrowth),
        csvEscape(rec.anomaly === true ? "true" : "false"),
        csvEscape(rec.message),
      ].join(","),
    );
  }

  const clients = Array.isArray(payload.clientView) ? payload.clientView : [];
  for (const block of clients) {
    const b = block && typeof block === "object" && !Array.isArray(block) ? /** @type {Record<string, unknown>} */ (block) : {};
    const client = String(b.client ?? "");
    const years = Array.isArray(b.years) ? b.years.map((y) => (y == null ? "" : String(y))).join("|") : "";
    const fields = Array.isArray(b.fields) ? b.fields : [];
    for (const f of fields) {
      const fr = f && typeof f === "object" && !Array.isArray(f) ? /** @type {Record<string, unknown>} */ (f) : {};
      const vals = Array.isArray(fr.values) ? fr.values.map((v) => (v == null ? "" : String(v))).join("|") : "";
      lines.push(
        [
          "client",
          csvEscape(fr.fieldId),
          csvEscape(fr.label),
          csvEscape(fr.sourceFieldId ?? ""),
          csvEscape(client),
          csvEscape(years),
          csvEscape(vals),
          csvEscape(fr.delta == null ? "" : fr.delta),
          csvEscape(fr.percentChange == null ? "" : fr.percentChange),
          csvEscape(fr.trend),
          csvEscape(fr.avgGrowth == null ? "" : fr.avgGrowth),
          csvEscape(fr.anomaly === true ? "true" : "false"),
          csvEscape(fr.message),
        ].join(","),
      );
    }
  }

  return lines.join("\r\n");
}

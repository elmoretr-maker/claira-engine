import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TAX_FIELD_GROUPS,
  groupForTaxFieldId,
  listTaxComparisonFieldIds,
  listTaxFieldGroupOrder,
  taxFieldDisplayLabel,
} from "../../workflow/modules/capabilities/taxFieldMap.js";
import { computeTrendAndAvgGrowth, detectSeriesAnomaly } from "../../workflow/modules/capabilities/taxComparisonAnalytics.js";
import {
  buildTaxClientAggregation,
  buildTaxCompareExportPayload,
  guessTaxYearFromFilename,
  taxComparePayloadToCsv,
} from "../../workflow/modules/capabilities/taxCompareExportModel.js";
import { recordCapabilityOverride, runTaxDocumentComparison } from "../clairaApiClient.js";
import "./TaxDocumentComparePanel.css";

const MAX_FILES = 5;
const MODULE_ID = "tax_document_comparison";
const LS_KEY = "claira_tax_compare_session_v1";

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function parseCellNumber(v) {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} filename
 * @param {string} mime
 * @param {string} text
 */
function downloadText(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * @param {unknown} row
 * @returns {string}
 */
function rowLabel(row) {
  const rec = row && typeof row === "object" && !Array.isArray(row) ? /** @type {Record<string, unknown>} */ (row) : {};
  const fid = typeof rec.fieldId === "string" ? rec.fieldId : "";
  if (typeof rec.label === "string" && rec.label.trim()) return rec.label.trim();
  return taxFieldDisplayLabel(fid);
}

/**
 * @param {{ className?: string }} props
 */
export default function TaxDocumentComparePanel({ className = "" }) {
  const fieldIds = useMemo(() => listTaxComparisonFieldIds(), []);
  const [files, setFiles] = useState(/** @type {File[]} */ ([]));
  const [sessionFileNames, setSessionFileNames] = useState(/** @type {string[]} */ ([]));
  const [docMeta, setDocMeta] = useState(/** @type {{ client: string, year: string }[]} */ ([]));
  const [selected, setSelected] = useState(() => new Set(fieldIds));
  const [anomalyThreshold, setAnomalyThreshold] = useState(50);
  const [viewMode, setViewMode] = useState(/** @type { "documents" | "clients" } */ ("documents"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [feedbackMsg, setFeedbackMsg] = useState(/** @type {string | null} */ (null));
  const [sessionLoadedMsg, setSessionLoadedMsg] = useState(/** @type {string | null} */ (null));
  /** @type {[unknown, React.Dispatch<React.SetStateAction<unknown>>]} */
  const [result, setResult] = useState(() => /** @type {unknown} */ (null));
  /** @type {[Record<string, { values: (number | null)[], mapToFieldId: string }>, React.Dispatch<React.SetStateAction<Record<string, { values: (number | null)[], mapToFieldId: string }>>>]} */
  const [draft, setDraft] = useState(() => /** @type {Record<string, { values: (number | null)[], mapToFieldId: string }>} */ ({}));
  /** @type {[Record<string, boolean>, React.Dispatch<React.SetStateAction<Record<string, boolean>>>]} */
  const [expanded, setExpanded] = useState(() => /** @type {Record<string, boolean>} */ ({}));
  const [saveBusy, setSaveBusy] = useState(false);

  const paths = useMemo(() => {
    const r = result && typeof result === "object" && !Array.isArray(result) ? /** @type {Record<string, unknown>} */ (result) : null;
    const p = r?.paths;
    return Array.isArray(p) ? p.map((x) => String(x)) : [];
  }, [result]);

  const effectiveFileNames = useMemo(() => {
    if (files.length > 0) return files.map((f) => f.name);
    return sessionFileNames;
  }, [files, sessionFileNames]);

  const docCount = useMemo(() => {
    const n = Math.max(paths.length, files.length);
    return n >= 2 ? n : 0;
  }, [paths.length, files.length]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const data = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
      if (data?.version !== 1 || data?.result == null) return;
      const ids = listTaxComparisonFieldIds();
      setResult(data.result);
      setDocMeta(Array.isArray(data.docMeta) ? /** @type {{ client: string, year: string }[]} */ (data.docMeta) : []);
      setAnomalyThreshold(typeof data.anomalyThreshold === "number" && Number.isFinite(data.anomalyThreshold) ? data.anomalyThreshold : 50);
      setSelected(new Set(Array.isArray(data.selectedFieldIds) ? data.selectedFieldIds.map(String).filter((id) => ids.includes(id)) : ids));
      setViewMode(data.viewMode === "clients" ? "clients" : "documents");
      setSessionFileNames(Array.isArray(data.sessionFileNames) ? data.sessionFileNames.map(String) : []);
      setSessionLoadedMsg("Restored last comparison from this browser.");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!result) return;
    const names = files.length > 0 ? files.map((f) => f.name) : sessionFileNames;
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          version: 1,
          savedAt: Date.now(),
          result,
          docMeta,
          anomalyThreshold,
          selectedFieldIds: [...selected],
          viewMode,
          sessionFileNames: names,
        }),
      );
    } catch {
      /* quota / private mode */
    }
  }, [result, docMeta, anomalyThreshold, selected, viewMode, files, sessionFileNames]);

  useEffect(() => {
    if (docCount < 2) return;
    const names = effectiveFileNames;
    setDocMeta((prev) => {
      const next = [];
      for (let i = 0; i < docCount; i++) {
        const name = names[i] ?? "";
        const guessed = guessTaxYearFromFilename(name);
        const old = prev[i];
        const yearStr = old?.year != null && String(old.year).trim() !== "" ? String(old.year) : guessed != null ? String(guessed) : "";
        next.push({
          client: old?.client != null ? String(old.client) : "",
          year: yearStr,
        });
      }
      return next;
    });
  }, [docCount, paths.join("|"), files.map((f) => f.name).join("|"), sessionFileNames.join("|")]);

  const clearSavedSession = useCallback(() => {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
    setSessionLoadedMsg(null);
    setResult(null);
    setDocMeta([]);
    setSessionFileNames([]);
    setExpanded({});
  }, []);

  const toggleField = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const comparisons = useMemo(() => {
    const r = result && typeof result === "object" && !Array.isArray(result) ? /** @type {Record<string, unknown>} */ (result) : null;
    const c = r?.comparisons;
    return Array.isArray(c) ? c : [];
  }, [result]);

  useEffect(() => {
    if (comparisons.length === 0) {
      setDraft({});
      return;
    }
    /** @type {Record<string, { values: (number | null)[], mapToFieldId: string }>} */
    const next = {};
    for (const row of comparisons) {
      const rec = row && typeof row === "object" && !Array.isArray(row) ? /** @type {Record<string, unknown>} */ (row) : {};
      const id = typeof rec.fieldId === "string" ? rec.fieldId : "";
      if (!id) continue;
      const vals = Array.isArray(rec.values) ? rec.values : [];
      next[id] = {
        values: vals.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null)),
        mapToFieldId: id,
      };
    }
    setDraft(next);
  }, [comparisons]);

  const orderedFieldIds = useMemo(() => {
    const present = new Set(
      comparisons
        .map((row) =>
          row && typeof row === "object" && !Array.isArray(row) ? String(/** @type {Record<string, unknown>} */ (row).fieldId ?? "") : "",
        )
        .filter(Boolean),
    );
    /** @type {string[]} */
    const ids = [];
    for (const g of listTaxFieldGroupOrder()) {
      const groupIds = TAX_FIELD_GROUPS[g];
      if (!Array.isArray(groupIds)) continue;
      for (const fid of groupIds) {
        if (present.has(fid) && selected.has(fid)) ids.push(fid);
      }
    }
    for (const row of comparisons) {
      const rec = row && typeof row === "object" && !Array.isArray(row) ? /** @type {Record<string, unknown>} */ (row) : {};
      const fid = typeof rec.fieldId === "string" ? rec.fieldId : "";
      if (fid && selected.has(fid) && !ids.includes(fid)) ids.push(fid);
    }
    return ids;
  }, [comparisons, selected]);

  const byGroup = useMemo(() => {
    /** @type {Record<string, string[]>} */
    const m = {};
    for (const id of orderedFieldIds) {
      const g = groupForTaxFieldId(id);
      if (!m[g]) m[g] = [];
      m[g].push(id);
    }
    return m;
  }, [orderedFieldIds]);

  const groupOrder = useMemo(() => [...listTaxFieldGroupOrder(), "Other"], []);

  const clientBlocks = useMemo(
    () => buildTaxClientAggregation(docMeta, comparisons, draft, orderedFieldIds, anomalyThreshold),
    [docMeta, comparisons, draft, orderedFieldIds, anomalyThreshold],
  );

  const exportPayload = useMemo(
    () =>
      buildTaxCompareExportPayload(
        result,
        draft,
        docMeta,
        orderedFieldIds,
        anomalyThreshold,
        effectiveFileNames,
        viewMode,
      ),
    [result, draft, docMeta, orderedFieldIds, anomalyThreshold, effectiveFileNames, viewMode],
  );

  const runCompare = useCallback(async () => {
    setError(null);
    setFeedbackMsg(null);
    setSessionLoadedMsg(null);
    setResult(null);
    if (files.length < 2) {
      setError(`Choose between 2 and ${MAX_FILES} PDF files.`);
      return;
    }
    setBusy(true);
    try {
      const uploads = [];
      for (const f of files.slice(0, MAX_FILES)) {
        const b64 = await fileToBase64(f);
        uploads.push({ name: f.name, dataBase64: b64 });
      }
      const selectedFields = fieldIds.filter((id) => selected.has(id));
      const out = await runTaxDocumentComparison({
        uploads,
        selectedFields: selectedFields.length > 0 ? selectedFields : undefined,
        anomalyThresholdPct: anomalyThreshold,
      });
      if (!out || /** @type {{ ok?: boolean }} */ (out).ok !== true) {
        setError(
          typeof /** @type {{ error?: string }} */ (out).error === "string"
            ? /** @type {{ error: string }} */ (out).error
            : "Comparison failed",
        );
        return;
      }
      setSessionFileNames(files.map((f) => f.name));
      setResult(/** @type {{ result?: unknown }} */ (out).result ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [files, fieldIds, selected, anomalyThreshold]);

  const rowByFieldId = useMemo(() => {
    /** @type {Record<string, Record<string, unknown>>} */
    const m = {};
    for (const row of comparisons) {
      const rec = row && typeof row === "object" && !Array.isArray(row) ? /** @type {Record<string, unknown>} */ (row) : {};
      const id = typeof rec.fieldId === "string" ? rec.fieldId : "";
      if (id) m[id] = rec;
    }
    return m;
  }, [comparisons]);

  const hasDraftChanges = useMemo(() => {
    for (const fid of orderedFieldIds) {
      const row = rowByFieldId[fid];
      const d = draft[fid];
      if (!row || !d) continue;
      if (d.mapToFieldId !== fid) return true;
      const base = Array.isArray(row.values) ? row.values : [];
      for (let i = 0; i < base.length; i++) {
        const a = typeof base[i] === "number" && Number.isFinite(base[i]) ? base[i] : null;
        const b = d.values[i] ?? null;
        if (a !== b) return true;
      }
    }
    return false;
  }, [orderedFieldIds, rowByFieldId, draft]);

  const saveCorrections = useCallback(async () => {
    setFeedbackMsg(null);
    if (!hasDraftChanges) {
      setFeedbackMsg("No edits to save.");
      return;
    }
    /** @type {Record<string, unknown>[]} */
    const editsBad = [];
    /** @type {Record<string, unknown>[]} */
    const editsGood = [];
    for (const fid of orderedFieldIds) {
      const row = rowByFieldId[fid];
      const d = draft[fid];
      if (!row || !d) continue;
      const docs = Array.isArray(row.documents) ? row.documents : [];
      const base = Array.isArray(row.values) ? row.values : [];
      for (let i = 0; i < base.length; i++) {
        const origV = typeof base[i] === "number" && Number.isFinite(base[i]) ? base[i] : null;
        const newV = d.values[i] ?? null;
        const docRec =
          docs[i] && typeof docs[i] === "object" && !Array.isArray(docs[i])
            ? /** @type {Record<string, unknown>} */ (docs[i])
            : {};
        const sourceText = typeof docRec.sourceText === "string" ? docRec.sourceText : "";
        if (origV !== newV || d.mapToFieldId !== fid) {
          editsBad.push({
            kind: "tax_comparison_edit",
            fieldId: fid,
            docIndex: i,
            value: origV,
            sourceText,
          });
          editsGood.push({
            kind: "tax_comparison_edit",
            fieldId: d.mapToFieldId,
            docIndex: i,
            value: newV,
            sourceText,
            ...(d.mapToFieldId !== fid ? { previousFieldId: fid } : {}),
          });
        }
      }
    }
    if (editsBad.length === 0) {
      setFeedbackMsg("No edits to save.");
      return;
    }
    setSaveBusy(true);
    try {
      const rowId = `tax-compare-${Date.now()}`;
      const filename = files.map((f) => f.name).join(", ").slice(0, 200) || sessionFileNames.join(", ").slice(0, 200) || rowId;
      const out = await recordCapabilityOverride({
        rowId,
        moduleId: MODULE_ID,
        originalValues: { version: 1, edits: editsBad },
        finalValues: { version: 1, edits: editsGood },
        filename,
        timestamp: Date.now(),
      });
      if (out && typeof out === "object" && /** @type {{ ok?: boolean }} */ (out).ok === false) {
        setFeedbackMsg(
          typeof /** @type {{ error?: string }} */ (out).error === "string"
            ? /** @type {{ error: string }} */ (out).error
            : "Could not record feedback.",
        );
        return;
      }
      setFeedbackMsg("Corrections saved to feedback store.");
    } catch (e) {
      setFeedbackMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBusy(false);
    }
  }, [hasDraftChanges, orderedFieldIds, rowByFieldId, draft, files, sessionFileNames]);

  const onFilesPicked = useCallback((list) => {
    const pdfs = list.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    setFiles(pdfs.slice(0, MAX_FILES));
  }, []);

  const onCellChange = useCallback((fieldId, docIndex, raw) => {
    const v = parseCellNumber(raw);
    setDraft((prev) => {
      const cur = prev[fieldId];
      if (!cur) return prev;
      const nextVals = [...cur.values];
      nextVals[docIndex] = v;
      return { ...prev, [fieldId]: { ...cur, values: nextVals } };
    });
  }, []);

  const onRemap = useCallback((fieldId, newMapId) => {
    setDraft((prev) => {
      const cur = prev[fieldId];
      if (!cur) return prev;
      return { ...prev, [fieldId]: { ...cur, mapToFieldId: newMapId } };
    });
  }, []);

  const onDocMetaChange = useCallback((index, key, value) => {
    setDocMeta((prev) => {
      const next = [...prev];
      while (next.length <= index) next.push({ client: "", year: "" });
      const cur = next[index] ?? { client: "", year: "" };
      next[index] = { ...cur, [key]: value };
      return next;
    });
  }, []);

  const exportJson = useCallback(() => {
    downloadText(`tax-compare-${Date.now()}.json`, "application/json", JSON.stringify(exportPayload, null, 2));
  }, [exportPayload]);

  const exportCsv = useCallback(() => {
    downloadText(`tax-compare-${Date.now()}.csv`, "text/csv;charset=utf-8", taxComparePayloadToCsv(exportPayload));
  }, [exportPayload]);

  const showResults = orderedFieldIds.length > 0 && comparisons.length > 0;

  return (
    <section className={`tax-doc-compare ${className}`.trim()} aria-labelledby="tax-doc-compare-heading">
      <h2 id="tax-doc-compare-heading" className="tax-doc-compare__title">
        Compare Tax Documents
      </h2>
      <p className="tax-doc-compare__hint">
        Read-only analysis: 2–5 PDFs (max 15 MB and 20 pages each). Files are staged under your workspace temp folder,
        then removed. Set client and tax year per document for the client view and exports. Last run is saved in this
        browser (localStorage).
      </p>

      {sessionLoadedMsg ? (
        <p className="tax-doc-compare__session" role="status">
          {sessionLoadedMsg}{" "}
          <button type="button" className="btn btn-secondary tax-doc-compare__session-clear" onClick={clearSavedSession}>
            Clear saved session
          </button>
        </p>
      ) : null}

      <div className="tax-doc-compare__row">
        <label className="tax-doc-compare__file tax-doc-compare__file--multi">
          <span>PDFs (2–{MAX_FILES})</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(e) => onFilesPicked(Array.from(e.target.files ?? []))}
          />
          {effectiveFileNames.length > 0 ? (
            <ul className="tax-doc-compare__file-list">
              {effectiveFileNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          ) : null}
        </label>
        <label className="tax-doc-compare__threshold">
          <span>Anomaly threshold (%)</span>
          <input
            type="number"
            min={1}
            max={500}
            step={1}
            value={anomalyThreshold}
            onChange={(e) => setAnomalyThreshold(Number.parseInt(e.target.value, 10) || 50)}
          />
        </label>
      </div>

      {docCount >= 2 ? (
        <div className="tax-doc-compare__doc-meta">
          <div className="tax-doc-compare__doc-meta-head">Per-document client &amp; year</div>
          <div className="tax-doc-compare__doc-meta-grid">
            {Array.from({ length: docCount }, (_, i) => (
              <div key={`meta-${i}`} className="tax-doc-compare__doc-meta-row">
                <span className="tax-doc-compare__doc-meta-label">
                  Doc {i + 1}
                  {effectiveFileNames[i] ? `: ${effectiveFileNames[i]}` : ""}
                </span>
                <input
                  type="text"
                  className="tax-doc-compare__meta-input"
                  placeholder="Client name"
                  value={docMeta[i]?.client ?? ""}
                  onChange={(e) => onDocMetaChange(i, "client", e.target.value)}
                  aria-label={`Client for document ${i + 1}`}
                />
                <input
                  type="text"
                  className="tax-doc-compare__meta-input tax-doc-compare__meta-input--year"
                  placeholder="Year (e.g. 2023)"
                  value={docMeta[i]?.year ?? ""}
                  onChange={(e) => onDocMetaChange(i, "year", e.target.value)}
                  aria-label={`Tax year for document ${i + 1}`}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <fieldset className="tax-doc-compare__fields">
        <legend>Fields to include</legend>
        <div className="tax-doc-compare__checks">
          {fieldIds.map((id) => (
            <label key={id} className="tax-doc-compare__check">
              <input type="checkbox" checked={selected.has(id)} onChange={() => toggleField(id)} />
              {taxFieldDisplayLabel(id)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="tax-doc-compare__toolbar">
        <div className="tax-doc-compare__view-toggle" role="group" aria-label="Result view">
          <span className="tax-doc-compare__view-label">View:</span>
          <button
            type="button"
            className={`btn btn-secondary${viewMode === "documents" ? " is-active" : ""}`}
            onClick={() => setViewMode("documents")}
          >
            By document
          </button>
          <button
            type="button"
            className={`btn btn-secondary${viewMode === "clients" ? " is-active" : ""}`}
            onClick={() => setViewMode("clients")}
            disabled={!showResults}
          >
            By client
          </button>
        </div>
      </div>

      <div className="tax-doc-compare__actions">
        <button type="button" className="btn btn-primary tax-doc-compare__run" disabled={busy} onClick={() => void runCompare()}>
          {busy ? "Comparing…" : "Run comparison"}
        </button>
        <button
          type="button"
          className="btn btn-secondary tax-doc-compare__save"
          disabled={saveBusy || !hasDraftChanges || comparisons.length === 0}
          onClick={() => void saveCorrections()}
        >
          {saveBusy ? "Saving…" : "Save corrections (learning)"}
        </button>
        <button type="button" className="btn btn-secondary" disabled={!showResults} onClick={exportJson}>
          Export JSON
        </button>
        <button type="button" className="btn btn-secondary" disabled={!showResults} onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      {error ? (
        <p className="tax-doc-compare__error" role="alert">
          {error}
        </p>
      ) : null}
      {feedbackMsg ? (
        <p className="tax-doc-compare__feedback" role="status">
          {feedbackMsg}
        </p>
      ) : null}

      {paths.length >= 2 ? (
        <p className="tax-doc-compare__paths">
          {paths.map((p, i) => (
            <span key={p}>
              <span className="tax-doc-compare__path-label">Doc {i + 1}:</span> <code>{p}</code>
              <br />
            </span>
          ))}
        </p>
      ) : null}

      {viewMode === "clients" && showResults
        ? clientBlocks.map((block) => (
            <div key={block.client} className="tax-doc-compare__group tax-doc-compare__group--client">
              <h3 className="tax-doc-compare__group-title">{block.client}</h3>
              <p className="tax-doc-compare__client-years">
                Years:{" "}
                {block.years.map((y) => (y == null ? "—" : String(y))).join(", ") || "—"}
              </p>
              <div className="tax-doc-compare__table-wrap">
                <table className="tax-doc-compare__table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      {block.years.map((y, i) => (
                        <th key={`${block.client}-y-${i}`}>{y == null ? `Slot ${i + 1}` : y}</th>
                      ))}
                      <th>Trend</th>
                      <th>Avg growth %</th>
                      <th>Δ first→last</th>
                      <th>% change</th>
                      <th>Anomaly</th>
                    </tr>
                  </thead>
                  <tbody>
                    {block.fields.map((f) => {
                      const fr = f && typeof f === "object" && !Array.isArray(f) ? /** @type {Record<string, unknown>} */ (f) : {};
                      const vals = Array.isArray(fr.values) ? fr.values : [];
                      return (
                        <tr key={`${block.client}-${String(fr.fieldId)}-${String(fr.sourceFieldId)}`} className={fr.anomaly === true ? "tax-doc-compare__row--anomaly" : ""}>
                          <td>{String(fr.label ?? "")}</td>
                          {vals.map((v, i) => (
                            <td key={`v-${i}`}>{v == null ? "—" : String(v)}</td>
                          ))}
                          <td>{String(fr.trend ?? "")}</td>
                          <td>{fr.avgGrowth == null ? "—" : `${fr.avgGrowth}%`}</td>
                          <td>{fr.delta == null ? "—" : String(fr.delta)}</td>
                          <td>{fr.percentChange == null ? "—" : `${fr.percentChange}%`}</td>
                          <td>
                            {fr.anomaly === true ? (
                              <span className="tax-doc-compare__anomaly" title={String(fr.message ?? "")}>
                                {String(fr.message ?? "")}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        : null}

      {viewMode === "documents" && orderedFieldIds.length > 0
        ? groupOrder.map((g) => {
            const fids = byGroup[g];
            if (!fids || fids.length === 0) return null;
            const colCount = paths.length > 0 ? paths.length : draft[fids[0]]?.values.length ?? 0;
            return (
              <div key={g} className="tax-doc-compare__group">
                <h3 className="tax-doc-compare__group-title">{g}</h3>
                <div className="tax-doc-compare__table-wrap">
                  <table className="tax-doc-compare__table">
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Map to</th>
                        {Array.from({ length: colCount }, (_, i) => (
                          <th key={`d${i}`}>Doc {i + 1}</th>
                        ))}
                        <th>Trend</th>
                        <th>Avg growth %</th>
                        <th>Δ first→last</th>
                        <th>% change</th>
                        <th>Anomaly</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {fids.map((fid) => {
                        const row = rowByFieldId[fid];
                        if (!row) return null;
                        const d = draft[fid] ?? {
                          values: Array.isArray(row.values)
                            ? row.values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null))
                            : [],
                          mapToFieldId: fid,
                        };
                        const vals = d.values;
                        const { trend, avgGrowth } = computeTrendAndAvgGrowth(vals);
                        const { anomaly, message } = detectSeriesAnomaly(vals, anomalyThreshold);
                        const { delta, percentChange } = (() => {
                          const fi = vals.findIndex((x) => x != null);
                          const li = vals.length - 1 - [...vals].reverse().findIndex((x) => x != null);
                          if (fi === -1 || li === -1 || fi === li) return { delta: null, percentChange: null };
                          const a = vals[fi];
                          const b = vals[li];
                          if (a == null || b == null) return { delta: null, percentChange: null };
                          return {
                            delta: Number((b - a).toFixed(4)),
                            percentChange: a === 0 ? null : Number((((b - a) / a) * 100).toFixed(4)),
                          };
                        })();
                        const isOpen = expanded[fid] === true;
                        const lbl = rowLabel(row);
                        return (
                          <tr key={fid} className={anomaly ? "tax-doc-compare__row--anomaly" : ""}>
                            <td>{lbl}</td>
                            <td>
                              <select
                                className="tax-doc-compare__select"
                                value={d.mapToFieldId}
                                onChange={(e) => onRemap(fid, e.target.value)}
                                aria-label={`Map ${lbl} to field`}
                              >
                                {fieldIds.map((id) => (
                                  <option key={id} value={id}>
                                    {taxFieldDisplayLabel(id)}
                                  </option>
                                ))}
                              </select>
                            </td>
                            {Array.from({ length: colCount }, (_, i) => {
                              const v = vals[i] ?? null;
                              return (
                                <td key={`c${fid}-${i}`}>
                                  <input
                                    className="tax-doc-compare__cell-input"
                                    type="text"
                                    inputMode="decimal"
                                    value={v == null ? "" : String(v)}
                                    onChange={(e) => onCellChange(fid, i, e.target.value)}
                                    aria-label={`${lbl} doc ${i + 1}`}
                                  />
                                </td>
                              );
                            })}
                            <td>{trend}</td>
                            <td>{avgGrowth == null ? "—" : `${avgGrowth}%`}</td>
                            <td>{delta == null ? "—" : String(delta)}</td>
                            <td>{percentChange == null ? "—" : `${percentChange}%`}</td>
                            <td>
                              {anomaly ? (
                                <span className="tax-doc-compare__anomaly" title={message}>
                                  {message}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-secondary tax-doc-compare__expand"
                                onClick={() => setExpanded((prev) => ({ ...prev, [fid]: !isOpen }))}
                              >
                                {isOpen ? "Hide" : "Source"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {fids.map((fid) => {
                  if (expanded[fid] !== true) return null;
                  const row = rowByFieldId[fid];
                  if (!row) return null;
                  const docs = Array.isArray(row.documents) ? row.documents : [];
                  const lines = docs.map((doc, i) => {
                    const rec = doc && typeof doc === "object" && !Array.isArray(doc) ? /** @type {Record<string, unknown>} */ (doc) : {};
                    const t = String(rec.sourceText ?? "");
                    return `Doc ${i + 1}: ${t}`;
                  });
                  return (
                    <div key={`${fid}-detail`} className="tax-doc-compare__detail">
                      <strong>{rowLabel(row)}</strong>
                      <pre className="tax-doc-compare__source">{lines.join("\n\n")}</pre>
                    </div>
                  );
                })}
              </div>
            );
          })
        : null}
    </section>
  );
}

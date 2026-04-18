import { useCallback, useEffect, useMemo, useState } from "react";
import ReasoningPanel from "./ReasoningPanel.jsx";
import CapabilityResultTree, { copyCapabilityValue } from "./CapabilityResultTree.jsx";
import {
  fetchAppliedCapabilityByRowId,
  persistAppliedCapabilityRecord,
  previewCapabilityRow,
  recordCapabilityOverride,
} from "../clairaApiClient.js";
import { stablePipelineRowId } from "../utils/pipelineRowId.js";
import { listDomainIds } from "../../workflow/modules/capabilities/domainRegistry.js";
import TaxDocumentComparePanel from "./TaxDocumentComparePanel.jsx";

/**
 * @param {unknown} row
 * @returns {Record<string, unknown> | null}
 */
function asRecord(row) {
  return row != null && typeof row === "object" && !Array.isArray(row) ? /** @type {Record<string, unknown>} */ (row) : null;
}

/**
 * @param {unknown} row
 */
function rowLabel(row, index) {
  const rec = asRecord(row);
  if (!rec) return `Row ${index + 1}`;
  const rel = rec.rel ?? rec.filePath ?? rec.relPath;
  if (typeof rel === "string" && rel.trim()) return rel.trim();
  return `Row ${index + 1}`;
}

/**
 * @param {unknown[]} rows
 */
function collectFileListFromRows(rows) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const r = asRecord(row);
    const fp = typeof r?.filePath === "string" ? r.filePath.trim() : "";
    if (fp && !seen.has(fp)) {
      seen.add(fp);
      out.push(fp);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * @param {Record<string, unknown>} obj
 */
function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return JSON.stringify(obj);
  const keys = Object.keys(obj).sort();
  /** @type {Record<string, unknown>} */
  const sorted = {};
  for (const k of keys) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

/**
 * @param {unknown} row
 */
function capabilitySummary(row) {
  const rec = asRecord(row);
  const cap = rec?.capabilityResult;
  if (cap == null || typeof cap !== "object" || Array.isArray(cap)) return "—";
  const c = /** @type {Record<string, unknown>} */ (cap);
  const planSteps = c.planSteps;
  if (Array.isArray(planSteps) && planSteps.length > 0) {
    const chain = planSteps
      .map((s) =>
        s != null && typeof s === "object" && !Array.isArray(s) && typeof /** @type {{ moduleId?: string }} */ (s).moduleId === "string"
          ? /** @type {{ moduleId?: string }} */ (s).moduleId
          : "?",
      )
      .join(" → ");
    return `${planSteps.length}-step plan: ${chain}`;
  }
  const res = c.result;
  if (res != null && typeof res === "object" && !Array.isArray(res)) {
    const r = /** @type {Record<string, unknown>} */ (res);
    if (typeof r.summary === "string") return r.summary;
    if (typeof r.diffSummary === "string") return r.diffSummary;
  }
  if (typeof res === "string") return res;
  if (c.moduleId == null) return String(c.explanation ?? "No capability matched.");
  return "—";
}

/**
 * @param {unknown} row
 */
function capabilityStatus(row) {
  const rec = asRecord(row);
  const cap = rec?.capabilityResult;
  if (cap == null || typeof cap !== "object" || Array.isArray(cap)) return { kind: "empty", label: "—" };
  const c = /** @type {Record<string, unknown>} */ (cap);
  if (c.moduleId == null) return { kind: "skip", label: "None" };
  const res = c.result;
  if (res != null && typeof res === "object" && !Array.isArray(res) && res.error === true) {
    return { kind: "error", label: "Error" };
  }
  return { kind: "ok", label: "OK" };
}

/**
 * @template T
 * @param {T} suggested
 * @param {T | null | undefined} userOverride
 */
function triple(suggested, userOverride) {
  const final = userOverride ?? suggested;
  return { suggested, userOverride: userOverride ?? null, final };
}

const EDITABLE_MODULES = new Set(["smart_rename", "tagging", "folder_structure", "review"]);
const MULTI_FILE_MODULES = new Set(["image_diff", "asset_deduplication", "batch_processor"]);

/**
 * @param {{
 *   pipelineRows: unknown[],
 *   capabilityDomainMode?: string,
 *   onCapabilityDomainModeChange?: (v: string) => void,
 *   capabilityPlanMode?: "single" | "planned",
 *   onCapabilityPlanModeChange?: (v: "single" | "planned") => void,
 * }} props
 */
export default function CapabilitySessionPanel({
  pipelineRows,
  capabilityDomainMode = "general",
  onCapabilityDomainModeChange,
  capabilityPlanMode = "single",
  onCapabilityPlanModeChange,
}) {
  const rows = Array.isArray(pipelineRows) ? pipelineRows : [];
  const rowsSignature = useMemo(
    () => rows.map((r, i) => `${i}:${String(asRecord(r)?.filePath ?? asRecord(r)?.rel ?? "")}`).join("|"),
    [rows],
  );
  const [selectedIndex, setSelectedIndex] = useState(/** @type {number | null} */ (null));
  const [overridesByRow, setOverridesByRow] = useState(
    /** @returns {Record<number, { filename?: string | null, tags?: string[] | null, folderPath?: string | null, reviewRequires?: boolean | null }>} */
    () => ({}),
  );
  /** @type {[Record<string, unknown>, React.Dispatch<React.SetStateAction<Record<string, unknown>>>]} */
  const [appliedByRowId, setAppliedByRowId] = useState(() => ({}));
  /** @type {[unknown[], React.Dispatch<React.SetStateAction<unknown[]>>]} */
  const [sessionAppliedResults, setSessionAppliedResults] = useState(() => []);
  /** @type {[null | { rowId: string, rowIndex: number, moduleId: string, originalValues: Record<string, unknown>, finalValues: Record<string, unknown>, changes: Array<{ field: string, from: string, to: string }> }, function]} */
  const [applyModal, setApplyModal] = useState(() => /** @type {null | {
    rowId: string,
    rowIndex: number,
    moduleId: string,
    originalValues: Record<string, unknown>,
    finalValues: Record<string, unknown>,
    changes: Array<{ field: string, from: string, to: string }>,
  }} */ (null));

  /** Per-row session input overrides for multi-file capabilities */
  const [sessionInputsByRow, setSessionInputsByRow] = useState(
    /** @returns {Record<number, { primaryFile: string, secondaryFile: string, fileList: string[] }>} */
    () => ({}),
  );
  /** @type {[null | Record<string, unknown>, function]} */
  const [previewCapability, setPreviewCapability] = useState(() => /** @type {null | Record<string, unknown>} */ (null));
  const [previewBusy, setPreviewBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const m = await fetchAppliedCapabilityByRowId();
      if (!cancelled) setAppliedByRowId(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [rowsSignature]);

  useEffect(() => {
    if (selectedIndex !== null && selectedIndex >= rows.length) setSelectedIndex(null);
  }, [rows.length, selectedIndex]);

  useEffect(() => {
    const list = collectFileListFromRows(rows);
    setSessionInputsByRow((prev) => {
      const next = { ...prev };
      for (let i = 0; i < rows.length; i++) {
        const r = asRecord(rows[i]);
        const cap = r?.capabilityResult;
        const mid =
          cap != null && typeof cap === "object" && !Array.isArray(cap)
            ? /** @type {Record<string, unknown>} */ (cap).moduleId
            : null;
        if (typeof mid !== "string" || !MULTI_FILE_MODULES.has(mid)) continue;
        if (next[i]) continue;
        const primary = typeof r?.filePath === "string" ? r.filePath.trim() : list[0] ?? "";
        const nr = asRecord(rows[i + 1]);
        const secondary = typeof nr?.filePath === "string" ? nr.filePath.trim() : list[1] ?? "";
        next[i] = { primaryFile: primary, secondaryFile: secondary, fileList: [...list] };
      }
      return next;
    });
  }, [rows]);

  useEffect(() => {
    setPreviewCapability(null);
  }, [selectedIndex]);

  const selectedRow = selectedIndex !== null ? rows[selectedIndex] : null;
  const selectedRec = asRecord(selectedRow);
  const capRaw =
    selectedRec?.capabilityResult != null &&
    typeof selectedRec.capabilityResult === "object" &&
    !Array.isArray(selectedRec.capabilityResult)
      ? /** @type {Record<string, unknown>} */ (selectedRec.capabilityResult)
      : null;

  const moduleId = capRaw && typeof capRaw.moduleId === "string" ? capRaw.moduleId : null;
  const rawResult =
    capRaw?.result != null && typeof capRaw.result === "object" && !Array.isArray(capRaw.result)
      ? /** @type {Record<string, unknown>} */ (capRaw.result)
      : null;

  const o = selectedIndex != null ? overridesByRow[selectedIndex] : undefined;
  const rowId = selectedIndex !== null ? stablePipelineRowId(rows[selectedIndex], selectedIndex) : "";
  const appliedRecord =
    rowId && appliedByRowId[rowId] != null && typeof appliedByRowId[rowId] === "object"
      ? /** @type {Record<string, unknown>} */ (appliedByRowId[rowId])
      : null;
  const isApplied = Boolean(appliedRecord);

  const patchOverride = useCallback((idx, patch) => {
    setOverridesByRow((prev) => ({
      ...prev,
      [idx]: { ...prev[idx], ...patch },
    }));
  }, []);

  const filenameTriple = useMemo(() => {
    const suggested = typeof rawResult?.suggestedFilename === "string" ? rawResult.suggestedFilename : "";
    return triple(suggested, o?.filename ?? null);
  }, [rawResult, o?.filename]);

  const tagsTriple = useMemo(() => {
    const suggested = Array.isArray(rawResult?.suggestedTags)
      ? /** @type {unknown[]} */ (rawResult.suggestedTags).map(String)
      : Array.isArray(rawResult?.tags)
        ? /** @type {unknown[]} */ (rawResult.tags).map(String)
        : [];
    const userOverride = o?.tags !== undefined ? o.tags : null;
    return triple(suggested, userOverride);
  }, [rawResult, o?.tags]);

  const folderTriple = useMemo(() => {
    const suggested = typeof rawResult?.suggestedFolderPath === "string" ? rawResult.suggestedFolderPath : "";
    return triple(suggested, o?.folderPath ?? null);
  }, [rawResult, o?.folderPath]);

  const reviewTriple = useMemo(() => {
    const suggested = typeof rawResult?.requiresReview === "boolean" ? rawResult.requiresReview : false;
    return triple(suggested, o?.reviewRequires !== undefined ? o.reviewRequires : null);
  }, [rawResult, o?.reviewRequires]);

  const sessionInput = selectedIndex !== null ? sessionInputsByRow[selectedIndex] : null;

  const defaultSessionInputForIndex = useCallback(
    (i) => {
      const list = collectFileListFromRows(rows);
      const r = asRecord(rows[i]);
      const primary = typeof r?.filePath === "string" ? r.filePath.trim() : list[0] ?? "";
      const nr = asRecord(rows[i + 1]);
      const secondary = typeof nr?.filePath === "string" ? nr.filePath.trim() : list[1] ?? "";
      return { primaryFile: primary, secondaryFile: secondary, fileList: [...list] };
    },
    [rows],
  );

  const originalValues = useMemo(() => {
    if (!moduleId || !rawResult) return /** @type {Record<string, unknown>} */ ({});
    /** @type {Record<string, unknown>} */
    const orig = {};
    if (moduleId === "smart_rename") orig.filename = filenameTriple.suggested;
    if (moduleId === "tagging") orig.tags = [...tagsTriple.suggested];
    if (moduleId === "folder_structure") orig.folderPath = folderTriple.suggested;
    if (moduleId === "review") orig.requiresReview = reviewTriple.suggested;
    return orig;
  }, [moduleId, rawResult, filenameTriple.suggested, tagsTriple.suggested, folderTriple.suggested, reviewTriple.suggested]);

  const finalValues = useMemo(() => {
    if (!moduleId || !rawResult) return /** @type {Record<string, unknown>} */ ({});
    /** @type {Record<string, unknown>} */
    const fin = { ...originalValues };
    if (moduleId === "smart_rename") fin.filename = filenameTriple.final;
    if (moduleId === "tagging") fin.tags = [...tagsTriple.final];
    if (moduleId === "folder_structure") fin.folderPath = folderTriple.final;
    if (moduleId === "review") fin.requiresReview = reviewTriple.final;
    if (moduleId && MULTI_FILE_MODULES.has(moduleId) && sessionInput) {
      fin.sessionInputs = {
        primaryFile: sessionInput.primaryFile,
        secondaryFile: sessionInput.secondaryFile,
        fileList: [...sessionInput.fileList],
      };
    }
    return fin;
  }, [moduleId, rawResult, originalValues, filenameTriple.final, tagsTriple.final, folderTriple.final, reviewTriple.final, sessionInput]);

  const hasEditablePending = useMemo(() => {
    if (!moduleId || !EDITABLE_MODULES.has(moduleId) || !rawResult || isApplied) return false;
    const base = { ...originalValues };
    const fin = { ...finalValues };
    delete fin.sessionInputs;
    delete base.sessionInputs;
    return stableStringify(base) !== stableStringify(fin);
  }, [moduleId, rawResult, originalValues, finalValues, isApplied]);

  const hasMultiFileTweak = useMemo(() => {
    if (selectedIndex === null || !moduleId || !MULTI_FILE_MODULES.has(moduleId) || !sessionInput || isApplied) return false;
    const def = defaultSessionInputForIndex(selectedIndex);
    if (sessionInput.primaryFile !== def.primaryFile) return true;
    if (sessionInput.secondaryFile !== def.secondaryFile) return true;
    if (stableStringify([...sessionInput.fileList].sort()) !== stableStringify([...def.fileList].sort())) return true;
    return false;
  }, [moduleId, sessionInput, rows, selectedIndex, isApplied, defaultSessionInputForIndex]);

  const rowHasPending = useCallback(
    (i) => {
      const rid = stablePipelineRowId(rows[i], i);
      if (appliedByRowId[rid]) return false;
      const rec = asRecord(rows[i]);
      const cap = rec?.capabilityResult;
      const mid =
        cap != null && typeof cap === "object" && !Array.isArray(cap)
          ? /** @type {Record<string, unknown>} */ (cap).moduleId
          : null;
      const midStr = typeof mid === "string" ? mid : null;
      if (midStr && MULTI_FILE_MODULES.has(midStr)) {
        const si = sessionInputsByRow[i];
        if (si) {
          const def = defaultSessionInputForIndex(i);
          if (si.primaryFile !== def.primaryFile || si.secondaryFile !== def.secondaryFile) return true;
          if (stableStringify([...si.fileList].sort()) !== stableStringify([...def.fileList].sort())) return true;
        }
      }
      if (!midStr || !EDITABLE_MODULES.has(midStr)) return false;
      const ovr = overridesByRow[i];
      if (!ovr) return false;
      if (ovr.filename != null) return true;
      if (ovr.folderPath != null) return true;
      if (ovr.tags !== undefined && ovr.tags !== null) return true;
      if (ovr.reviewRequires !== undefined && ovr.reviewRequires !== null) return true;
      return false;
    },
    [rows, appliedByRowId, overridesByRow, sessionInputsByRow, defaultSessionInputForIndex],
  );

  const [tagInput, setTagInput] = useState("");

  const openApplyModal = useCallback(() => {
    if (selectedIndex === null || !moduleId) return;
    /** @type {Array<{ field: string, from: string, to: string }>} */
    const changes = [];
    /** @type {Record<string, unknown>} */
    const orig = {};
    /** @type {Record<string, unknown>} */
    const fin = {};

    if (rawResult && EDITABLE_MODULES.has(moduleId)) {
      if (moduleId === "smart_rename" && originalValues.filename !== finalValues.filename) {
        changes.push({ field: "filename", from: String(originalValues.filename ?? ""), to: String(finalValues.filename ?? "") });
      }
      if (moduleId === "tagging" && stableStringify(originalValues.tags) !== stableStringify(finalValues.tags)) {
        changes.push({
          field: "tags",
          from: JSON.stringify(originalValues.tags ?? []),
          to: JSON.stringify(finalValues.tags ?? []),
        });
      }
      if (moduleId === "folder_structure" && originalValues.folderPath !== finalValues.folderPath) {
        changes.push({
          field: "folderPath",
          from: String(originalValues.folderPath ?? ""),
          to: String(finalValues.folderPath ?? ""),
        });
      }
      if (moduleId === "review" && originalValues.requiresReview !== finalValues.requiresReview) {
        changes.push({
          field: "requiresReview",
          from: String(originalValues.requiresReview),
          to: String(finalValues.requiresReview),
        });
      }
      Object.assign(orig, JSON.parse(JSON.stringify(originalValues)));
      Object.assign(fin, JSON.parse(JSON.stringify(finalValues)));
    }

    if (MULTI_FILE_MODULES.has(moduleId) && hasMultiFileTweak && sessionInput) {
      const def = defaultSessionInputForIndex(selectedIndex);
      changes.push({
        field: "sessionInputs",
        from: JSON.stringify(def),
        to: JSON.stringify({
          primaryFile: sessionInput.primaryFile,
          secondaryFile: sessionInput.secondaryFile,
          fileList: sessionInput.fileList,
        }),
      });
      orig.sessionInputs = def;
      fin.sessionInputs = {
        primaryFile: sessionInput.primaryFile,
        secondaryFile: sessionInput.secondaryFile,
        fileList: [...sessionInput.fileList],
      };
    }

    if (changes.length === 0) return;
    setApplyModal({
      rowId,
      rowIndex: selectedIndex,
      moduleId,
      originalValues: orig,
      finalValues: fin,
      changes,
    });
  }, [
    selectedIndex,
    moduleId,
    rawResult,
    rowId,
    originalValues,
    finalValues,
    hasMultiFileTweak,
    sessionInput,
    defaultSessionInputForIndex,
  ]);

  const confirmApply = useCallback(async () => {
    if (!applyModal) return;
    const ts = Date.now();
    const simulation = {
      dryRun: true,
      note: "No filesystem writes — simulated apply only.",
      changes: applyModal.changes,
    };
    const record = {
      rowId: applyModal.rowId,
      moduleId: applyModal.moduleId,
      originalValues: applyModal.originalValues,
      finalValues: applyModal.finalValues,
      timestamp: ts,
      simulation,
    };
    const persist = await persistAppliedCapabilityRecord(record);
    if (!persist.ok) {
      console.warn("[CapabilitySessionPanel] persist failed:", persist);
      return;
    }
    const fb = await recordCapabilityOverride({
      rowId: applyModal.rowId,
      moduleId: applyModal.moduleId,
      originalValues: applyModal.originalValues,
      finalValues: applyModal.finalValues,
      filename: rowLabel(rows[applyModal.rowIndex], applyModal.rowIndex),
      timestamp: ts,
    });
    if (fb && typeof fb === "object" && fb.ok === false) {
      console.warn("[CapabilitySessionPanel] feedbackStore signal failed:", fb);
    }
    setSessionAppliedResults((prev) => [...prev, record]);
    setAppliedByRowId((prev) => ({ ...prev, [applyModal.rowId]: record }));
    setOverridesByRow((prev) => {
      const next = { ...prev };
      delete next[applyModal.rowIndex];
      return next;
    });
    setApplyModal(null);
  }, [applyModal, rows]);

  const runPreview = useCallback(async () => {
    if (selectedIndex === null || !sessionInput) return;
    setPreviewBusy(true);
    try {
      const data = await previewCapabilityRow({
        row: selectedRow,
        rowIndex: selectedIndex,
        allRows: rows,
        inputOverrides: {
          primaryFile: sessionInput.primaryFile,
          secondaryFile: sessionInput.secondaryFile,
          fileList: sessionInput.fileList,
        },
      });
      const cap = data && typeof data === "object" && data.capability != null ? data.capability : null;
      setPreviewCapability(cap && typeof cap === "object" ? /** @type {Record<string, unknown>} */ (cap) : null);
    } finally {
      setPreviewBusy(false);
    }
  }, [selectedIndex, sessionInput, selectedRow, rows]);

  const allFiles = useMemo(() => collectFileListFromRows(rows), [rows]);

  return (
    <section aria-labelledby="workflow-session-pipeline-heading" style={{ marginTop: "1.5rem" }}>
      <h2 id="workflow-session-pipeline-heading" style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 0.65rem" }}>
        Last session — pipeline
      </h2>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "flex-end",
          marginBottom: "0.75rem",
          padding: "0.5rem 0",
          borderBottom: "1px solid var(--border-default, #e5e7eb)",
        }}
      >
        <label style={{ fontSize: "0.78rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
          Domain mode (next run)
          <select
            value={capabilityDomainMode}
            onChange={(e) => onCapabilityDomainModeChange?.(e.target.value)}
            style={{ fontSize: "0.85rem", padding: "0.35rem 0.5rem", minWidth: 140 }}
          >
            {listDomainIds().map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: "0.78rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
          Capability execution
          <select
            value={capabilityPlanMode}
            onChange={(e) =>
              onCapabilityPlanModeChange?.(e.target.value === "planned" ? "planned" : "single")
            }
            style={{ fontSize: "0.85rem", padding: "0.35rem 0.5rem", minWidth: 200 }}
          >
            <option value="single">Single module (intent selection)</option>
            <option value="planned">Planned chain (domain + planner)</option>
          </select>
        </label>
        <span style={{ fontSize: "0.72rem", color: "var(--text-muted, #6b7280)", maxWidth: 280 }}>
          Domain and plan mode apply when you process a new batch from the home screen.
        </span>
      </div>

      {capabilityDomainMode === "tax" ? <TaxDocumentComparePanel /> : null}

      {sessionAppliedResults.length > 0 ? (
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted, #6b7280)", marginBottom: "0.5rem" }}>
          Applied (this session): {sessionAppliedResults.length} record(s). Persists server-side or localStorage fallback.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted, #6b7280)" }}>
          No pipeline rows in memory yet. Run a processing session from the home screen, then return here.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
            gap: "1rem",
            alignItems: "start",
          }}
        >
          <div>
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted, #6b7280)", margin: "0 0 0.5rem" }}>
              Execution order — select a row. <strong>Edited</strong> = unapplied changes; <strong>Applied</strong> = confirmed              dry-run.
            </p>
            <ol style={{ margin: 0, paddingLeft: "1.1rem" }}>
              {rows.map((row, i) => {
                const st = capabilityStatus(row);
                const sum = capabilitySummary(row);
                const rid = stablePipelineRowId(row, i);
                const applied = appliedByRowId[rid] != null;
                const pending = rowHasPending(i);
                const mid =
                  (() => {
                    const r = asRecord(row);
                    const c = r?.capabilityResult;
                    if (c != null && typeof c === "object" && !Array.isArray(c)) {
                      const id = /** @type {Record<string, unknown>} */ (c).moduleId;
                      return typeof id === "string" ? id : "—";
                    }
                    return "—";
                  })();
                const rowRec = asRecord(row);
                const rowCap = rowRec?.capabilityResult;
                const rowPlanSteps =
                  rowCap != null && typeof rowCap === "object" && !Array.isArray(rowCap) && Array.isArray(rowCap.planSteps)
                    ? rowCap.planSteps
                    : null;
                const rowDm = typeof rowRec?.capabilityDomainMode === "string" ? rowRec.capabilityDomainMode : null;
                const active = selectedIndex === i;
                return (
                  <li key={`pipe-${i}`} style={{ marginBottom: "0.45rem" }}>
                    <button
                      type="button"
                      onClick={() => setSelectedIndex(i)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: "0.5rem",
                        alignItems: "start",
                        padding: "0.45rem 0.5rem",
                        borderRadius: 6,
                        border: active ? "2px solid var(--link, #2563eb)" : "1px solid var(--border-default, #e5e7eb)",
                        background: applied
                          ? "rgba(21,128,61,0.08)"
                          : pending
                            ? "rgba(180,83,9,0.08)"
                            : active
                              ? "var(--surface-elevated, rgba(37,99,235,0.06))"
                              : "transparent",
                        cursor: "pointer",
                        font: "inherit",
                      }}
                    >
                      <span
                        title={st.label}
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          color:
                            st.kind === "ok"
                              ? "var(--success, #15803d)"
                              : st.kind === "error"
                                ? "var(--danger, #b91c1c)"
                                : st.kind === "skip"
                                  ? "var(--text-muted, #6b7280)"
                                  : "var(--text-muted, #6b7280)",
                        }}
                      >
                        {st.kind === "ok" ? "●" : st.kind === "error" ? "\u2715" : "○"}
                      </span>
                      <span>
                        <span style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
                          <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>
                            <code>{mid}</code>
                          </span>
                          {applied ? (
                            <span
                              style={{
                                fontSize: "0.65rem",
                                fontWeight: 700,
                                color: "var(--success, #15803d)",
                                textTransform: "uppercase",
                              }}
                            >
                              Applied
                            </span>
                          ) : null}
                          {pending ? (
                            <span
                              style={{
                                fontSize: "0.65rem",
                                fontWeight: 700,
                                color: "var(--warning-foreground, #b45309)",
                                textTransform: "uppercase",
                              }}
                            >
                              Edited
                            </span>
                          ) : null}
                        </span>
                        <span style={{ display: "block", fontSize: "0.78rem", color: "var(--text-muted, #6b7280)" }}>
                          {rowLabel(row, i)}
                          {rowDm ? (
                            <span style={{ marginLeft: "0.35rem" }}>
                              · domain: <code>{rowDm}</code>
                            </span>
                          ) : null}
                        </span>
                        <span style={{ display: "block", fontSize: "0.8rem", marginTop: "0.2rem" }}>{sum}</span>
                        {rowPlanSteps && rowPlanSteps.length > 0 ? (
                          <ul                            style={{
                              margin: "0.35rem 0 0",
                              paddingLeft: "1rem",
                              fontSize: "0.72rem",
                              color: "var(--text-muted, #6b7280)",
                              listStyle: "disc",
                            }}
                          >
                            {rowPlanSteps.map((st) => {
                              if (st == null || typeof st !== "object" || Array.isArray(st)) return null;
                              const ps = /** @type {{ step?: number, moduleId?: string }} */ (st);
                              return (
                                <li key={`${i}-${ps.step}-${ps.moduleId}`}>
                                  Step {ps.step}: <code>{ps.moduleId ?? "—"}</code>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          <div
            style={{
              position: "sticky",
              top: "0.5rem",
              border: "1px solid var(--border-default, #e5e7eb)",
              borderRadius: 8,
              padding: "0.75rem",
              minHeight: 120,
              background: "var(--surface-panel, rgba(0,0,0,0.02))",
            }}
          >
            {selectedIndex === null ? (
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted, #6b7280)", margin: 0 }}>
                Select a row in the timeline to view full capability output and Claira reasoning.
              </p>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.65rem", flexWrap: "wrap", gap: "0.5rem" }}>
                  <h3 style={{ margin: 0, fontSize: "0.9rem" }}>Row {selectedIndex + 1} detail</h3>
                  <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                    {isApplied ? (
                      <span style={{ fontSize: "0.75rem", color: "var(--success, #15803d)", fontWeight: 600 }}>Applied (locked)</span>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: "0.75rem" }}
                      onClick={() => {
                        if (capRaw) copyCapabilityValue(capRaw);
                      }}
                    >
                      Copy capability JSON
                    </button>
                  </div>
                </div>

                {isApplied && appliedRecord ? (
                  <div
                    style={{
                      marginBottom: "0.75rem",
                      padding: "0.5rem",
                      borderRadius: 6,
                      background: "rgba(21,128,61,0.06)",
                      fontSize: "0.8rem",
                    }}
                  >
                    <strong>Stored apply</strong> · {new Date(/** @type {number} */ (appliedRecord.timestamp)).toLocaleString()}
                    <CapabilityResultTree value={appliedRecord.finalValues ?? {}} />
                  </div>
                ) : null}

                <div style={{ marginBottom: "1rem" }}>
                  <ReasoningPanel rowKey={String(selectedIndex)} pipelineRow={selectedRow} />
                </div>

                {capRaw && Array.isArray(capRaw.planSteps) && capRaw.planSteps.length > 0 ? (
                  <div style={{ marginBottom: "1rem", paddingBottom: "0.75rem", borderBottom: "1px solid var(--border-default, #e5e7eb)" }}>
                    <h4 style={{ fontSize: "0.82rem", margin: "0 0 0.5rem" }}>Planned steps</h4>
                    {capRaw.planSteps.map((st) => {
                      if (st == null || typeof st !== "object" || Array.isArray(st)) return null;
                      const ps = /** @type {{ step?: number, moduleId?: string, result?: unknown }} */ (st);
                      const pk = `${selectedIndex}-${ps.step}-${ps.moduleId}`;
                      return (
                        <details key={pk} style={{ marginBottom: "0.45rem" }}>
                          <summary style={{ cursor: "pointer", fontSize: "0.82rem" }}>
                            <strong>Step {ps.step ?? "?"}</strong> · <code>{ps.moduleId ?? "—"}</code>
                          </summary>
                          <div style={{ marginTop: "0.35rem", fontSize: "0.85rem" }}>
                            <CapabilityResultTree value={ps.result} />
                          </div>
                        </details>
                      );
                    })}
                  </div>
                ) : null}

                {moduleId && MULTI_FILE_MODULES.has(moduleId) && sessionInput && !isApplied ? (
                  <div
                    style={{
                      marginBottom: "1rem",
                      paddingBottom: "0.75rem",
                      borderBottom: "1px solid var(--border-default, #e5e7eb)",
                    }}
                  >
                    <h4 style={{ fontSize: "0.82rem", margin: "0 0 0.5rem" }}>Session file inputs</h4>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted, #6b7280)", margin: "0 0 0.5rem" }}>
                      Choose paths for {moduleId === "image_diff" ? "primary vs secondary" : "file list"} (updates preview only until
                      you Apply).
                    </p>
                    {moduleId === "image_diff" ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                        <label style={{ fontSize: "0.78rem" }}>
                          primaryFile
                          <select
                            value={sessionInput.primaryFile}
                            onChange={(e) =>
                              setSessionInputsByRow((p) => ({
                                ...p,
                                [selectedIndex]: { ...p[selectedIndex], primaryFile: e.target.value },
                              }))
                            }
                            style={{ display: "block", width: "100%", marginTop: "0.2rem", fontSize: "0.85rem" }}
                          >
                            {allFiles.map((f) => (
                              <option key={`p-${f}`} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label style={{ fontSize: "0.78rem" }}>
                          secondaryFile
                          <select
                            value={sessionInput.secondaryFile}
                            onChange={(e) =>
                              setSessionInputsByRow((p) => ({
                                ...p,
                                [selectedIndex]: { ...p[selectedIndex], secondaryFile: e.target.value },
                              }))
                            }
                            style={{ display: "block", width: "100%", marginTop: "0.2rem", fontSize: "0.85rem" }}
                          >
                            {allFiles.map((f) => (
                              <option key={`s-${f}`} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: "1rem", listStyle: "none", maxHeight: 160, overflow: "auto" }}>
                        {allFiles.map((f) => (
                          <li key={f} style={{ marginBottom: "0.25rem" }}>
                            <label style={{ fontSize: "0.8rem", display: "flex", gap: "0.35rem", alignItems: "center" }}>
                              <input
                                type="checkbox"
                                checked={sessionInput.fileList.includes(f)}
                                onChange={() => {
                                  setSessionInputsByRow((p) => {
                                    const cur = p[selectedIndex] ?? sessionInput;
                                    const set = new Set(cur.fileList);
                                    if (set.has(f)) set.delete(f);
                                    else set.add(f);
                                    return {
                                      ...p,
                                      [selectedIndex]: { ...cur, fileList: [...set].sort((a, b) => a.localeCompare(b)) },
                                    };
                                  });
                                }}
                              />
                              <span style={{ wordBreak: "break-all" }}>{f}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-secondary" disabled={previewBusy} onClick={() => void runPreview()}>
                        {previewBusy ? "Preview…" : "Preview capability with selected inputs"}
                      </button>
                    </div>
                    {previewCapability ? (
                      <div style={{ marginTop: "0.65rem", fontSize: "0.82rem" }}>
                        <strong>Preview result</strong> (not persisted)
                        <CapabilityResultTree value={previewCapability.result ?? previewCapability} />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <h4 style={{ fontSize: "0.82rem", margin: "0 0 0.35rem" }}>Capability result (full)</h4>
                {capRaw ? (
                  <div style={{ fontSize: "0.85rem", lineHeight: 1.45 }}>
                    <p style={{ margin: "0 0 0.35rem" }}>
                      <strong>moduleId:</strong> <code>{moduleId ?? "—"}</code>
                    </p>
                    {typeof capRaw.confidence === "number" ? (
                      <p style={{ margin: "0 0 0.35rem" }}>
                        <strong>confidence:</strong> {capRaw.confidence}
                      </p>
                    ) : null}
                    {typeof capRaw.explanation === "string" ? (
                      <p style={{ margin: "0 0 0.5rem", fontSize: "0.82rem", color: "var(--text-muted, #6b7280)" }}>
                        {capRaw.explanation}
                      </p>
                    ) : null}
                    <p style={{ margin: "0 0 0.35rem", fontWeight: 600 }}>result</p>
                    <CapabilityResultTree value={capRaw.result} />
                  </div>
                ) : (
                  <p style={{ fontSize: "0.82rem" }}>—</p>
                )}

                {moduleId && !isApplied && (EDITABLE_MODULES.has(moduleId) || MULTI_FILE_MODULES.has(moduleId)) ? (
                  <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!hasEditablePending && !hasMultiFileTweak}
                      onClick={openApplyModal}
                    >
                      Apply changes
                    </button>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-muted, #6b7280)" }}>
                      Dry-run: confirm before persisting. Sends learning signal to feedback store.
                    </span>
                  </div>
                ) : null}

                <p style={{ fontSize: "0.72rem", color: "var(--text-muted, #6b7280)", marginTop: "0.75rem" }}>
                  Re-run full pipeline from the home screen; use Preview above to re-evaluate capability inputs only.
                </p>

                {moduleId === "smart_rename" && rawResult && !isApplied ? (
                  <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-default, #e5e7eb)" }}>
                    <h4 style={{ fontSize: "0.82rem", margin: "0 0 0.5rem" }}>Edit filename (session)</h4>
                    <p style={{ fontSize: "0.78rem", color: "var(--text-muted, #6b7280)", margin: "0 0 0.35rem" }}>
                      suggested: <code>{filenameTriple.suggested}</code> · userOverride:{" "}
                      <code>{filenameTriple.userOverride === null ? "—" : filenameTriple.userOverride}</code> · final:{" "}
                      <code>{filenameTriple.final}</code>
                    </p>
                    <label htmlFor={`fn-${selectedIndex}`} style={{ fontSize: "0.78rem", display: "block", marginBottom: "0.25rem" }}>
                      userOverride (empty = use suggested)
                    </label>
                    <input
                      id={`fn-${selectedIndex}`}
                      type="text"
                      value={o?.filename ?? ""}
                      placeholder={filenameTriple.suggested}
                      onChange={(e) =>
                        patchOverride(selectedIndex, { filename: e.target.value === "" ? null : e.target.value })
                      }
                      style={{ width: "100%", fontSize: "0.85rem", padding: "0.35rem 0.5rem" }}
                    />
                  </div>
                ) : null}

                {moduleId === "tagging" && rawResult && !isApplied ? (
                  <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-default, #e5e7eb)" }}>
                    <h4 style={{ fontSize: "0.82rem", margin: "0 0 0.5rem" }}>Edit tags (session)</h4>
                    <p style={{ fontSize: "0.78rem", color: "var(--text-muted, #6b7280)", margin: "0 0 0.35rem" }}>
                      suggested: {tagsTriple.suggested.join(", ") || "—"} · userOverride:{" "}
                      {tagsTriple.userOverride === null ? "—" : tagsTriple.userOverride.join(", ")} · final:{" "}
                      {tagsTriple.final.join(", ") || "—"}
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.5rem" }}>
                      {tagsTriple.final.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: "0.75rem" }}
                          onClick={() => {
                            const base = o?.tags !== undefined && o?.tags !== null ? [...o.tags] : [...tagsTriple.suggested];
                            const next = base.filter((x) => x !== t);
                            patchOverride(selectedIndex, { tags: next });
                          }}
                          title="Remove tag"
                        >
                          {t} ×
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        placeholder="Add tag"
                        style={{ flex: "1 1 140px", fontSize: "0.85rem", padding: "0.35rem 0.5rem" }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const t = tagInput.trim();
                            if (!t) return;
                            const base =
                              o?.tags !== undefined && o?.tags !== null ? [...o.tags] : [...tagsTriple.suggested];
                            if (!base.includes(t)) base.push(t);
                            patchOverride(selectedIndex, { tags: base });
                            setTagInput("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: "0.8rem" }}
                        onClick={() => {
                          const t = tagInput.trim();
                          if (!t) return;
                          const base =
                            o?.tags !== undefined && o?.tags !== null ? [...o.tags] : [...tagsTriple.suggested];
                          if (!base.includes(t)) base.push(t);
                          patchOverride(selectedIndex, { tags: base });
                          setTagInput("");
                        }}
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: "0.8rem" }}
                        onClick={() => patchOverride(selectedIndex, { tags: null })}
                      >
                        Reset to suggested
                      </button>
                    </div>
                  </div>
                ) : null}

                {moduleId === "folder_structure" && rawResult && !isApplied ? (
                  <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-default, #e5e7eb)" }}>
                    <h4 style={{ fontSize: "0.82rem", margin: "0 0 0.5rem" }}>Edit folder path (session)</h4>
                    <p style={{ fontSize: "0.78rem", color: "var(--text-muted, #6b7280)", margin: "0 0 0.35rem" }}>
                      suggested: <code>{folderTriple.suggested}</code> · userOverride:{" "}
                      <code>{folderTriple.userOverride === null ? "—" : folderTriple.userOverride}</code> · final:{" "}
                      <code>{folderTriple.final}</code>
                    </p>
                    <input
                      type="text"
                      value={o?.folderPath ?? ""}
                      placeholder={folderTriple.suggested}
                      onChange={(e) =>
                        patchOverride(selectedIndex, { folderPath: e.target.value === "" ? null : e.target.value })
                      }
                      style={{ width: "100%", fontSize: "0.85rem", padding: "0.35rem 0.5rem" }}
                    />
                  </div>
                ) : null}

                {moduleId === "review" && rawResult && !isApplied ? (
                  <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-default, #e5e7eb)" }}>
                    <h4 style={{ fontSize: "0.82rem", margin: "0 0 0.5rem" }}>Review override (session)</h4>
                    <p style={{ fontSize: "0.78rem", color: "var(--text-muted, #6b7280)", margin: "0 0 0.35rem" }}>
                      suggested: {String(reviewTriple.suggested)} · userOverride:{" "}
                      {reviewTriple.userOverride === null ? "—" : String(reviewTriple.userOverride)} · final:{" "}
                      {String(reviewTriple.final)}
                    </p>
                    <label htmlFor={`rev-${selectedIndex}`} style={{ fontSize: "0.82rem", display: "block", marginBottom: "0.35rem" }}>
                      userOverride
                    </label>
                    <select
                      id={`rev-${selectedIndex}`}
                      value={
                        o?.reviewRequires === true ? "true" : o?.reviewRequires === false ? "false" : ""
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        patchOverride(selectedIndex, {
                          reviewRequires: v === "" ? null : v === "true",
                        });
                      }}
                      style={{ fontSize: "0.85rem", padding: "0.35rem 0.5rem" }}
                    >
                      <option value="">(use suggested)</option>
                      <option value="true">Force requires review</option>
                      <option value="false">Force no review</option>
                    </select>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}

      {applyModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="apply-cap-confirm-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem",
          }}
        >
          <div
            style={{
              background: "var(--surface-panel, #fff)",
              color: "inherit",
              maxWidth: 520,
              width: "100%",
              borderRadius: 10,
              padding: "1rem",
              boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
            }}
          >
            <h3 id="apply-cap-confirm-title" style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>
              Confirm apply (dry-run)
            </h3>
            <p style={{ fontSize: "0.82rem", margin: "0 0 0.75rem", color: "var(--text-muted, #6b7280)" }}>
              No filesystem writes. Values are stored and sent to the learning feedback store (original → incorrect signal,
              final → correct).
            </p>
            <ul style={{ margin: "0 0 1rem", paddingLeft: "1.1rem", fontSize: "0.85rem", lineHeight: 1.5 }}>
              {applyModal.changes.map((c) => (
                <li key={c.field}>
                  <strong>{c.field}</strong>: <code style={{ wordBreak: "break-all" }}>{c.from}</code> →{" "}
                  <code style={{ wordBreak: "break-all" }}>{c.to}</code>
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setApplyModal(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void confirmApply()}>
                Confirm apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

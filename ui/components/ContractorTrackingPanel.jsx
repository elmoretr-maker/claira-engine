import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  runContractorCostTracking,
  runContractorTimelineScan,
  runExportProjectPdf,
  runExportProjectReport,
  runGenerateShareLink,
  runFitnessImageComparison,
  runFitnessImageRead,
  runListSavedProjects,
  runLoadProject,
  runReceiptAdd,
  runReceiptExtract,
  runReceiptList,
  runSaveProject,
} from "../clairaApiClient.js";
import { UserFacingAlert } from "../UserFacingAlert.jsx";
import { userFacingError } from "../userFacingErrorMessage.js";
import { buildAssigneeAlerts } from "../../workflow/modules/capabilities/contractorAssigneeAlerts.js";
import { buildContractorCombinedInsight } from "../../workflow/modules/capabilities/contractorCombinedInsight.js";
import { buildAssigneePerformanceRows } from "../../workflow/modules/capabilities/contractorPerformanceShared.js";
import { slugReceiptSegment } from "../../workflow/modules/capabilities/receiptPathSlug.js";
import "./FitnessTrackingPanel.css";

/** @typedef {import("../userFacingErrorMessage.js").UserFacingError} UserFacingError */

/**
 * Prefer API `userFacing` payload (type system) when present.
 * @param {unknown} out
 * @param {{ fallback: string, fallbackHint?: string }} defaults
 * @returns {UserFacingError}
 */
function userFacingFromApiResponse(out, defaults) {
  const o = out && typeof out === "object" && !Array.isArray(out) ? /** @type {Record<string, unknown>} */ (out) : null;
  const rawUf =
    o && o.userFacing && typeof o.userFacing === "object" && !Array.isArray(o.userFacing) ? o.userFacing : null;
  if (rawUf && typeof /** @type {{ message?: unknown }} */ (rawUf).message === "string") {
    const u = /** @type {{ message: string, actionHint?: string, type?: string }} */ (rawUf);
    return {
      message: u.message,
      type: u.type === "input" || u.type === "validation" ? u.type : "system",
      ...(typeof u.actionHint === "string" ? { actionHint: u.actionHint } : {}),
    };
  }
  return userFacingError(typeof o?.error === "string" ? o.error : null, { ...defaults, type: "system" });
}

/**
 * @param {unknown} score0to100
 * @returns {number | null} 0–1
 */
function confRatio(score0to100) {
  if (score0to100 == null || typeof score0to100 !== "number" || !Number.isFinite(score0to100)) return null;
  return Math.min(1, Math.max(0, score0to100 / 100));
}

/**
 * @param {{ ratio: number | null }} props
 */
function OcrConfHint({ ratio }) {
  if (ratio == null) return null;
  const low = ratio < 0.7;
  return (
    <span
      className="contractor-ocr-conf"
      style={{
        fontSize: "0.75rem",
        marginLeft: "0.35rem",
        color: low ? "#d97706" : "#6b7280",
      }}
      title="OCR confidence (0–100%)"
    >
      {low ? "⚠ Low confidence" : `${Math.round(ratio * 100)}%`}
    </span>
  );
}

/**
 * @param {{ raw: string, vendor: string, amount: string, date: string }} props
 */
function OcrRawMarked({ raw, vendor, amount, date }) {
  const needles = [vendor, amount, date].map((x) => String(x ?? "").trim()).filter((x) => x.length > 0);
  if (!raw || needles.length === 0) return raw;
  /** @type {Array<string | { k: number, t: string }>} */
  const chunks = [];
  let rest = raw;
  let key = 0;
  while (rest.length) {
    let bestIdx = Infinity;
    /** @type {string} */
    let bestNeedle = "";
    for (const n of needles) {
      const i = rest.indexOf(n);
      if (i >= 0 && i < bestIdx) {
        bestIdx = i;
        bestNeedle = n;
      }
    }
    if (bestIdx === Infinity) {
      chunks.push(rest);
      break;
    }
    if (bestIdx > 0) chunks.push(rest.slice(0, bestIdx));
    chunks.push({ k: key++, t: bestNeedle });
    rest = rest.slice(bestIdx + bestNeedle.length);
  }
  return (
    <>
      {chunks.map((c, i) =>
        typeof c === "string" ? (
          <span key={i}>{c}</span>
        ) : (
          <mark key={i} style={{ background: "rgba(250, 204, 21, 0.35)", padding: "0 0.1em" }}>
            {c.t}
          </mark>
        ),
      )}
    </>
  );
}

/**
 * @param {unknown} label
 */
function insightToneClass(label) {
  const s = String(label ?? "");
  if (s === "Significant transformation") return "fitness-panel__insight--strong";
  if (s === "Moderate progress") return "fitness-panel__insight--moderate";
  return "fitness-panel__insight--minimal";
}

/**
 * @param {unknown} label
 */
function insightListClass(label) {
  const s = String(label ?? "");
  if (s === "Significant transformation") return "fitness-panel__comparison-insight--strong";
  if (s === "Moderate progress") return "fitness-panel__comparison-insight--moderate";
  return "fitness-panel__comparison-insight--minimal";
}

/**
 * @param {Record<string, unknown>} r
 */
function receiptHierarchy(r) {
  const tags =
    r.tags && typeof r.tags === "object" && !Array.isArray(r.tags)
      ? /** @type {Record<string, unknown>} */ (r.tags)
      : {};
  const path = Array.isArray(tags.path) ? tags.path.map((x) => String(x ?? "").trim()) : [];
  const dom = String(tags.domain ?? "").toLowerCase();
  if (dom === "contractor" && path.length >= 3) {
    return {
      project: path[0] || "—",
      subproject: path[1] || "—",
      section: path[2] || "—",
      assignee: String(tags.assignee ?? "").trim() || "—",
    };
  }
  return {
    project: String(tags.project ?? "—").trim() || "—",
    subproject: String(tags.room ?? "—").trim() || "—",
    section: String(tags.category ?? "—").trim() || "—",
    assignee: String(tags.assignee ?? "—").trim() || "—",
  };
}

/**
 * @template T
 * @param {Map<string, T>} m
 * @returns {string[]}
 */
function sortedMapKeys(m) {
  return [...m.keys()].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {Record<string, unknown>} r
 * @param {string} selectedProject
 */
function contractorReceiptMatchesProject(r, selectedProject) {
  const t = String(selectedProject ?? "").trim();
  if (!t) return false;
  const tags = r.tags && typeof r.tags === "object" && !Array.isArray(r.tags) ? r.tags : {};
  const dom = String(tags.domain ?? "").toLowerCase();
  if (dom === "contractor") {
    try {
      const h = receiptHierarchy(r);
      return h.project === slugReceiptSegment(selectedProject);
    } catch {
      return false;
    }
  }
  return String(tags.project ?? "").trim() === t;
}

/**
 * @param {{
 *   urlA: string,
 *   urlB: string,
 *   pct: number,
 *   onPctChange: (n: number) => void,
 * }} props
 */
function CompareSlider({ urlA, urlB, pct, onPctChange }) {
  const rootRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const dragging = useRef(false);

  const setFromClientX = useCallback(
    (clientX) => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = r.width || 1;
      const x = Math.min(Math.max(clientX - r.left, 0), w);
      onPctChange(Math.round((x / w) * 100));
    },
    [onPctChange],
  );

  useEffect(() => {
    const end = () => {
      dragging.current = false;
    };
    const move = (e) => {
      if (!dragging.current) return;
      setFromClientX(e.clientX);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [setFromClientX]);

  return (
    <div
      ref={rootRef}
      className="fitness-panel__slider"
      onPointerDown={(e) => {
        dragging.current = true;
        setFromClientX(e.clientX);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        setFromClientX(e.clientX);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }}
      role="presentation"
    >
      <img className="fitness-panel__slider-base" src={urlB} alt="" draggable={false} />
      <img
        className="fitness-panel__slider-overlay"
        src={urlA}
        alt=""
        draggable={false}
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
      />
      <div className="fitness-panel__slider-handle" style={{ left: `${pct}%` }} aria-hidden />
      <div className="fitness-panel__slider-hint">Drag to compare · A left · B right</div>
    </div>
  );
}

/**
 * @param {unknown} compareResult
 * @returns {string}
 */
function progressInsightLabelFromCompare(compareResult) {
  const compareRec =
    compareResult && typeof compareResult === "object" && !Array.isArray(compareResult)
      ? /** @type {Record<string, unknown>} */ (compareResult)
      : null;
  if (!compareRec) return "";
  const comparisonsList =
    compareRec && Array.isArray(compareRec.comparisons) ? /** @type {unknown[]} */ (compareRec.comparisons) : [];
  if (comparisonsList.length > 1) {
    const last = comparisonsList[comparisonsList.length - 1];
    const r = last && typeof last === "object" && !Array.isArray(last) ? /** @type {Record<string, unknown>} */ (last) : null;
    const res =
      r && r.result && typeof r.result === "object" && !Array.isArray(r.result)
        ? /** @type {Record<string, unknown>} */ (r.result)
        : null;
    return res && typeof res.insightLabel === "string" ? res.insightLabel : "";
  }
  return typeof compareRec.insightLabel === "string" ? compareRec.insightLabel : "";
}

/**
 * @param {{ imagePath: string }} props
 */
function ReceiptThumb({ imagePath }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!imagePath) {
        setUrl("");
        return;
      }
      try {
        const out = await runFitnessImageRead({ path: imagePath });
        if (cancelled) return;
        if (out && typeof out === "object" && /** @type {{ ok?: boolean }} */ (out).ok === true) {
          const rec = /** @type {Record<string, unknown>} */ (out);
          const b64 = typeof rec.dataBase64 === "string" ? rec.dataBase64 : "";
          const mime = typeof rec.mime === "string" ? rec.mime : "image/jpeg";
          setUrl(b64 ? `data:${mime};base64,${b64}` : "");
        } else {
          setUrl("");
        }
      } catch {
        if (!cancelled) setUrl("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imagePath]);
  return url ? (
    <img src={url} alt="" className="contractor-receipt__thumb" width={48} height={48} loading="lazy" />
  ) : (
    <span className="contractor-receipt__thumb-ph" aria-hidden>
      …
    </span>
  );
}

/**
 * @param {{ className?: string }} props
 */
export default function ContractorTrackingPanel({ className = "" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {UserFacingError | null} */ (null));
  const [projects, setProjects] = useState(/** @type {unknown[]} */ ([]));
  const [selectedProject, setSelectedProject] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [pathA, setPathA] = useState("");
  const [pathB, setPathB] = useState("");
  const [comparisonMode, setComparisonMode] = useState(/** @type {"single" | "sequential" | "baseline"} */ ("single"));
  const [compareBusy, setCompareBusy] = useState(false);
  /** @type {[unknown, React.Dispatch<React.SetStateAction<unknown>>]} */
  const [compareResult, setCompareResult] = useState(() => /** @type {unknown} */ (null));
  const [compareView, setCompareView] = useState(/** @type {"side" | "slider"} */ ("side"));
  const [sliderPct, setSliderPct] = useState(50);
  const [previewUrlA, setPreviewUrlA] = useState("");
  const [previewUrlB, setPreviewUrlB] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState(/** @type {UserFacingError | null} */ (null));

  const [initialCostStr, setInitialCostStr] = useState("");
  const [manualSupplementStr, setManualSupplementStr] = useState("");
  const [costBusy, setCostBusy] = useState(false);
  const [costError, setCostError] = useState(/** @type {UserFacingError | null} */ (null));
  /** @type {[Record<string, unknown> | null, React.Dispatch<React.SetStateAction<Record<string, unknown> | null>>]} */
  const [costTrackResult, setCostTrackResult] = useState(() => /** @type {Record<string, unknown> | null} */ (null));

  /** @type {[Record<string, unknown>[], React.Dispatch<React.SetStateAction<Record<string, unknown>[]>>]} */
  const [allReceipts, setAllReceipts] = useState(() => /** @type {Record<string, unknown>[]} */ ([]));
  const [receiptLoadBusy, setReceiptLoadBusy] = useState(false);
  const [receiptAddBusy, setReceiptAddBusy] = useState(false);
  const [receiptFormError, setReceiptFormError] = useState(/** @type {UserFacingError | null} */ (null));
  const [receiptVendor, setReceiptVendor] = useState("");
  const [receiptAmountStr, setReceiptAmountStr] = useState("");
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receiptNote, setReceiptNote] = useState("");
  const [receiptProject, setReceiptProject] = useState("");
  const [receiptSubproject, setReceiptSubproject] = useState("");
  const [receiptSection, setReceiptSection] = useState("");
  const [receiptAssignee, setReceiptAssignee] = useState("");
  const [receiptFile, setReceiptFile] = useState(/** @type {File | null} */ (null));

  /** @type {[Array<{ slug: string, name: string, budget?: number }>, React.Dispatch<React.SetStateAction<Array<{ slug: string, name: string, budget?: number }>>>]} */
  const [savedProjects, setSavedProjects] = useState(() => []);
  const [loadProjectSlug, setLoadProjectSlug] = useState("");
  const [projectPersistBusy, setProjectPersistBusy] = useState(false);
  const [projectPersistError, setProjectPersistError] = useState(/** @type {UserFacingError | null} */ (null));
  const [exportReportBusy, setExportReportBusy] = useState(false);
  const [exportPdfBusy, setExportPdfBusy] = useState(false);
  const [shareLinkBusy, setShareLinkBusy] = useState(false);
  const [shareLinkHint, setShareLinkHint] = useState(/** @type {string | null} */ (null));
  const [ocrBusy, setOcrBusy] = useState(false);
  /** @type {[{ rawText?: string, fieldConfidence?: { vendor?: number | null, amount?: number | null, date?: number | null } } | null, React.Dispatch<React.SetStateAction<{ rawText?: string, fieldConfidence?: { vendor?: number | null, amount?: number | null, date?: number | null } } | null>>]} */
  const [ocrExtractMeta, setOcrExtractMeta] = useState(() => /** @type {{ rawText?: string, fieldConfidence?: { vendor?: number | null, amount?: number | null, date?: number | null } } | null} */ (null));

  const budgetExportOptions = useMemo(() => {
    const ib = Number(String(initialCostStr).replace(/,/g, ""));
    const ms = Number(String(manualSupplementStr).replace(/,/g, ""));
    /** @type {Record<string, unknown>} */
    const o = {};
    if (initialCostStr.trim() && Number.isFinite(ib)) o.initialBudget = ib;
    if (manualSupplementStr.trim() && Number.isFinite(ms)) o.manualSpendSupplement = ms;
    return o;
  }, [initialCostStr, manualSupplementStr]);

  const refreshSavedProjects = useCallback(async () => {
    try {
      const out = await runListSavedProjects({});
      if (out && /** @type {{ ok?: boolean }} */ (out).ok === true) {
        const raw = /** @type {{ projects?: unknown }} */ (out).projects;
        const list = Array.isArray(raw) ? raw : [];
        setSavedProjects(
          list
            .filter((x) => x && typeof x === "object" && !Array.isArray(x))
            .map((x) => {
              const o = /** @type {Record<string, unknown>} */ (x);
              return {
                slug: String(o.slug ?? ""),
                name: String(o.name ?? ""),
                budget: typeof o.budget === "number" ? o.budget : Number(o.budget),
              };
            })
            .filter((x) => x.slug),
        );
      } else {
        setSavedProjects([]);
      }
    } catch {
      setSavedProjects([]);
    }
  }, []);

  const loadReceipts = useCallback(async () => {
    setReceiptLoadBusy(true);
    try {
      const out = await runReceiptList({});
      if (out && /** @type {{ ok?: boolean }} */ (out).ok === true) {
        const raw = /** @type {{ receipts?: unknown }} */ (out).receipts;
        const list = Array.isArray(raw) ? raw : [];
        setAllReceipts(
          list.filter((x) => x && typeof x === "object" && !Array.isArray(x)).map((x) => /** @type {Record<string, unknown>} */ (x)),
        );
      } else {
        setAllReceipts([]);
      }
    } catch {
      setAllReceipts([]);
    } finally {
      setReceiptLoadBusy(false);
    }
  }, []);

  const loadScan = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const out = await runContractorTimelineScan({});
      if (!out || /** @type {{ ok?: boolean }} */ (out).ok !== true) {
        setError(
          userFacingError(
            typeof /** @type {{ error?: string }} */ (out).error === "string"
              ? /** @type {{ error: string }} */ (out).error
              : null,
            {
              fallback: "Scan failed",
              fallbackHint: "Click Refresh. If it keeps failing, check the dev server console.",
            },
          ),
        );
        setProjects([]);
        return;
      }
      const list = /** @type {unknown[]} */ (/** @type {{ projects?: unknown }} */ (out).projects);
      setProjects(Array.isArray(list) ? list : []);
      setSelectedProject("");
      setSelectedRoom("");
      setPathA("");
      setPathB("");
      setComparisonMode("single");
      setCompareResult(null);
      await loadReceipts();
      await refreshSavedProjects();
    } catch (e) {
      setError(
        userFacingError(e, {
          fallback: "Scan failed",
          fallbackHint: "Click Refresh. If it keeps failing, check the dev server console.",
        }),
      );
      setProjects([]);
    } finally {
      setBusy(false);
    }
  }, [loadReceipts, refreshSavedProjects]);

  useEffect(() => {
    void loadScan();
  }, [loadScan]);

  useEffect(() => {
    if (selectedProject) setReceiptProject(selectedProject);
  }, [selectedProject]);

  const projectBlock = useMemo(() => {
    if (!selectedProject) return null;
    return projects.find(
      (p) =>
        p &&
        typeof p === "object" &&
        !Array.isArray(p) &&
        String(/** @type {{ name?: string }} */ (p).name ?? "") === selectedProject,
    );
  }, [projects, selectedProject]);

  const roomsList = useMemo(() => {
    const p = projectBlock && typeof projectBlock === "object" && !Array.isArray(projectBlock) ? projectBlock : null;
    if (!p) return [];
    const raw = /** @type {{ rooms?: unknown }} */ (p).rooms;
    return Array.isArray(raw) ? raw : [];
  }, [projectBlock]);

  const receiptSumSelectedProject = useMemo(() => {
    if (!selectedProject) return 0;
    let s = 0;
    for (const r of allReceipts) {
      if (!contractorReceiptMatchesProject(r, selectedProject)) continue;
      const a = typeof r.amount === "number" ? r.amount : Number(r.amount);
      if (Number.isFinite(a)) s += a;
    }
    return Number(s.toFixed(2));
  }, [allReceipts, selectedProject]);

  const receiptTree = useMemo(() => {
    /** @type {Map<string, Map<string, Map<string, Map<string, Record<string, unknown>[]>>>>} */
    const root = new Map();
    for (const r of allReceipts) {
      const h = receiptHierarchy(r);
      if (!root.has(h.project)) root.set(h.project, new Map());
      const pM = root.get(h.project);
      if (!pM) continue;
      if (!pM.has(h.subproject)) pM.set(h.subproject, new Map());
      const sM = pM.get(h.subproject);
      if (!sM) continue;
      if (!sM.has(h.section)) sM.set(h.section, new Map());
      const cM = sM.get(h.section);
      if (!cM) continue;
      if (!cM.has(h.assignee)) cM.set(h.assignee, []);
      const bucket = cM.get(h.assignee);
      if (bucket) bucket.push(r);
    }
    return root;
  }, [allReceipts]);

  const receiptRollups = useMemo(() => {
    const scope = selectedProject ? allReceipts.filter((r) => contractorReceiptMatchesProject(r, selectedProject)) : allReceipts;

    let scopedTotal = 0;
    /** @type {Map<string, number>} */
    const byProject = new Map();
    /** @type {Map<string, number>} */
    const bySection = new Map();
    /** @type {Map<string, number>} */
    const byAssignee = new Map();

    for (const r of scope) {
      const h = receiptHierarchy(r);
      const a = typeof r.amount === "number" ? r.amount : Number(r.amount);
      if (!Number.isFinite(a)) continue;
      scopedTotal += a;
      byProject.set(h.project, (byProject.get(h.project) ?? 0) + a);
      const sectionKey = `${h.project} → ${h.subproject} → ${h.section}`;
      bySection.set(sectionKey, (bySection.get(sectionKey) ?? 0) + a);
      const assigneeKey = `${sectionKey} → ${h.assignee}`;
      byAssignee.set(assigneeKey, (byAssignee.get(assigneeKey) ?? 0) + a);
    }

    return {
      scopedTotal: Number(scopedTotal.toFixed(2)),
      byProject: [...byProject.entries()].sort((x, y) => x[0].localeCompare(y[0])),
      bySection: [...bySection.entries()].sort((x, y) => x[0].localeCompare(y[0])),
      byAssignee: [...byAssignee.entries()].sort((x, y) => x[0].localeCompare(y[0])),
    };
  }, [allReceipts, selectedProject]);

  const assigneePerformanceRows = useMemo(
    () => buildAssigneePerformanceRows(allReceipts, projects, selectedProject),
    [allReceipts, projects, selectedProject],
  );

  const assigneeAlerts = useMemo(() => buildAssigneeAlerts(assigneePerformanceRows), [assigneePerformanceRows]);

  const alertsByAssignee = useMemo(() => {
    /** @type {Map<string, typeof assigneeAlerts>} */
    const m = new Map();
    for (const a of assigneeAlerts) {
      if (!m.has(a.assignee)) m.set(a.assignee, []);
      m.get(a.assignee).push(a);
    }
    return m;
  }, [assigneeAlerts]);

  const saveCurrentProject = useCallback(async () => {
    setProjectPersistError(null);
    if (!selectedProject) {
      setProjectPersistError({
        type: "input",
        message: "Select a project to save.",
        actionHint: "Pick a project from the scan list.",
      });
      return;
    }
    const budget = Number(String(initialCostStr).replace(/,/g, ""));
    if (!Number.isFinite(budget)) {
      setProjectPersistError({
        type: "input",
        message: "Enter a valid budget before saving.",
        actionHint: "Use Initial budget under Budget vs actual.",
      });
      return;
    }
    setProjectPersistBusy(true);
    try {
      const out = await runSaveProject({ name: selectedProject, budget });
      if (!out || /** @type {{ ok?: boolean }} */ (out).ok !== true) {
        setProjectPersistError(
          userFacingError(
            typeof /** @type {{ error?: string }} */ (out).error === "string" ? /** @type {{ error: string }} */ (out).error : null,
            { fallback: "Could not save project", fallbackHint: "Try again or check workspace permissions." },
          ),
        );
        return;
      }
      await refreshSavedProjects();
    } catch (e) {
      setProjectPersistError(
        userFacingError(e, { fallback: "Could not save project", fallbackHint: "Check the dev server console." }),
      );
    } finally {
      setProjectPersistBusy(false);
    }
  }, [selectedProject, initialCostStr, refreshSavedProjects]);

  const applyLoadedProject = useCallback(async () => {
    setProjectPersistError(null);
    const slug = loadProjectSlug.trim();
    if (!slug) {
      setProjectPersistError({
        type: "input",
        message: "Choose a saved project to load.",
        actionHint: "Pick an entry from the Load dropdown.",
      });
      return;
    }
    setProjectPersistBusy(true);
    try {
      const out = await runLoadProject({ slug });
      if (!out || /** @type {{ ok?: boolean }} */ (out).ok !== true) {
        setProjectPersistError(
          userFacingError(
            typeof /** @type {{ error?: string }} */ (out).error === "string" ? /** @type {{ error: string }} */ (out).error : null,
            { fallback: "Could not load project", fallbackHint: "Confirm the file exists under projects/." },
          ),
        );
        return;
      }
      const rec =
        out && typeof out === "object" && /** @type {{ project?: unknown }} */ (out).project != null
          ? /** @type {Record<string, unknown>} */ (/** @type {{ project: Record<string, unknown> }} */ (out).project)
          : null;
      const name = rec && typeof rec.name === "string" ? rec.name : "";
      const b = rec && rec.budget != null ? Number(rec.budget) : NaN;
      if (name) {
        setSelectedProject(name);
        setReceiptProject(name);
        setSelectedRoom("");
        setPathA("");
        setPathB("");
        setCompareResult(null);
      }
      if (Number.isFinite(b)) setInitialCostStr(String(b));
      setLoadProjectSlug("");
    } catch (e) {
      setProjectPersistError(
        userFacingError(e, { fallback: "Could not load project", fallbackHint: "Check the dev server console." }),
      );
    } finally {
      setProjectPersistBusy(false);
    }
  }, [loadProjectSlug]);

  const exportProjectReport = useCallback(async () => {
    if (!selectedProject) return;
    setExportReportBusy(true);
    try {
      const out = await runExportProjectReport({ project: selectedProject, ...budgetExportOptions });
      if (!out || /** @type {{ ok?: boolean }} */ (out).ok !== true) {
        setProjectPersistError(
          userFacingFromApiResponse(out, { fallback: "Export failed", fallbackHint: "Select a project and try again." }),
        );
        return;
      }
      const report = /** @type {{ report?: unknown }} */ (out).report;
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contractor-report-${selectedProject.replace(/[^a-z0-9_-]/gi, "_")}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setProjectPersistError(
        userFacingError(e, { fallback: "Export failed", fallbackHint: "Check the dev server console." }),
      );
    } finally {
      setExportReportBusy(false);
    }
  }, [selectedProject, budgetExportOptions]);

  const exportProjectPdf = useCallback(async () => {
    if (!selectedProject) return;
    setExportPdfBusy(true);
    try {
      const out = await runExportProjectPdf({ project: selectedProject, ...budgetExportOptions });
      if (!out || /** @type {{ ok?: boolean }} */ (out).ok !== true) {
        setProjectPersistError(
          userFacingFromApiResponse(out, { fallback: "PDF export failed", fallbackHint: "Select a project and try again." }),
        );
        return;
      }
      const b64 = typeof /** @type {{ pdfBase64?: string }} */ (out).pdfBase64 === "string" ? /** @type {{ pdfBase64: string }} */ (out).pdfBase64 : "";
      const name =
        typeof /** @type {{ pdfFileName?: string }} */ (out).pdfFileName === "string"
          ? /** @type {{ pdfFileName: string }} */ (out).pdfFileName
          : `contractor-report-${selectedProject.replace(/[^a-z0-9_-]/gi, "_")}.pdf`;
      if (!b64) {
        setProjectPersistError(
          userFacingFromApiResponse(out, { fallback: "PDF export returned no data.", fallbackHint: "Retry or check the API server." }),
        );
        return;
      }
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setProjectPersistError(
        userFacingError(e, { fallback: "PDF export failed", fallbackHint: "Check the dev server console." }),
      );
    } finally {
      setExportPdfBusy(false);
    }
  }, [selectedProject, budgetExportOptions]);

  const generateShareLink = useCallback(async () => {
    if (!selectedProject) return;
    setShareLinkBusy(true);
    setShareLinkHint(null);
    try {
      const out = await runGenerateShareLink({ project: selectedProject, ...budgetExportOptions });
      if (!out || /** @type {{ ok?: boolean }} */ (out).ok !== true) {
        setProjectPersistError(
          userFacingFromApiResponse(out, { fallback: "Could not create share link", fallbackHint: "Select a project and try again." }),
        );
        return;
      }
      const slug = String(/** @type {{ projectSlug?: string }} */ (out).projectSlug ?? "");
      const id = String(/** @type {{ reportId?: string }} */ (out).reportId ?? "");
      const base = `${window.location.origin}${window.location.pathname.replace(/\/$/, "")}`;
      const hashUrl = `${base}#/reports/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`;
      try {
        await navigator.clipboard.writeText(hashUrl);
        setShareLinkHint("Copied!");
        window.setTimeout(() => setShareLinkHint(null), 2200);
      } catch {
        setShareLinkHint(`Clipboard blocked — copy this link: ${hashUrl}`);
      }
    } catch (e) {
      setProjectPersistError(
        userFacingError(e, { fallback: "Could not create share link", fallbackHint: "Check the dev server console." }),
      );
    } finally {
      setShareLinkBusy(false);
    }
  }, [selectedProject, budgetExportOptions]);

  const onReceiptImagePicked = useCallback(
    async (file) => {
      setReceiptFile(file);
      setOcrExtractMeta(null);
      if (!file) return;
      setOcrBusy(true);
      try {
        const dataUrl = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result ?? ""));
          fr.onerror = () => rej(new Error("read failed"));
          fr.readAsDataURL(file);
        });
        const exOut = await runReceiptExtract({ imageBase64: dataUrl });
        if (!exOut || /** @type {{ ok?: boolean }} */ (exOut).ok !== true) {
          setReceiptFormError(
            userFacingFromApiResponse(exOut, {
              fallback: "OCR could not run on this image.",
              fallbackHint: "Enter vendor, amount, and date manually.",
            }),
          );
          return;
        }
        setReceiptFormError(null);
        const extract =
          exOut && typeof exOut === "object" && /** @type {{ extract?: unknown }} */ (exOut).extract != null
            ? /** @type {{ extract?: Record<string, unknown> }} */ (exOut).extract
            : null;
        if (extract && typeof extract === "object") {
          const v = String(extract.vendor ?? "").trim();
          const amt = String(extract.amount ?? "").trim();
          const dt = String(extract.date ?? "").trim();
          if (v) setReceiptVendor(v);
          if (amt) setReceiptAmountStr(amt);
          if (dt) setReceiptDate(dt.length >= 8 ? dt.slice(0, 10) : dt);
          const cf =
            extract.confidence && typeof extract.confidence === "object" && !Array.isArray(extract.confidence)
              ? /** @type {Record<string, unknown>} */ (extract.confidence)
              : {};
          setOcrExtractMeta({
            rawText: typeof extract.rawText === "string" ? extract.rawText : "",
            fieldConfidence: {
              vendor: confRatio(/** @type {{ vendor?: unknown }} */ (cf).vendor),
              amount: confRatio(/** @type {{ amount?: unknown }} */ (cf).amount),
              date: confRatio(/** @type {{ date?: unknown }} */ (cf).date),
            },
          });
        }
      } catch {
        /* OCR optional — user can fill manually */
      } finally {
        setOcrBusy(false);
      }
    },
    [],
  );

  const manualCostConflictMessage = useMemo(() => {
    const manualSupplementNum = Number(String(manualSupplementStr).replace(/,/g, ""));
    if (Number.isFinite(manualSupplementNum) && manualSupplementNum < 0 && receiptSumSelectedProject > 0 && selectedProject) {
      return "Negative other costs while this project has receipt spend can distort totals. Check amounts.";
    }
    if (
      selectedProject &&
      receiptSumSelectedProject > 0 &&
      Number.isFinite(manualSupplementNum) &&
      manualSupplementNum > receiptSumSelectedProject * 2
    ) {
      return "Other costs are much larger than the receipt subtotal for this project. Confirm nothing is double-counted.";
    }
    return null;
  }, [manualSupplementStr, receiptSumSelectedProject, selectedProject]);

  const roomBlock = useMemo(() => {
    if (!selectedRoom) return null;
    return roomsList.find(
      (r) =>
        r &&
        typeof r === "object" &&
        !Array.isArray(r) &&
        String(/** @type {{ name?: string }} */ (r).name ?? "") === selectedRoom,
    );
  }, [roomsList, selectedRoom]);

  const stageNames = useMemo(() => {
    const r = roomBlock && typeof roomBlock === "object" && !Array.isArray(roomBlock) ? roomBlock : null;
    if (!r) return [];
    const rec = /** @type {Record<string, unknown>} */ (r);
    const orderedRaw = rec.orderedStages;
    if (Array.isArray(orderedRaw) && orderedRaw.length > 0) {
      return orderedRaw.map((s) => String(s ?? "")).filter(Boolean);
    }
    const stages = Array.isArray(rec.stages) ? rec.stages : [];
    return stages
      .map((s) =>
        s && typeof s === "object" && !Array.isArray(s) ? String(/** @type {{ name?: string }} */ (s).name ?? "") : "",
      )
      .filter(Boolean);
  }, [roomBlock]);

  const imageOptions = useMemo(() => {
    const r = roomBlock && typeof roomBlock === "object" && !Array.isArray(roomBlock) ? roomBlock : null;
    const stages = r && Array.isArray(/** @type {{ stages?: unknown }} */ (r).stages) ? /** @type {unknown[]} */ (r.stages) : [];
    /** @type {{ value: string, label: string, stageName: string }[]} */
    const opts = [];
    for (const st of stages) {
      const rec = st && typeof st === "object" && !Array.isArray(st) ? /** @type {Record<string, unknown>} */ (st) : null;
      const stageName = typeof rec?.name === "string" ? rec.name : "";
      const imgs = Array.isArray(rec?.images) ? rec.images : [];
      for (const im of imgs) {
        const ir = im && typeof im === "object" && !Array.isArray(im) ? /** @type {Record<string, unknown>} */ (im) : null;
        const p = typeof ir?.path === "string" ? ir.path : "";
        const base = typeof ir?.basename === "string" ? ir.basename : p;
        if (p) opts.push({ value: p, label: `${stageName} · ${base}`, stageName });
      }
    }
    return opts;
  }, [roomBlock]);

  const pathStageMap = useMemo(() => {
    const m = new Map();
    for (const o of imageOptions) m.set(o.value, o.stageName);
    return m;
  }, [imageOptions]);

  const pathsByStage = useMemo(() => {
    const r = roomBlock && typeof roomBlock === "object" && !Array.isArray(roomBlock) ? roomBlock : null;
    if (!r || !Array.isArray(/** @type {{ stages?: unknown }} */ (r).stages)) return {};
    const stages = /** @type {unknown[]} */ (r.stages);
    /** @type {Record<string, string>} */
    const out = {};
    for (const st of stages) {
      const rec = st && typeof st === "object" && !Array.isArray(st) ? /** @type {Record<string, unknown>} */ (st) : null;
      const stageName = typeof rec?.name === "string" ? rec.name : "";
      if (!stageName) continue;
      const imgs = Array.isArray(rec?.images) ? [...rec.images] : [];
      imgs.sort((a, b) => {
        const ar = a && typeof a === "object" && !Array.isArray(a) ? /** @type {{ basename?: string }} */ (a) : null;
        const br = b && typeof b === "object" && !Array.isArray(b) ? /** @type {{ basename?: string }} */ (b) : null;
        return String(ar?.basename ?? "").localeCompare(String(br?.basename ?? ""));
      });
      const first = imgs[0];
      const ir = first && typeof first === "object" && !Array.isArray(first) ? /** @type {{ path?: string }} */ (first) : null;
      const p = typeof ir?.path === "string" ? ir.path : "";
      if (p) out[stageName] = p;
    }
    return out;
  }, [roomBlock]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pathA || !pathB) {
        setPreviewUrlA("");
        setPreviewUrlB("");
        setPreviewErr(null);
        return;
      }
      setPreviewErr(null);
      setPreviewBusy(true);
      try {
        const [ra, rb] = await Promise.all([runFitnessImageRead({ path: pathA }), runFitnessImageRead({ path: pathB })]);
        if (cancelled) return;
        const a = ra && typeof ra === "object" ? /** @type {Record<string, unknown>} */ (ra) : null;
        const b = rb && typeof rb === "object" ? /** @type {Record<string, unknown>} */ (rb) : null;
        if (a?.ok !== true || b?.ok !== true) {
          const msg =
            typeof a?.error === "string"
              ? String(a.error)
              : typeof b?.error === "string"
                ? String(b.error)
                : "Could not load images for preview.";
          setPreviewErr(
            userFacingError(msg, {
              fallback: "Could not load images for preview.",
              fallbackHint: "Pick two workspace images, or refresh the scan.",
            }),
          );
          setPreviewUrlA("");
          setPreviewUrlB("");
          return;
        }
        const mimeA = typeof a.mime === "string" ? a.mime : "image/png";
        const mimeB = typeof b.mime === "string" ? b.mime : "image/png";
        const dA = typeof a.dataBase64 === "string" ? a.dataBase64 : "";
        const dB = typeof b.dataBase64 === "string" ? b.dataBase64 : "";
        setPreviewUrlA(dA ? `data:${mimeA};base64,${dA}` : "");
        setPreviewUrlB(dB ? `data:${mimeB};base64,${dB}` : "");
      } catch (e) {
        if (!cancelled) {
          setPreviewErr(
            userFacingError(e, {
              fallback: "Could not load images for preview.",
              fallbackHint: "Pick two workspace images, or refresh the scan.",
            }),
          );
          setPreviewUrlA("");
          setPreviewUrlB("");
        }
      } finally {
        if (!cancelled) setPreviewBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathA, pathB]);

  useEffect(() => {
    setSliderPct(50);
  }, [pathA, pathB]);

  const stagePairLabel = useMemo(() => {
    const sa = pathStageMap.get(pathA) ?? "";
    const sb = pathStageMap.get(pathB) ?? "";
    if (!sa && !sb) return "";
    return `${sa || "—"} → ${sb || "—"}`;
  }, [pathA, pathB, pathStageMap]);

  const runCompare = useCallback(async () => {
    setError(null);
    setCompareResult(null);
    setCompareBusy(true);
    try {
      if (comparisonMode === "single") {
        if (!pathA || !pathB) {
          setError({
            type: "input",
            message: "Select two images to compare.",
            actionHint: "Choose Image A and Image B, then run compare.",
          });
          return;
        }
        if (pathA === pathB) {
          setError({
            type: "input",
            message: "Choose two different image paths.",
            actionHint: "Pick two distinct files from the dropdowns.",
          });
          return;
        }
        const stageA = pathStageMap.get(pathA) ?? "";
        const stageB = pathStageMap.get(pathB) ?? "";
        const out = await runFitnessImageComparison({
          domainMode: "contractor",
          mode: "single",
          pathA,
          pathB,
          stageA,
          stageB,
        });
        if (!out || /** @type {{ ok?: boolean }} */ (out).ok !== true) {
          setError(
            userFacingError(
              typeof /** @type {{ error?: string }} */ (out).error === "string"
                ? /** @type {{ error: string }} */ (out).error
                : null,
              {
                fallback: "Comparison failed",
                fallbackHint: "Check selections or try Single mode with two hand-picked files.",
              },
            ),
          );
          return;
        }
        setCompareResult(/** @type {{ result?: unknown }} */ (out).result ?? null);
        return;
      }

      if (stageNames.length < 2) {
        setError({
          type: "validation",
          message: "Need at least two timeline stages with images in this room.",
          actionHint: "Add photos under each stage folder, refresh, or use Single mode.",
        });
        return;
      }
      const out = await runFitnessImageComparison({
        domainMode: "contractor",
        mode: comparisonMode,
        orderedStages: stageNames,
        pathsByStage,
      });
      if (!out || /** @type {{ ok?: boolean }} */ (out).ok !== true) {
        setError(
          userFacingError(
            typeof /** @type {{ error?: string }} */ (out).error === "string"
              ? /** @type {{ error: string }} */ (out).error
              : null,
            {
              fallback: "Comparison failed",
              fallbackHint: "Check selections or try Single mode.",
            },
          ),
        );
        return;
      }
      setCompareResult(/** @type {{ result?: unknown }} */ (out).result ?? null);
    } catch (e) {
      setError(
        userFacingError(e, {
          fallback: "Comparison failed",
          fallbackHint: "Check selections or try Single mode.",
        }),
      );
    } finally {
      setCompareBusy(false);
    }
  }, [comparisonMode, pathA, pathB, pathStageMap, stageNames, pathsByStage]);

  const applyCostTracking = useCallback(async () => {
    setCostError(null);
    setCostBusy(true);
    try {
      const initialCost = Number(String(initialCostStr).replace(/,/g, ""));
      const manualSpendSupplement = Number(String(manualSupplementStr).replace(/,/g, ""));
      if (!selectedProject) {
        setCostError({
          type: "input",
          message: "Select a project first.",
          actionHint: "Pick a project from the scan, then enter budget numbers.",
        });
        return;
      }
      if (!Number.isFinite(initialCost)) {
        setCostError({
          type: "input",
          message: "Enter a valid initial budget.",
          actionHint: "Use a number for the planned budget.",
        });
        return;
      }
      const out = await runContractorCostTracking({
        project: selectedProject,
        initialCost,
        manualSpendSupplement: Number.isFinite(manualSpendSupplement) ? manualSpendSupplement : 0,
      });
      if (!out || /** @type {{ ok?: boolean }} */ (out).ok !== true) {
        setCostError(
          userFacingError(
            typeof /** @type {{ error?: string }} */ (out).error === "string"
              ? /** @type {{ error: string }} */ (out).error
              : null,
            { fallback: "Cost update failed", fallbackHint: "Check amounts and try again." },
          ),
        );
        setCostTrackResult(null);
        return;
      }
      const res = /** @type {{ result?: Record<string, unknown> }} */ (out).result;
      setCostTrackResult(res && typeof res === "object" && !Array.isArray(res) ? res : null);
    } catch (e) {
      setCostError(
        userFacingError(e, {
          fallback: "Cost update failed",
          fallbackHint: "Check amounts and try again.",
        }),
      );
      setCostTrackResult(null);
    } finally {
      setCostBusy(false);
    }
  }, [initialCostStr, manualSupplementStr, selectedProject]);

  const submitReceipt = useCallback(async () => {
    setReceiptFormError(null);
    const proj = receiptProject.trim();
    const sub = receiptSubproject.trim();
    const sec = receiptSection.trim();
    const asg = receiptAssignee.trim();
    if (!proj) {
      setReceiptFormError({
        type: "input",
        message: "Project is required.",
        actionHint: "Enter the project name or pick from the scan list.",
      });
      return;
    }
    if (!sub) {
      setReceiptFormError({
        type: "input",
        message: "Subproject is required.",
        actionHint: "Enter a subproject or phase label.",
      });
      return;
    }
    if (!sec) {
      setReceiptFormError({
        type: "input",
        message: "Section is required.",
        actionHint: "Enter a section or scope label.",
      });
      return;
    }
    if (!asg) {
      setReceiptFormError({
        type: "input",
        message: "Assignee is required.",
        actionHint: "Enter who is accountable for this spend.",
      });
      return;
    }
    if (!receiptFile) {
      setReceiptFormError({
        type: "input",
        message: "Attach a receipt image.",
        actionHint: "Use the file field to upload a photo or scan (PNG, JPG, WebP).",
      });
      return;
    }
    const vendor = receiptVendor.trim();
    if (!vendor) {
      setReceiptFormError({
        type: "input",
        message: "Vendor is required.",
        actionHint: "Enter the store or contractor name.",
      });
      return;
    }
    const amount = Number(String(receiptAmountStr).replace(/,/g, ""));
    if (!Number.isFinite(amount)) {
      setReceiptFormError({
        type: "input",
        message: "Enter a valid receipt total.",
        actionHint: "Use numbers for the amount.",
      });
      return;
    }
    if (!String(receiptDate ?? "").trim()) {
      setReceiptFormError({
        type: "input",
        message: "Date is required.",
        actionHint: "Pick the receipt date.",
      });
      return;
    }
    setReceiptAddBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result ?? ""));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(receiptFile);
      });
      const out = await runReceiptAdd({
        vendor,
        amount,
        date: receiptDate,
        note: receiptNote.trim(),
        imageBase64: dataUrl,
        filename: receiptFile.name,
        tags: {
          domain: "contractor",
          path: [proj, sub, sec],
          assignee: asg,
        },
      });
      if (!out || /** @type {{ ok?: boolean }} */ (out).ok !== true) {
        setReceiptFormError(
          userFacingError(
            typeof /** @type {{ error?: string }} */ (out).error === "string"
              ? /** @type {{ error: string }} */ (out).error
              : null,
            { fallback: "Could not save receipt", fallbackHint: "Try a smaller image or different format." },
          ),
        );
        return;
      }
      setReceiptVendor("");
      setReceiptAmountStr("");
      setReceiptNote("");
      setReceiptSubproject("");
      setReceiptSection("");
      setReceiptAssignee("");
      setReceiptFile(null);
      await loadReceipts();
    } catch (e) {
      setReceiptFormError(
        userFacingError(e, {
          fallback: "Could not save receipt",
          fallbackHint: "Try again with a smaller image.",
        }),
      );
    } finally {
      setReceiptAddBusy(false);
    }
  }, [receiptProject, receiptSubproject, receiptSection, receiptAssignee, receiptFile, receiptVendor, receiptAmountStr, receiptDate, receiptNote, loadReceipts]);

  const compareRec =
    compareResult && typeof compareResult === "object" && !Array.isArray(compareResult)
      ? /** @type {Record<string, unknown>} */ (compareResult)
      : null;
  const insightLabel = compareRec && typeof compareRec.insightLabel === "string" ? compareRec.insightLabel : "";
  const comparisonsList =
    compareRec && Array.isArray(compareRec.comparisons) ? /** @type {unknown[]} */ (compareRec.comparisons) : [];
  const isMultiCompare = comparisonsList.length > 1;

  const progressForCombined = progressInsightLabelFromCompare(compareResult);

  const combinedInsight = useMemo(() => {
    if (!costTrackResult) return "";
    const overBudget = costTrackResult.overBudget === true;
    const deltaRaw = typeof costTrackResult.delta === "number" ? costTrackResult.delta : Number(costTrackResult.delta);
    const deltaAbs = Number.isFinite(deltaRaw) ? Math.abs(deltaRaw) : 0;
    const pct =
      costTrackResult.percentChange != null && Number.isFinite(Number(costTrackResult.percentChange))
        ? Number(costTrackResult.percentChange)
        : null;
    const roomLabel = [selectedRoom, selectedProject].filter(Boolean).join(" · ") || "Project";
    if (!progressForCombined) {
      if (!Number.isFinite(deltaRaw)) return "";
      const fmt = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });
      if (overBudget && deltaRaw > 0) return `${roomLabel}: ${costTrackResult.summary ?? `Over budget by ${fmt.format(deltaRaw)}`}`;
      if (deltaRaw < 0) return `${roomLabel}: under budget by ${fmt.format(deltaAbs)}`;
      return `${roomLabel}: on budget`;
    }
    return buildContractorCombinedInsight({
      roomLabel,
      insightLabel: progressForCombined,
      overBudget,
      budgetDelta: deltaAbs,
      percentChange: pct,
    });
  }, [costTrackResult, progressForCombined, selectedRoom, selectedProject]);

  return (
    <section className={`fitness-panel contractor-panel ${className}`.trim()} aria-labelledby="contractor-panel-heading">
      <h2 id="contractor-panel-heading" className="fitness-panel__title">
        Project dashboard
      </h2>
      <p className="fitness-panel__hint">
        Receipts save under <code>receipts/contractor/…</code> by project, subproject, section, and assignee (image + JSON per row).
        Timeline photos stay under <code>Projects/…/Rooms/…/Timeline/</code> (read-only scan). Spend totals use receipt sums plus other costs.
        Visual compare reuses the Fitness image engine.
      </p>

      <div className="fitness-panel__row">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void loadScan()}>
          {busy ? "Scanning…" : "Refresh projects"}
        </button>
        <label>
          Project
          <select
            value={selectedProject}
            onChange={(e) => {
              setSelectedProject(e.target.value);
              setSelectedRoom("");
              setPathA("");
              setPathB("");
              setComparisonMode("single");
              setCompareResult(null);
            }}
          >
            <option value="">—</option>
            {projects.map((p) => {
              const name =
                p && typeof p === "object" && !Array.isArray(p) ? String(/** @type {{ name?: string }} */ (p).name ?? "") : "";
              return name ? (
                <option key={name} value={name}>
                  {name}
                </option>
              ) : null;
            })}
          </select>
        </label>
        <label>
          Room
          <select
            value={selectedRoom}
            disabled={!selectedProject}
            onChange={(e) => {
              setSelectedRoom(e.target.value);
              setPathA("");
              setPathB("");
              setComparisonMode("single");
              setCompareResult(null);
            }}
          >
            <option value="">—</option>
            {roomsList.map((r) => {
              const name =
                r && typeof r === "object" && !Array.isArray(r) ? String(/** @type {{ name?: string }} */ (r).name ?? "") : "";
              return name ? (
                <option key={name} value={name}>
                  {name}
                </option>
              ) : null;
            })}
          </select>
        </label>
      </div>
      {selectedProject && roomsList.length === 0 ? (
        <p className="fitness-panel__hint contractor-panel__empty" style={{ margin: "0.35rem 0 0" }}>
          No rooms with timeline photos for this project yet. Add{" "}
          <code>Projects/…/Rooms/…/Timeline/…</code> folders, then refresh.
        </p>
      ) : null}

      <div className="fitness-panel__row" style={{ flexWrap: "wrap", alignItems: "flex-end", marginTop: "0.45rem" }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={projectPersistBusy || !selectedProject}
          onClick={() => void saveCurrentProject()}
        >
          {projectPersistBusy ? "…" : "Save Project"}
        </button>
        <label>
          Load Project
          <select
            value={loadProjectSlug}
            onChange={(e) => setLoadProjectSlug(e.target.value)}
            disabled={projectPersistBusy}
          >
            <option value="">—</option>
            {savedProjects.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name} ({s.slug})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={projectPersistBusy || !loadProjectSlug}
          onClick={() => void applyLoadedProject()}
        >
          Apply load
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={exportReportBusy || !selectedProject}
          onClick={() => void exportProjectReport()}
        >
          {exportReportBusy ? "…" : "Export Report"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={exportPdfBusy || !selectedProject}
          onClick={() => void exportProjectPdf()}
        >
          {exportPdfBusy ? "…" : "Export PDF Report"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={shareLinkBusy || !selectedProject}
          onClick={() => void generateShareLink()}
        >
          {shareLinkBusy ? "…" : "Generate share link"}
        </button>
      </div>
      {shareLinkHint ? (
        <p className="fitness-panel__hint" style={{ margin: "0.35rem 0 0", fontSize: "0.82rem" }}>
          {shareLinkHint}
        </p>
      ) : null}
      <UserFacingAlert
        value={projectPersistError}
        className="fitness-panel__error"
        hintClassName="fitness-panel__error-hint"
      />

      <div className="contractor-panel__receipts" style={{ marginTop: "0.85rem" }}>
        <strong>Receipts</strong>
        <p className="fitness-panel__hint" style={{ margin: "0.2rem 0 0.5rem" }}>
          {receiptLoadBusy ? "Loading receipts…" : `${allReceipts.length} receipt(s) in workspace.`} Use the camera on mobile
          via the file picker when supported.
          {ocrBusy ? " Running OCR on the image…" : " OCR suggests vendor, amount, and date — verify before saving."}
        </p>
        {!receiptLoadBusy && allReceipts.length === 0 ? (
          <p className="contractor-panel__empty" style={{ margin: "0 0 0.65rem", fontSize: "0.88rem" }}>
            No receipts yet. Add one with the form below (project, subproject, section, and assignee must all be filled).
          </p>
        ) : null}
        <div className="fitness-panel__row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <label>
            Receipt image
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => void onReceiptImagePicked(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Project
            <input
              type="text"
              list="contractor-receipt-project-datalist"
              value={receiptProject}
              onChange={(e) => setReceiptProject(e.target.value)}
              placeholder="Project name"
              autoComplete="off"
            />
            <datalist id="contractor-receipt-project-datalist">
              {projects.map((p) => {
                const name =
                  p && typeof p === "object" && !Array.isArray(p) ? String(/** @type {{ name?: string }} */ (p).name ?? "") : "";
                return name ? <option key={`dl-${name}`} value={name} /> : null;
              })}
            </datalist>
          </label>
          <label>
            Subproject
            <input
              type="text"
              value={receiptSubproject}
              onChange={(e) => setReceiptSubproject(e.target.value)}
              placeholder="Phase or area"
              autoComplete="off"
            />
          </label>
          <label>
            Section
            <input
              type="text"
              value={receiptSection}
              onChange={(e) => setReceiptSection(e.target.value)}
              placeholder="Scope or trade"
              autoComplete="off"
            />
          </label>
          <label>
            Assignee
            <input
              type="text"
              value={receiptAssignee}
              onChange={(e) => setReceiptAssignee(e.target.value)}
              placeholder="Person or crew"
              autoComplete="off"
            />
          </label>
          <label>
            <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: "0.15rem" }}>
              Vendor
              <OcrConfHint ratio={ocrExtractMeta?.fieldConfidence?.vendor ?? null} />
            </span>
            <input
              type="text"
              value={receiptVendor}
              onChange={(e) => setReceiptVendor(e.target.value)}
              placeholder="Supplier or store"
              autoComplete="off"
            />
          </label>
          <label>
            <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: "0.15rem" }}>
              Amount
              <OcrConfHint ratio={ocrExtractMeta?.fieldConfidence?.amount ?? null} />
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={receiptAmountStr}
              onChange={(e) => setReceiptAmountStr(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label>
            <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: "0.15rem" }}>
              Date
              <OcrConfHint ratio={ocrExtractMeta?.fieldConfidence?.date ?? null} />
            </span>
            <input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
          </label>
          <label style={{ minWidth: "12rem", flex: "1 1 160px" }}>
            Note (optional)
            <input type="text" value={receiptNote} onChange={(e) => setReceiptNote(e.target.value)} placeholder="Memo" />
          </label>
          <button type="button" className="btn btn-primary" disabled={receiptAddBusy} onClick={() => void submitReceipt()}>
            {receiptAddBusy ? "Saving…" : "Add receipt"}
          </button>
        </div>
        <UserFacingAlert
          value={receiptFormError}
          className="fitness-panel__error"
          hintClassName="fitness-panel__error-hint"
        />
        {ocrExtractMeta?.rawText ? (
          <details style={{ marginTop: "0.45rem", fontSize: "0.78rem", maxWidth: "42rem" }}>
            <summary>OCR source text (highlighted matches)</summary>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                maxHeight: "10rem",
                overflow: "auto",
                margin: "0.35rem 0 0",
                padding: "0.5rem",
                background: "rgba(0,0,0,0.04)",
                borderRadius: "6px",
              }}
            >
              <OcrRawMarked
                raw={ocrExtractMeta.rawText}
                vendor={receiptVendor}
                amount={receiptAmountStr}
                date={receiptDate}
              />
            </pre>
          </details>
        ) : null}

        {allReceipts.length > 0 ? (
          <div className="contractor-panel__receipt-list" style={{ marginTop: "0.75rem" }}>
            <strong style={{ fontSize: "0.85rem" }}>Receipts by project → subproject → section → assignee</strong>
            <ul style={{ listStyle: "none", padding: 0, margin: "0.4rem 0 0" }}>
              {sortedMapKeys(receiptTree).map((proj) => {
                const subMap = receiptTree.get(proj);
                if (!subMap) return null;
                return (
                  <li key={proj} style={{ marginBottom: "0.65rem" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.82rem", marginBottom: "0.25rem" }}>{proj}</div>
                    <ul style={{ listStyle: "none", padding: "0 0 0 0.65rem", margin: 0 }}>
                      {sortedMapKeys(subMap).map((sub) => {
                        const secMap = subMap.get(sub);
                        if (!secMap) return null;
                        return (
                          <li key={`${proj}-${sub}`} style={{ marginBottom: "0.45rem" }}>
                            <div style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.15rem" }}>Subproject: {sub}</div>
                            <ul style={{ listStyle: "none", padding: "0 0 0 0.55rem", margin: 0 }}>
                              {sortedMapKeys(secMap).map((sec) => {
                                const asgMap = secMap.get(sec);
                                if (!asgMap) return null;
                                return (
                                  <li key={`${proj}-${sub}-${sec}`} style={{ marginBottom: "0.35rem" }}>
                                    <div style={{ fontSize: "0.74rem", color: "var(--text-muted, #6b7280)", marginBottom: "0.15rem" }}>
                                      Section: {sec}
                                    </div>
                                    <ul style={{ listStyle: "none", padding: "0 0 0 0.5rem", margin: 0 }}>
                                      {sortedMapKeys(asgMap).map((asg) => {
                                        const items = asgMap.get(asg) ?? [];
                                        return (
                                          <li key={`${proj}-${sub}-${sec}-${asg}`} style={{ marginBottom: "0.3rem" }}>
                                            <div style={{ fontSize: "0.72rem", marginBottom: "0.12rem" }}>
                                              Assignee: <strong>{asg}</strong>
                                            </div>
                                            <table
                                              className="contractor-receipt-table"
                                              style={{ width: "100%", fontSize: "0.78rem", borderCollapse: "collapse" }}
                                            >
                                              <thead>
                                                <tr
                                                  style={{
                                                    textAlign: "left",
                                                    borderBottom: "1px solid var(--border-default, #e5e7eb)",
                                                  }}
                                                >
                                                  <th style={{ padding: "0.2rem 0.35rem 0.2rem 0", width: 52 }} />
                                                  <th style={{ padding: "0.2rem 0.35rem" }}>Vendor</th>
                                                  <th style={{ padding: "0.2rem 0.35rem" }}>Amount</th>
                                                  <th style={{ padding: "0.2rem 0.35rem" }}>Date</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {items.map((rec) => {
                                                  const id = String(rec.id ?? "");
                                                  const path = String(rec.imagePath ?? "");
                                                  const v = String(rec.vendor ?? "");
                                                  const amt = rec.amount;
                                                  const d = String(rec.date ?? "");
                                                  return (
                                                    <tr key={id} style={{ borderBottom: "1px solid var(--border-default, #eee)" }}>
                                                      <td style={{ padding: "0.25rem 0.35rem 0.25rem 0", verticalAlign: "middle" }}>
                                                        <ReceiptThumb imagePath={path} />
                                                      </td>
                                                      <td style={{ padding: "0.25rem 0.35rem", verticalAlign: "middle" }}>{v}</td>
                                                      <td style={{ padding: "0.25rem 0.35rem", verticalAlign: "middle" }}>{String(amt)}</td>
                                                      <td style={{ padding: "0.25rem 0.35rem", verticalAlign: "middle" }}>{d}</td>
                                                    </tr>
                                                  );
                                                })}
                                              </tbody>
                                            </table>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </li>
                                );
                              })}
                            </ul>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
            <div className="contractor-panel__receipt-rollups" style={{ marginTop: "0.85rem", fontSize: "0.78rem" }}>
              <strong style={{ fontSize: "0.82rem" }}>Cost rollups</strong>
              <p className="fitness-panel__hint" style={{ margin: "0.2rem 0 0.4rem" }}>
                {selectedProject
                  ? `Totals below are scoped to the selected project (“${selectedProject}”). Pick a project above to filter.`
                  : "Totals include every receipt in the workspace. Select a project to scope rollups."}
              </p>
              <div style={{ display: "grid", gap: "0.65rem", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: "0.2rem" }}>By project</div>
                  <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                    {receiptRollups.byProject.map(([k, v]) => (
                      <li key={k}>
                        {k}: <strong>{Number(v.toFixed(2))}</strong>
                      </li>
                    ))}
                  </ul>
                  {!selectedProject ? (
                    <div style={{ marginTop: "0.25rem" }}>
                      All projects: <strong>{receiptRollups.scopedTotal}</strong>
                    </div>
                  ) : null}
                </div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: "0.2rem" }}>By section</div>
                  <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                    {receiptRollups.bySection.map(([k, v]) => (
                      <li key={k} style={{ wordBreak: "break-word" }}>
                        {k}: <strong>{Number(v.toFixed(2))}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: "0.2rem" }}>By assignee</div>
                  <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                    {receiptRollups.byAssignee.map(([k, v]) => (
                      <li key={k} style={{ wordBreak: "break-word" }}>
                        {k}: <strong>{Number(v.toFixed(2))}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {selectedProject ? (
                <p style={{ margin: "0.45rem 0 0", color: "var(--text-muted, #6b7280)" }}>
                  Scoped total: <strong>{receiptRollups.scopedTotal}</strong>
                  {receiptRollups.scopedTotal === 0 ? (
                    <span> · No receipts match this project (check names align with saved receipt slugs).</span>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="contractor-panel__assignee-performance" style={{ marginTop: "0.95rem" }}>
          <strong style={{ fontSize: "0.9rem" }}>Assignee performance</strong>
          <p className="fitness-panel__hint" style={{ margin: "0.2rem 0 0.45rem" }}>
            Progress uses timeline photos: matches receipt <strong>subproject</strong> to room and <strong>section</strong> to stage
            (slug-normalized). Cost is the sum of receipt amounts per assignee and section. Efficiency = progress / cost.
            {selectedProject ? ` Scoped to “${selectedProject}”.` : " All contractor receipts in the workspace."}
          </p>
          {assigneePerformanceRows.length === 0 ? (
            <p className="contractor-panel__empty" style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted, #6b7280)" }}>
              No contractor receipt groups yet. Saved receipts must use <code>domain: contractor</code> with a full path and
              assignee.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                className="contractor-performance-table"
                style={{ width: "100%", fontSize: "0.78rem", borderCollapse: "collapse", marginTop: "0.35rem" }}
              >
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border-default, #e5e7eb)" }}>
                    <th style={{ padding: "0.35rem 0.5rem 0.35rem 0" }}>Assignee</th>
                    <th style={{ padding: "0.35rem 0.5rem" }}>Section</th>
                    <th style={{ padding: "0.35rem 0.5rem" }}>Total cost</th>
                    <th style={{ padding: "0.35rem 0.5rem" }}>Progress</th>
                    <th style={{ padding: "0.35rem 0.5rem" }}>Efficiency</th>
                    <th style={{ padding: "0.35rem 0.5rem" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {assigneePerformanceRows.map((row, idx) => (
                    <tr key={`${row.assignee}-${row.sectionLabel}-${idx}`} style={{ borderBottom: "1px solid var(--border-default, #eee)" }}>
                      <td style={{ padding: "0.35rem 0.5rem 0.35rem 0", verticalAlign: "middle" }}>{row.assignee}</td>
                      <td style={{ padding: "0.35rem 0.5rem", verticalAlign: "middle", wordBreak: "break-word" }}>
                        {row.sectionLabel}
                      </td>
                      <td style={{ padding: "0.35rem 0.5rem", verticalAlign: "middle" }}>{row.cost}</td>
                      <td style={{ padding: "0.35rem 0.5rem", verticalAlign: "middle" }}>{row.progressCount}</td>
                      <td style={{ padding: "0.35rem 0.5rem", verticalAlign: "middle" }}>
                        {Number.isFinite(row.efficiency) ? row.efficiency.toFixed(4) : "∞"}
                      </td>
                      <td style={{ padding: "0.35rem 0.5rem", verticalAlign: "middle" }}>
                        <span
                          className={
                            row.status === "good"
                              ? "contractor-performance__status contractor-performance__status--good"
                              : row.status === "warning"
                                ? "contractor-performance__status contractor-performance__status--warning"
                                : "contractor-performance__status contractor-performance__status--problem"
                          }
                        >
                          {row.status === "good" ? "Good" : row.status === "warning" ? "Warning" : "Problem"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="contractor-panel__alerts" style={{ marginTop: "1rem" }}>
          <strong style={{ fontSize: "0.9rem" }}>Alerts</strong>
          {assigneeAlerts.length === 0 ? (
            <p className="fitness-panel__hint" style={{ margin: "0.25rem 0 0" }}>
              No assignee alerts for the current scope.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "0.45rem 0 0" }}>
              {[...alertsByAssignee.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([assignee, items]) => (
                  <li key={assignee} style={{ marginBottom: "0.65rem" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.82rem" }}>{assignee}</div>
                    <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1rem", fontSize: "0.8rem" }}>
                      {items.map((al, i) => (
                        <li key={`${al.section}-${i}-${al.type}`} style={{ marginBottom: "0.22rem" }}>
                          <span
                            className={`contractor-alert__icon contractor-alert__icon--${al.type}`}
                            aria-hidden="true"
                          >
                            {al.type === "good" ? "\u2713" : al.type === "warning" ? "\u26A0" : "\u2717"}
                          </span>{" "}
                          <span className={`contractor-alert contractor-alert--${al.type}`}>
                            <strong>{al.section}</strong>: {al.message}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      <div className="fitness-panel__row fitness-panel__row--wrap" style={{ marginTop: "0.75rem" }}>
        <div className="contractor-panel__cost" style={{ flex: "1 1 280px" }}>
          <strong>Budget vs actual</strong>
          {selectedProject ? (
            <p className="fitness-panel__hint" style={{ margin: "0.25rem 0 0.35rem" }}>
              Receipt subtotal (this project): <strong>{receiptSumSelectedProject}</strong>
              {" · "}
              Total spend = receipts + other costs below.
            </p>
          ) : null}
          {manualCostConflictMessage ? (
            <p
              className="contractor-panel__cost-warning"
              role="status"
              style={{
                margin: "0.35rem 0 0",
                padding: "0.45rem 0.55rem",
                fontSize: "0.82rem",
                borderRadius: "6px",
                background: "rgba(234, 179, 8, 0.12)",
                border: "1px solid rgba(234, 179, 8, 0.45)",
              }}
            >
              {manualCostConflictMessage}
            </p>
          ) : null}
          <div className="fitness-panel__row" style={{ marginTop: "0.35rem" }}>
            <label>
              Initial budget
              <input
                type="text"
                inputMode="decimal"
                placeholder="25000"
                value={initialCostStr}
                onChange={(e) => setInitialCostStr(e.target.value)}
                aria-label="Initial budget"
              />
            </label>
            <label>
              Other costs (non-receipt)
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={manualSupplementStr}
                onChange={(e) => setManualSupplementStr(e.target.value)}
                aria-label="Spend not on receipts"
              />
            </label>
            <button type="button" className="btn btn-secondary" disabled={costBusy} onClick={() => void applyCostTracking()}>
              {costBusy ? "…" : "Update cost"}
            </button>
          </div>
          <UserFacingAlert value={costError} className="fitness-panel__error" hintClassName="fitness-panel__error-hint" />
          {costTrackResult ? (
            <ul className="contractor-panel__cost-summary" style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem", fontSize: "0.85rem" }}>
              <li>
                Initial:{" "}
                <strong>{String(costTrackResult.initialCost ?? "—")}</strong>
              </li>
              {costTrackResult.receiptTotal != null ? (
                <li>
                  Receipt total:{" "}
                  <strong>{String(costTrackResult.receiptTotal)}</strong>
                </li>
              ) : null}
              {costTrackResult.manualSpendSupplement != null && Number(costTrackResult.manualSpendSupplement) !== 0 ? (
                <li>
                  Other costs:{" "}
                  <strong>{String(costTrackResult.manualSpendSupplement)}</strong>
                </li>
              ) : null}
              <li>
                Total spend:{" "}
                <strong>{String(costTrackResult.currentCost ?? "—")}</strong>
              </li>
              <li>
                Delta:{" "}
                <strong>{String(costTrackResult.delta ?? "—")}</strong>
                {costTrackResult.overBudget === true ? " (over budget)" : ""}
              </li>
              <li>
                % change:{" "}
                <strong>
                  {costTrackResult.percentChange == null ? "—" : `${costTrackResult.percentChange}%`}
                </strong>
              </li>
            </ul>
          ) : null}
        </div>
      </div>

      {selectedRoom && stageNames.length > 0 ? (
        <div className="fitness-panel__timeline" aria-label="Room timeline" style={{ marginTop: "0.75rem" }}>
          <strong>
            {selectedRoom} timeline
          </strong>
          <div className="fitness-panel__timeline-stages">
            {stageNames.map((s) => (
              <span key={s} className="fitness-panel__stage-pill">
                {s}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {selectedRoom && stageNames.length === 0 ? (
        <p className="contractor-panel__empty fitness-panel__hint" style={{ marginTop: "0.65rem" }}>
          This room has no timeline stages with photos yet. Add images under each stage folder in{" "}
          <code>Timeline</code>, then refresh.
        </p>
      ) : null}

      {selectedRoom && stageNames.length > 0 ? (
        <div className="fitness-panel__mode-row">
          <span className="fitness-panel__mode-row-label">Visual compare</span>
          <div className="fitness-panel__segmented" role="group" aria-label="Comparison mode">
            <button
              type="button"
              className={comparisonMode === "single" ? "is-active" : ""}
              onClick={() => {
                setComparisonMode("single");
                setCompareResult(null);
              }}
            >
              Single
            </button>
            <button
              type="button"
              className={comparisonMode === "sequential" ? "is-active" : ""}
              onClick={() => {
                setComparisonMode("sequential");
                setCompareResult(null);
              }}
            >
              Timeline
            </button>
            <button
              type="button"
              className={comparisonMode === "baseline" ? "is-active" : ""}
              onClick={() => {
                setComparisonMode("baseline");
                setCompareResult(null);
              }}
            >
              Baseline
            </button>
          </div>
        </div>
      ) : null}

      {selectedRoom && imageOptions.length > 0 && comparisonMode === "single" ? (
        <div className="fitness-panel__row">
          <label>
            Image A
            <select value={pathA} onChange={(e) => setPathA(e.target.value)}>
              <option value="">—</option>
              {imageOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Image B
            <select value={pathB} onChange={(e) => setPathB(e.target.value)}>
              <option value="">—</option>
              {imageOptions.map((o) => (
                <option key={`b-${o.value}`} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-primary" disabled={compareBusy} onClick={() => void runCompare()}>
            {compareBusy ? "Comparing…" : "Compare two images"}
          </button>
        </div>
      ) : null}

      {selectedRoom && imageOptions.length > 0 && comparisonMode !== "single" ? (
        <>
          <p className="fitness-panel__multi-hint">
            Uses the first image in each stage folder. Pairs follow the timeline order above.
          </p>
          <div className="fitness-panel__row">
            <button type="button" className="btn btn-primary" disabled={compareBusy} onClick={() => void runCompare()}>
              {compareBusy
                ? "Comparing…"
                : comparisonMode === "sequential"
                  ? "Compare adjacent stages"
                  : "Compare all to first stage"}
            </button>
          </div>
        </>
      ) : null}

      {comparisonMode === "single" && pathA && pathB ? (
        <div className="fitness-panel__pair-context" aria-label="Comparison stages">
          <strong>Pair</strong>: {stagePairLabel}
        </div>
      ) : null}

      {comparisonMode !== "single" && selectedRoom && stageNames.length >= 2 ? (
        <div className="fitness-panel__pair-context" aria-label="Comparison plan">
          <strong>Plan</strong>: {stageNames.length} stages ·{" "}
          {comparisonMode === "sequential"
            ? `${stageNames.length - 1} adjacent comparison(s)`
            : `${stageNames.length - 1} vs first stage`}
        </div>
      ) : null}

      {comparisonMode === "single" && pathA && pathB ? (
        <div className="fitness-panel__compare-toolbar">
          <span className="fitness-panel__compare-toolbar-label">View</span>
          <div className="fitness-panel__segmented" role="group" aria-label="Comparison layout">
            <button
              type="button"
              className={compareView === "side" ? "is-active" : ""}
              onClick={() => setCompareView("side")}
            >
              Side-by-side
            </button>
            <button
              type="button"
              className={compareView === "slider" ? "is-active" : ""}
              onClick={() => setCompareView("slider")}
            >
              Slider
            </button>
          </div>
          {previewBusy ? <span className="fitness-panel__preview-status">Loading previews…</span> : null}
        </div>
      ) : null}

      <UserFacingAlert
        value={previewErr}
        className="fitness-panel__error"
        hintClassName="fitness-panel__error-hint"
        role="alert"
      />

      {comparisonMode === "single" && pathA && pathB && previewUrlA && previewUrlB && !previewErr ? (
        <div className="fitness-panel__compare-visual">
          {compareView === "side" ? (
            <div className="fitness-panel__sidebyside">
              <figure>
                <figcaption>Image A</figcaption>
                <img src={previewUrlA} alt="" className="fitness-panel__compare-img" />
              </figure>
              <figure>
                <figcaption>Image B</figcaption>
                <img src={previewUrlB} alt="" className="fitness-panel__compare-img" />
              </figure>
            </div>
          ) : (
            <CompareSlider urlA={previewUrlA} urlB={previewUrlB} pct={sliderPct} onPctChange={setSliderPct} />
          )}
        </div>
      ) : null}

      <UserFacingAlert value={error} className="fitness-panel__error" hintClassName="fitness-panel__error-hint" role="alert" />

      {compareRec ? (
        <div className="fitness-panel__result">
          {isMultiCompare ? (
            <>
              <strong style={{ fontSize: "0.85rem" }}>Results along timeline</strong>
              <ul className="fitness-panel__comparison-list">
                {comparisonsList.map((row, idx) => {
                  const r = row && typeof row === "object" && !Array.isArray(row) ? /** @type {Record<string, unknown>} */ (row) : null;
                  const sa = r && typeof r.stageA === "string" ? r.stageA : "—";
                  const sb = r && typeof r.stageB === "string" ? r.stageB : "—";
                  const res =
                    r && r.result && typeof r.result === "object" && !Array.isArray(r.result)
                      ? /** @type {Record<string, unknown>} */ (r.result)
                      : null;
                  const ins = res && typeof res.insightLabel === "string" ? res.insightLabel : "—";
                  const sim = res != null && res.similarityScore != null ? String(res.similarityScore) : "";
                  return (
                    <li key={`${sa}-${sb}-${idx}`}>
                      <span className="fitness-panel__comparison-pair">
                        {sa} → {sb}
                      </span>
                      <span className={`fitness-panel__comparison-insight ${insightListClass(ins)}`}>{ins}</span>
                      {sim ? <span className="fitness-panel__comparison-meta">similarity {sim}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : insightLabel ? (
            <div className={`fitness-panel__insight ${insightToneClass(insightLabel)}`} role="status">
              <span className="fitness-panel__insight-label">{insightLabel} detected</span>
            </div>
          ) : null}
          {!isMultiCompare ? (
            <>
              <div>
                <strong>Similarity</strong>: {String(compareRec.similarityScore ?? "—")}
              </div>
              <div>
                <strong>Change detected</strong>: {String(compareRec.changeDetected ?? "—")}
              </div>
              <div>
                <strong>Confidence</strong>: {String(compareRec.confidence ?? "—")}
              </div>
            </>
          ) : null}
          <div style={{ marginTop: "0.35rem", fontSize: "0.72rem", color: "var(--text-muted, #6b7280)" }}>
            {String(compareRec.summary ?? "")}
          </div>
        </div>
      ) : null}

      {combinedInsight ? (
        <div className="fitness-panel__result contractor-panel__combined" role="status" style={{ marginTop: "0.75rem" }}>
          <strong>Combined insight</strong>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.88rem", lineHeight: 1.45 }}>{combinedInsight}</p>
        </div>
      ) : null}
    </section>
  );
}

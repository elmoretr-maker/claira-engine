import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recordCapabilityOverride, runFitnessImageComparison, runFitnessImageRead, runFitnessTimelineScan } from "../clairaApiClient.js";
import { UserFacingAlert } from "../UserFacingAlert.jsx";
import { userFacingError } from "../userFacingErrorMessage.js";
import "./FitnessTrackingPanel.css";

/** @typedef {import("../userFacingErrorMessage.js").UserFacingError} UserFacingError */

const MODULE_LABEL = "fitness_label_correction";

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
 * @param {{ className?: string }} props
 */
export default function FitnessTrackingPanel({ className = "" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {UserFacingError | null} */ (null));
  const [clients, setClients] = useState(/** @type {unknown[]} */ ([]));
  const [selectedClient, setSelectedClient] = useState("");
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
  const [learnStage, setLearnStage] = useState("");
  const [learnView, setLearnView] = useState("");
  const [learnStageCorrect, setLearnStageCorrect] = useState("");
  const [learnViewCorrect, setLearnViewCorrect] = useState("");
  const [feedbackMsg, setFeedbackMsg] = useState(/** @type {string | UserFacingError | null} */ (null));
  const [saveBusy, setSaveBusy] = useState(false);

  const loadScan = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const out = await runFitnessTimelineScan({});
      if (!out || /** @type {{ ok?: boolean }} */ (out).ok !== true) {
        setError(
          userFacingError(
            typeof /** @type {{ error?: string }} */ (out).error === "string"
              ? /** @type {{ error: string }} */ (out).error
              : null,
            {
              fallback: "Scan failed",
              fallbackHint: "Click Refresh scan. If it keeps failing, check the server console or restart the dev server.",
            },
          ),
        );
        setClients([]);
        return;
      }
      const list = /** @type {unknown[]} */ (/** @type {{ clients?: unknown }} */ (out).clients);
      setClients(Array.isArray(list) ? list : []);
      setSelectedClient("");
      setPathA("");
      setPathB("");
      setComparisonMode("single");
      setCompareResult(null);
    } catch (e) {
      setError(
        userFacingError(e, {
          fallback: "Scan failed",
          fallbackHint: "Click Refresh scan. If it keeps failing, check the server console or restart the dev server.",
        }),
      );
      setClients([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadScan();
  }, [loadScan]);

  const clientBlock = useMemo(() => {
    if (!selectedClient) return null;
    return clients.find(
      (c) =>
        c &&
        typeof c === "object" &&
        !Array.isArray(c) &&
        String(/** @type {{ name?: string }} */ (c).name ?? "") === selectedClient,
    );
  }, [clients, selectedClient]);

  const stageNames = useMemo(() => {
    const c = clientBlock && typeof clientBlock === "object" && !Array.isArray(clientBlock) ? clientBlock : null;
    if (!c) return [];
    const rec = /** @type {Record<string, unknown>} */ (c);
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
  }, [clientBlock]);

  const imageOptions = useMemo(() => {
    const c = clientBlock && typeof clientBlock === "object" && !Array.isArray(clientBlock) ? clientBlock : null;
    const stages = c && Array.isArray(/** @type {{ stages?: unknown }} */ (c).stages) ? /** @type {unknown[]} */ (c.stages) : [];
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
  }, [clientBlock]);

  const pathStageMap = useMemo(() => {
    const m = new Map();
    for (const o of imageOptions) m.set(o.value, o.stageName);
    return m;
  }, [imageOptions]);

  const pathsByStage = useMemo(() => {
    const c = clientBlock && typeof clientBlock === "object" && !Array.isArray(clientBlock) ? clientBlock : null;
    if (!c || !Array.isArray(/** @type {{ stages?: unknown }} */ (c).stages)) return {};
    const stages = /** @type {unknown[]} */ (c.stages);
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
  }, [clientBlock]);

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
              fallbackHint: "Pick two different workspace images, or refresh the scan and try again.",
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
              fallbackHint: "Pick two different workspace images, or refresh the scan and try again.",
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
            actionHint: "Choose Image A and Image B from the dropdowns, then click Compare.",
          });
          return;
        }
        if (pathA === pathB) {
          setError({
            type: "input",
            message: "Choose two different image paths.",
            actionHint: "Open each dropdown and pick two distinct files.",
          });
          return;
        }
        const stageA = pathStageMap.get(pathA) ?? "";
        const stageB = pathStageMap.get(pathB) ?? "";
        const out = await runFitnessImageComparison({
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
                fallbackHint: "Check your selections and try again, or switch to Single mode to pick two images manually.",
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
          message: "Need at least two timeline stages with images.",
          actionHint: "Use Refresh scan after adding photos, or switch to Single mode and compare two hand-picked files.",
        });
        return;
      }
      const out = await runFitnessImageComparison({
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
              fallbackHint: "Check your selections and try again, or switch to Single mode to pick two images manually.",
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
          fallbackHint: "Check your selections and try again, or switch to Single mode to pick two images manually.",
        }),
      );
    } finally {
      setCompareBusy(false);
    }
  }, [comparisonMode, pathA, pathB, pathStageMap, stageNames, pathsByStage]);

  const saveLearning = useCallback(async () => {
    setFeedbackMsg(null);
    const orig = {
      kind: "fitness_label_edit",
      stage: learnStage.trim() || null,
      body_view: learnView.trim() || null,
    };
    const fin = {
      kind: "fitness_label_edit",
      stage: learnStageCorrect.trim() || learnStage.trim() || null,
      body_view: learnViewCorrect.trim() || learnView.trim() || null,
    };
    if (JSON.stringify(orig) === JSON.stringify(fin)) {
      setFeedbackMsg({
        type: "input",
        message: "Change the corrected labels before saving.",
        actionHint: "Edit the corrected stage or body view fields so they differ from the originals.",
      });
      return;
    }
    setSaveBusy(true);
    try {
      const rowId = `fitness-label-${Date.now()}`;
      const out = await recordCapabilityOverride({
        rowId,
        moduleId: MODULE_LABEL,
        originalValues: { version: 1, ...orig },
        finalValues: { version: 1, ...fin },
        filename: selectedClient || rowId,
        timestamp: Date.now(),
      });
      if (out && typeof out === "object" && /** @type {{ ok?: boolean }} */ (out).ok === false) {
        setFeedbackMsg(
          userFacingError(
            typeof /** @type {{ error?: string }} */ (out).error === "string"
              ? /** @type {{ error: string }} */ (out).error
              : null,
            {
              fallback: "Save failed",
              fallbackHint: "Try again in a moment. If it still fails, check that the feedback store path is writable.",
            },
          ),
        );
        return;
      }
      setFeedbackMsg("Label correction saved to feedback store.");
    } catch (e) {
      setFeedbackMsg(
        userFacingError(e, {
          fallback: "Save failed",
          fallbackHint: "Try again in a moment. If it still fails, check that the feedback store path is writable.",
        }),
      );
    } finally {
      setSaveBusy(false);
    }
  }, [learnStage, learnView, learnStageCorrect, learnViewCorrect, selectedClient]);

  const compareRec =
    compareResult && typeof compareResult === "object" && !Array.isArray(compareResult)
      ? /** @type {Record<string, unknown>} */ (compareResult)
      : null;
  const insightLabel = compareRec && typeof compareRec.insightLabel === "string" ? compareRec.insightLabel : "";
  const comparisonsList =
    compareRec && Array.isArray(compareRec.comparisons) ? /** @type {unknown[]} */ (compareRec.comparisons) : [];
  const isMultiCompare = comparisonsList.length > 1;

  return (
    <section className={`fitness-panel ${className}`.trim()} aria-labelledby="fitness-panel-heading">
      <h2 id="fitness-panel-heading" className="fitness-panel__title">
        Fitness client timeline
      </h2>
      <p className="fitness-panel__hint">
        Scans <code>Clients</code> timeline folders under the workspace (read-only). Stages are ordered (before → numbered
        weeks → alphabetical → after/final). Compare two hand-picked images, adjacent stages along the timeline, or every
        stage vs the first.
      </p>

      <div className="fitness-panel__row">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void loadScan()}>
          {busy ? "Scanning…" : "Refresh scan"}
        </button>
        <label>
          Client
          <select
            value={selectedClient}
            onChange={(e) => {
              setSelectedClient(e.target.value);
              setPathA("");
              setPathB("");
              setComparisonMode("single");
              setCompareResult(null);
            }}
          >
            <option value="">—</option>
            {clients.map((c) => {
              const name =
                c && typeof c === "object" && !Array.isArray(c) ? String(/** @type {{ name?: string }} */ (c).name ?? "") : "";
              return name ? (
                <option key={name} value={name}>
                  {name}
                </option>
              ) : null;
            })}
          </select>
        </label>
      </div>

      {selectedClient && stageNames.length > 0 ? (
        <div className="fitness-panel__timeline" aria-label="Timeline stages">
          <strong>Timeline</strong>
          <div className="fitness-panel__timeline-stages">
            {stageNames.map((s) => (
              <span key={s} className="fitness-panel__stage-pill">
                {s}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {selectedClient && stageNames.length > 0 ? (
        <div className="fitness-panel__mode-row">
          <span className="fitness-panel__mode-row-label">Comparison</span>
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

      {selectedClient && imageOptions.length > 0 && comparisonMode === "single" ? (
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

      {selectedClient && imageOptions.length > 0 && comparisonMode !== "single" ? (
        <>
          <p className="fitness-panel__multi-hint">
            Uses the first image (by filename) in each stage folder. Pairs follow the timeline order above.
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

      {comparisonMode !== "single" && selectedClient && stageNames.length >= 2 ? (
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

      <div className="fitness-panel__learning">
        <h4>Label corrections (learning)</h4>
        <p className="fitness-panel__hint" style={{ marginTop: 0 }}>
          Optional: record corrected <code>stage</code> and <code>body_view</code> labels for future hint tuning (feedback
          store).
        </p>
        <div className="fitness-panel__learning-row">
          <input placeholder="Stage (original)" value={learnStage} onChange={(e) => setLearnStage(e.target.value)} />
          <input placeholder="Body view (original)" value={learnView} onChange={(e) => setLearnView(e.target.value)} />
        </div>
        <div className="fitness-panel__learning-row">
          <input placeholder="Stage (corrected)" value={learnStageCorrect} onChange={(e) => setLearnStageCorrect(e.target.value)} />
          <input
            placeholder="Body view (corrected)"
            value={learnViewCorrect}
            onChange={(e) => setLearnViewCorrect(e.target.value)}
          />
          <button type="button" className="btn btn-secondary" disabled={saveBusy} onClick={() => void saveLearning()}>
            {saveBusy ? "Saving…" : "Save correction"}
          </button>
        </div>
        {feedbackMsg ? (
          typeof feedbackMsg === "string" ? (
            <p className="fitness-panel__feedback" role="status">
              {feedbackMsg}
            </p>
          ) : (
            <UserFacingAlert
              value={feedbackMsg}
              className="fitness-panel__feedback fitness-panel__feedback--warning"
              hintClassName="fitness-panel__feedback-hint"
              role="status"
            />
          )
        ) : null}
      </div>
    </section>
  );
}

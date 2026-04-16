/**
 * Live processing flow UI — imports API module (Vite dev aliases this to a fetch client; see ui/vite.config.mjs).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { registerSimulation } from "../../core/simulationRegistry.js";
import "./ProcessingScreen.css";
import { formatPipelineErrorForDisplay } from "../formatPipelineError.js";
import { ingestData, processData, processFolder } from "../../interfaces/api.js";
import GuidedStepChrome from "../onboarding/GuidedStepChrome.jsx";
import "../voice/ClairaVoiceChrome.css";

registerSimulation({
  name: "processing_replay_ui",
  location: "ui/screens/ProcessingScreen.jsx",
  description: "UI replay animation of results",
  replaceWith: "Live streaming updates (future)",
});

const STAGES = ["entrance", "processing", "rooms", "waiting", "output"];

/** @param {unknown} row */
function rowRel(row) {
  if (row == null || typeof row !== "object") return "?";
  const r = /** @type {Record<string, unknown>} */ (row);
  return String(r.rel ?? "?");
}

/** @param {unknown} row */
function isReviewRow(row) {
  if (row == null || typeof row !== "object") return false;
  const r = /** @type {Record<string, unknown>} */ (row);
  const pc0 = r.place_card;
  if (pc0 && typeof pc0 === "object" && /** @type {Record<string, unknown>} */ (pc0).user_override === "bypass_review") {
    return false;
  }
  if (r.room_validation != null) return true;
  if (r.priority != null) return true;
  if (typeof r.move_error === "string" && r.move_error.length) return true;
  if (typeof r.error === "string" && r.error.length) return true;
  const pc = r.place_card;
  if (pc && typeof pc === "object") {
    const decReason = String(/** @type {Record<string, unknown>} */ (pc).reason ?? "");
    if (decReason === "rejected_by_room") return true;
  }
  return false;
}

/** @param {unknown} row */
function roomLabelFromRow(row) {
  if (row == null || typeof row !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (row);
  const pc = r.place_card;
  if (pc && typeof pc === "object") {
    const dest = /** @type {Record<string, unknown>} */ (pc).proposed_destination;
    if (dest != null) {
      const s = String(dest).replace(/\\/g, "/").replace(/\/+$/, "");
      const parts = s.split("/").filter(Boolean);
      return parts.length ? parts[parts.length - 1] : s;
    }
  }
  return null;
}

/**
 * @param {unknown[]} results
 * @param {number} upToExclusive */
function cumulativeStats(results, upToExclusive) {
  const slice = results.slice(0, Math.max(0, upToExclusive));
  let review = 0;
  let moved = 0;
  /** @type {Set<string>} */
  const roomNames = new Set();
  let accepted = 0;

  for (const row of slice) {
    if (isReviewRow(row)) {
      review += 1;
      continue;
    }
    if (row != null && typeof row === "object" && /** @type {Record<string, unknown>} */ (row).place_card != null) {
      accepted += 1;
    }
    if (row != null && typeof row === "object" && "moved_to" in row && row.moved_to != null) {
      moved += 1;
      const label = roomLabelFromRow(row);
      if (label) roomNames.add(label);
    }
  }

  return { review, moved, roomNames: [...roomNames], accepted };
}

/** @param {unknown} row */
function stageHintForRow(row) {
  if (isReviewRow(row)) return "waiting";
  if (row != null && typeof row === "object" && "moved_to" in row && row.moved_to != null) return "output";
  if (row != null && typeof row === "object" && /** @type {Record<string, unknown>} */ (row).place_card != null)
    return "rooms";
  return "processing";
}

/**
 * @param {{
 *   mode?: "folder" | "data",
 *   folderPath?: string,
 *   ingestSource?: "file" | "external",
 *   ingestInput?: string,
 *   normalizedItems?: unknown[],
 *   cwd?: string,
 *   replayMs?: number,
 *   entranceContext?: { intentLabel: string, settings?: Record<string, unknown> },
 *   onBackToEntrance?: () => void,
 *   onProcessingComplete?: (out: {
 *     results: unknown[],
 *     processed: number,
 *     moved: number,
 *     review: number,
 *     reviewPriorityCounts?: { high: number, medium: number, low: number },
 *   }) => void,
 *   onViewRooms?: () => void,
 *   runtimeContext?: {
 *     appMode?: string,
 *     oversightLevel?: string,
 *     autoMove?: boolean,
 *     strictValidation?: boolean,
 *     reviewThreshold?: number,
 *   },
 *   guidedStep?: number,
 * }} props
 */
export default function ProcessingScreen({
  mode = "folder",
  folderPath = "",
  ingestSource = "file",
  ingestInput = "",
  normalizedItems = [],
  cwd,
  replayMs = 120,
  entranceContext,
  onBackToEntrance,
  onProcessingComplete,
  onViewRooms,
  runtimeContext,
  guidedStep,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));

  const [sourceLabel, setSourceLabel] = useState(/** @type {string} */ ("—"));
  const [ingested, setIngested] = useState(0);

  const [results, setResults] = useState(/** @type {unknown[]} */ ([]));
  const [processedTotal, setProcessedTotal] = useState(0);

  const [replayIndex, setReplayIndex] = useState(0);
  const [replayActive, setReplayActive] = useState(false);
  const [highlight, setHighlight] = useState(/** @type {string} */ ("entrance"));

  const timerRef = useRef(/** @type {ReturnType<typeof setInterval> | null} */ (null));

  const effectiveCwd = cwd;

  const stopReplay = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setReplayActive(false);
  }, []);

  const startReplay = useCallback(
    (rows) => {
      stopReplay();
      if (!rows.length) {
        setReplayIndex(0);
        setHighlight("output");
        return;
      }
      setReplayActive(true);
      setReplayIndex(0);
      setHighlight("entrance");
      let i = 0;
      timerRef.current = setInterval(() => {
        i += 1;
        if (i >= rows.length) {
          stopReplay();
          setReplayIndex(rows.length);
          setHighlight("output");
          return;
        }
        setReplayIndex(i);
        const row = rows[i - 1];
        setHighlight(stageHintForRow(row));
      }, replayMs);
    },
    [replayMs, stopReplay],
  );

  useEffect(() => () => stopReplay(), [stopReplay]);

  const replayUpto = replayActive ? replayIndex : results.length;
  const live = useMemo(() => cumulativeStats(results, replayUpto), [results, replayUpto]);

  const currentRel = busy
    ? "…"
    : replayActive && replayIndex > 0
      ? rowRel(results[replayIndex - 1])
      : replayActive
        ? "…"
        : "—";
  const progressTotal = results.length;
  const progressCurrent = replayActive ? Math.min(replayIndex, progressTotal) : progressTotal;

  const waitingCount = live.review;
  const outputMovedCount = live.moved;

  const run = useCallback(async () => {
    setError(null);
    setBusy(true);
    stopReplay();
    setResults([]);
    setReplayIndex(0);
    setHighlight("entrance");
    setIngested(0);
    setSourceLabel("—");

    try {
      if (mode === "folder") {
        if (!folderPath?.trim()) throw new Error("folderPath is required for mode=folder");
        setSourceLabel("file");
        const out = await processFolder(folderPath, {
          ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
          ...(runtimeContext ? { runtimeContext } : {}),
        });
        setIngested(out.results?.length ?? 0);
        setResults(Array.isArray(out.results) ? out.results : []);
        setProcessedTotal(typeof out.processed === "number" ? out.processed : out.results?.length ?? 0);
        startReplay(Array.isArray(out.results) ? out.results : []);
        onProcessingComplete?.({
          results: Array.isArray(out.results) ? out.results : [],
          processed: typeof out.processed === "number" ? out.processed : 0,
          moved: typeof out.moved === "number" ? out.moved : 0,
          review: typeof out.review === "number" ? out.review : 0,
          reviewPriorityCounts: out.reviewPriorityCounts,
        });
      } else {
        let items = normalizedItems;
        if (ingestSource === "file" && ingestInput?.trim()) {
          const ing = await ingestData(
            { source: "file", input: ingestInput },
            effectiveCwd ? { cwd: effectiveCwd } : {},
          );
          items = ing.items;
          setSourceLabel("file");
        } else if (ingestSource === "external") {
          const ing = await ingestData({ source: "external" }, effectiveCwd ? { cwd: effectiveCwd } : {});
          items = ing.items;
          setSourceLabel("external");
        } else {
          setSourceLabel(ingestSource);
        }
        if (!Array.isArray(items) || !items.length) {
          throw new Error("No items to process — provide ingestInput/ingestSource or normalizedItems");
        }
        setIngested(items.length);
        const out = await processData(items, {
          ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
          ...(runtimeContext ? { runtimeContext } : {}),
        });
        setResults(Array.isArray(out.results) ? out.results : []);
        setProcessedTotal(typeof out.processed === "number" ? out.processed : out.results?.length ?? 0);
        startReplay(Array.isArray(out.results) ? out.results : []);
        onProcessingComplete?.({
          results: Array.isArray(out.results) ? out.results : [],
          processed: typeof out.processed === "number" ? out.processed : 0,
          moved: typeof out.moved === "number" ? out.moved : 0,
          review: typeof out.review === "number" ? out.review : 0,
          reviewPriorityCounts: out.reviewPriorityCounts,
        });
      }
    } catch (e) {
      setError(formatPipelineErrorForDisplay(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [
    mode,
    folderPath,
    ingestSource,
    ingestInput,
    normalizedItems,
    effectiveCwd,
    startReplay,
    stopReplay,
    onProcessingComplete,
    runtimeContext,
  ]);

  return (
    <>
      {typeof guidedStep === "number" ? (
        <GuidedStepChrome step={guidedStep} phaseLabel="Processing" />
      ) : null}
      <div className="processing-screen">
      <header className="processing-header">
        <div className="claira-screen-heading-row" style={{ flex: "1 1 auto", minWidth: 0 }}>
          <div>
            <h1>I’m processing your items</h1>
            {entranceContext?.intentLabel ? (
              <p className="processing-subtitle">
                From intake: {entranceContext.intentLabel}
                {entranceContext.settings?.autoMove === false ? " · Auto-move off" : null}
              </p>
            ) : null}
          </div>
        </div>
        <div className="processing-actions">
          {typeof onBackToEntrance === "function" && typeof guidedStep !== "number" ? (
            <button type="button" className="btn btn-secondary" onClick={onBackToEntrance}>
              Back to intake
            </button>
          ) : null}
          {typeof onViewRooms === "function" ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || results.length === 0}
              onClick={onViewRooms}
            >
              View Rooms
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run()}>
            {busy ? "Running…" : "Run pipeline"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="processing-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="flow-row">
        <FlowCard
          title="Entrance"
          active={highlight === "entrance"}
          body={
            <>
              <div className="stat">
                <span className="label">Items ingested</span>
                <span className="value">{ingested}</span>
              </div>
              <div className="stat">
                <span className="label">Source</span>
                <span className="value">{sourceLabel}</span>
              </div>
            </>
          }
        />
        <FlowArrow />
        <FlowCard
          title="Processing"
          active={highlight === "processing"}
          body={
            <>
              <div className="stat">
                <span className="label">Current</span>
                <span className="value mono">{busy ? "…" : currentRel}</span>
              </div>
              <div className="stat">
                <span className="label">Progress</span>
                <progress
                  className="progress-bar"
                  value={progressTotal ? progressCurrent : 0}
                  max={Math.max(1, progressTotal)}
                />
                <span className="progress-label">
                  {progressCurrent} / {progressTotal || "—"}
                </span>
              </div>
            </>
          }
        />
        <FlowArrow />
        <FlowCard
          title="Rooms"
          active={highlight === "rooms"}
          body={
            <>
              <div className="stat">
                <span className="label">Accepted (routed)</span>
                <span className="value">{live.accepted}</span>
              </div>
              <div className="stat">
                <span className="label">Room names</span>
                <span className="value room-chips">
                  {live.roomNames.length ? live.roomNames.join(", ") : "—"}
                </span>
              </div>
            </>
          }
        />
        <FlowArrow />
        <div className="waiting-wrap">
          {waitingCount > 0 ? <div className="waiting-alert" aria-hidden="true" /> : null}
          <FlowCard
            title="Review queue"
            active={highlight === "waiting"}
            alert={waitingCount > 0}
            body={
              <>
                <div className="stat">
                  <span className="label">Review items</span>
                  <span className={`value ${waitingCount > 0 ? "review-hot" : ""}`}>{waitingCount}</span>
                </div>
                {waitingCount > 0 ? (
                  <div className="review-indicator" title="Needs your review">
                    <span className="dot" />
                    Attention needed
                  </div>
                ) : null}
              </>
            }
          />
        </div>
        <FlowArrow />
        <FlowCard
          title="Output"
          active={highlight === "output"}
          body={
            <>
              <div className="stat">
                <span className="label">Moved</span>
                <span className="value">{outputMovedCount}</span>
              </div>
              <div className="stat">
                <span className="label">Processed (API)</span>
                <span className="value">{processedTotal}</span>
              </div>
            </>
          }
        />
      </div>

      <footer className="processing-footer mono">
        stages: {STAGES.map((s) => (s === highlight ? `[${s}]` : s)).join(" → ")}
      </footer>
    </div>
    </>
  );
}

/**
 * @param {{ title: string, body: import("react").ReactNode, active?: boolean, alert?: boolean }} props
 */
function FlowCard({ title, body, active, alert }) {
  return (
    <section
      className={`card flow-card ${active ? "flow-card--active" : ""} ${alert ? "flow-card--alert" : ""}`}
    >
      <h2>{title}</h2>
      <div className="flow-card-body">{body}</div>
    </section>
  );
}

function FlowArrow() {
  return (
    <div className="flow-arrow" aria-hidden="true">
      →
    </div>
  );
}

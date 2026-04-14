import "./SessionReport.css";
import { compareSessionWorkflow } from "../sessionWorkflowCompare.js";
import GuidedStepChrome from "../onboarding/GuidedStepChrome.jsx";
import "../voice/ClairaVoiceChrome.css";

/** @typedef {{ processed?: number, moved?: number, review?: number }} SessionSummary */

const BREAKDOWN_KEYS = [
  "rejected_by_room",
  "text_mismatch",
  "text_label_conflict",
  "text_routing_conflict",
  "text_insight_flag",
];

/** @param {unknown} n */
function num(n) {
  if (n == null || n === "") return 0;
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

/** @param {unknown} row */
function rowRecord(row) {
  return row != null && typeof row === "object" && !Array.isArray(row)
    ? /** @type {Record<string, unknown>} */ (row)
    : null;
}

/** @param {Record<string, unknown>} r */
function hasRejectedByRoom(r) {
  if (r.room_validation != null) return true;
  if (typeof r.reason === "string" && r.reason === "rejected_by_room") return true;
  const pc = r.place_card;
  if (pc && typeof pc === "object") {
    const pr = String(/** @type {Record<string, unknown>} */ (pc).reason ?? "");
    if (pr === "rejected_by_room") return true;
  }
  return false;
}

/** @param {string} key @param {Record<string, unknown>} r */
function rowMatchesBreakdownKey(key, r) {
  const reason = typeof r.reason === "string" ? r.reason : "";
  switch (key) {
    case "rejected_by_room":
      return hasRejectedByRoom(r);
    case "text_mismatch":
      return r.text_mismatch === true || reason === "text_mismatch";
    case "text_label_conflict":
      return r.text_label_conflict === true || reason === "text_label_conflict";
    case "text_routing_conflict":
      return r.text_routing_conflict === true || reason === "text_routing_conflict";
    case "text_insight_flag":
      return r.text_insight_flag === true || reason === "text_insight_flag";
    default:
      return false;
  }
}

/** @param {unknown[]} results */
function buildBreakdownCounts(results) {
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(BREAKDOWN_KEYS.map((k) => [k, 0]));
  for (const row of results) {
    const r = rowRecord(row);
    if (!r) continue;
    for (const key of BREAKDOWN_KEYS) {
      if (rowMatchesBreakdownKey(key, r)) counts[key] += 1;
    }
  }
  return counts;
}

/** @param {unknown[]} results */
function countReviewRows(results) {
  return results.filter((row) => {
    const r = rowRecord(row);
    if (!r) return false;
    return r.priority != null || r.room_validation != null;
  }).length;
}

/** @param {unknown[]} results */
function collectInsightLines(results) {
  /** @type {string[]} */
  const lines = [];
  /** @type {Set<string>} */
  const seen = new Set();

  const push = (s) => {
    const t = String(s).trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    lines.push(t);
  };

  let embeddingFailed = 0;
  let moveErrors = 0;
  let textInsightRows = 0;

  for (const row of results) {
    const r = rowRecord(row);
    if (!r) continue;
    if (r.error === "embedding_failed") embeddingFailed += 1;
    if (typeof r.move_error === "string" && r.move_error.length) moveErrors += 1;

    const ti = r.text_insights;
    if (ti && typeof ti === "object" && Array.isArray(/** @type {{ insights?: unknown }} */ (ti).insights)) {
      const arr = /** @type {{ insights: unknown[] }} */ (ti).insights;
      if (arr.length) textInsightRows += 1;
      for (const ins of arr) {
        if (typeof ins === "string" && ins.trim()) push(ins);
      }
    }

    const ta = r.text_analysis;
    if (ta && typeof ta === "object") {
      const reason = /** @type {{ reason?: unknown }} */ (ta).reason;
      if (typeof reason === "string" && reason.length) push(`OCR: ${reason}`);
    }

    if (r.text_label_suggestion && typeof r.text_label_suggestion === "object") {
      const ts = /** @type {{ suggested_label?: unknown }} */ (r.text_label_suggestion);
      if (ts.suggested_label != null) {
        push(`Label hint from text: ${String(ts.suggested_label)}`);
      }
    }

    if (r.text_destination_suggestion && typeof r.text_destination_suggestion === "object") {
      const ds = /** @type {{ suggested_destination?: unknown }} */ (r.text_destination_suggestion);
      if (ds.suggested_destination != null) {
        push(`Destination hint from text: ${String(ds.suggested_destination)}`);
      }
    }
  }

  if (embeddingFailed) push(`${embeddingFailed} file(s) failed embedding (not classified).`);
  if (moveErrors) push(`${moveErrors} move error(s) reported — check output paths.`);
  if (textInsightRows && !lines.some((l) => l.startsWith("OCR:"))) {
    push(`${textInsightRows} item(s) include OCR insight flags — see Waiting Room for details.`);
  }

  return lines.slice(0, 24);
}

/** @param {unknown} x */
function workflowItemLabel(x) {
  if (x == null) return "—";
  const s = typeof x === "string" ? x : String(x);
  const t = s.trim();
  return t.length ? t : "—";
}

/** @param {unknown} row */
function rowQuickLabel(row) {
  const r = rowRecord(row);
  if (!r) return "—";
  if (typeof r.rel === "string" && r.rel.trim()) return r.rel.trim();
  if (typeof r.file === "string" && r.file.trim()) return r.file.trim();
  return "—";
}

/** @param {unknown} row */
function rowStatusHint(row) {
  const r = rowRecord(row);
  if (!r) return "—";
  if (typeof r.reason === "string" && r.reason) return r.reason;
  if (r.room_validation != null) return "room review";
  if (r.priority != null) return `priority: ${String(r.priority)}`;
  if (r.moved_to != null) return "moved";
  if (r.place_card != null) return "routed";
  return "ok";
}

/**
 * @param {{
 *   summary?: SessionSummary | null,
 *   results?: unknown[],
 *   expectedItems?: string[],
 *   title?: string,
 *   onBackToRooms?: () => void,
 *   onContinueToWaiting?: () => void,
 *   waitingItemCount?: number,
 *   guidedStep?: number,
 *   onOpenWorkspace?: () => void,
 * }} props
 */
export default function SessionReport({
  summary = null,
  results = [],
  expectedItems = [],
  title = "Session report",
  onBackToRooms,
  onContinueToWaiting,
  waitingItemCount = 0,
  guidedStep,
  onOpenWorkspace,
}) {
  const list = Array.isArray(results) ? results : [];
  const s = summary != null && typeof summary === "object" && !Array.isArray(summary) ? summary : {};

  const processed = s.processed != null && Number.isFinite(Number(s.processed)) ? Number(s.processed) : list.length;
  const moved =
    s.moved != null && Number.isFinite(Number(s.moved))
      ? Number(s.moved)
      : list.filter((r) => rowRecord(r)?.moved_to != null).length;
  const review =
    s.review != null && Number.isFinite(Number(s.review)) ? Number(s.review) : countReviewRows(list);

  const hasRows = list.length > 0;
  const hasSummarySignal = num(processed) > 0 || num(moved) > 0 || num(review) > 0;
  const showEmpty = !hasRows && !hasSummarySignal;

  const breakdown = hasRows ? buildBreakdownCounts(list) : Object.fromEntries(BREAKDOWN_KEYS.map((k) => [k, 0]));
  const insightLines = hasRows ? collectInsightLines(list) : [];

  const userExpected = Array.isArray(expectedItems)
    ? expectedItems.filter((s) => typeof s === "string" && s.trim().length > 0)
    : [];
  const workflow = compareSessionWorkflow(expectedItems, list);
  const workflowDescription =
    userExpected.length > 0
      ? "Your expected tasks vs outcomes from this run."
      : "Expected label vs destination (from session rows).";

  const wfMatched = workflow.matched.length;
  const wfMissing = workflow.missing.length;
  const wfConflicting = workflow.conflicting.length;
  const wfUncertain = workflow.uncertain.length;

  let workflowStatusClass = "session-report-workflow-status--ok";
  let workflowStatusText = "All expected items matched outcomes.";
  if (wfMissing > 0 || wfConflicting > 0) {
    workflowStatusClass = "session-report-workflow-status--bad";
    workflowStatusText = "Some items are missing or conflict with outcomes — review below.";
  } else if (wfUncertain > 0) {
    workflowStatusClass = "session-report-workflow-status--warn";
    workflowStatusText = "Some matches are uncertain — verify when you can.";
  }

  /** @type {Array<{ kind: 'missing' | 'conflicting', expected: unknown, actual?: unknown }>} */
  const workflowDetailItems = [];
  for (const m of workflow.missing) {
    if (workflowDetailItems.length >= 10) break;
    workflowDetailItems.push({ kind: "missing", expected: m.expected });
  }
  for (const c of workflow.conflicting) {
    if (workflowDetailItems.length >= 10) break;
    workflowDetailItems.push({ kind: "conflicting", expected: c.expected, actual: c.actual });
  }

  return (
    <>
      {typeof guidedStep === "number" ? (
        <GuidedStepChrome step={guidedStep} phaseLabel="Review" />
      ) : null}
      <div className="session-report">
      <header className="session-report-header">
        <div className="claira-screen-heading-row">
          <div>
            <h1>{title}</h1>
            <p>Summary of the last processing run — counts, review reasons, and notable signals.</p>
          </div>
        </div>
      </header>

      {showEmpty ? (
        <div className="card session-report-empty" role="status">
          No session data available
        </div>
      ) : (
        <>
          {hasRows ? (
            <section className="session-report-section" aria-labelledby="session-items">
              <h2 id="session-items">Items from this run</h2>
              <div className="card session-report-table-card">
                <div className="session-report-table-wrap">
                  <table className="session-report-table">
                    <thead>
                      <tr>
                        <th>File / path</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.slice(0, 200).map((row, i) => (
                        <tr key={`${rowQuickLabel(row)}-${i}`}>
                          <td className="session-report-table-mono">{rowQuickLabel(row)}</td>
                          <td>{rowStatusHint(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {list.length > 200 ? (
                  <p className="session-report-muted session-report-muted--flush">
                    Showing first 200 of {list.length} rows.
                  </p>
                ) : null}
                {typeof onOpenWorkspace === "function" ? (
                  <div className="session-report-workspace-cta">
                    <button type="button" className="btn btn-secondary" onClick={onOpenWorkspace}>
                      Edit product list in workspace
                    </button>
                    <span className="session-report-muted">
                      Spreadsheet-style edits apply to files on disk when you sync from Workspace.
                    </span>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="session-report-section" aria-labelledby="session-overview">
            <h2 id="session-overview">Overview</h2>
            <div className="session-report-overview">
              <div className="card session-report-stat">
                <span className="label">Total processed</span>
                <span className="value">{processed}</span>
              </div>
              <div className="card session-report-stat">
                <span className="label">Moved</span>
                <span className="value">{moved}</span>
              </div>
              <div className="card session-report-stat">
                <span className="label">Review</span>
                <span className="value">{review}</span>
              </div>
            </div>
          </section>

          <section className="session-report-section" aria-labelledby="session-breakdown">
            <h2 id="session-breakdown">Breakdown</h2>
            <div className="card">
              <p className="session-report-muted session-report-muted--flush">
                Counts by review signal (a row may appear in multiple categories).
              </p>
              <ul className="session-report-breakdown-list">
                {BREAKDOWN_KEYS.map((key) => (
                  <li key={key}>
                    <span className="reason-key">{key}</span>
                    <span className="reason-count">{breakdown[key] ?? 0}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="session-report-section" aria-labelledby="session-insights">
            <h2 id="session-insights">Insights</h2>
            <div className="card">
              <p className="session-report-muted session-report-muted--flush">Suggestions summary</p>
              <p className="session-report-body-text session-report-body-text--muted">
                Engine suggestions appear in the Suggestions panel (refresh after processing to update).
              </p>

              <p className="session-report-muted">Key warnings</p>
              {insightLines.length === 0 ? (
                <p className="session-report-body-text session-report-body-text--muted session-report-body-text--last">
                  No additional warnings for this session.
                </p>
              ) : (
                <ul className="session-report-insights-list">
                  {insightLines.map((line, i) => (
                    <li key={`${i}-${line.slice(0, 48)}`}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="session-report-section" aria-labelledby="session-workflow">
            <h2 id="session-workflow">Workflow Check</h2>
            <div className="card">
              <p className="session-report-muted session-report-muted--flush">{workflowDescription}</p>
              <div className={`session-report-workflow-status ${workflowStatusClass}`} role="status">
                {workflowStatusText}
              </div>
              <ul className="session-report-workflow-counts">
                <li>
                  <span className="session-report-workflow-count-label">Matched</span>
                  <span className="session-report-workflow-count-value">{wfMatched}</span>
                </li>
                <li>
                  <span className="session-report-workflow-count-label">Missing</span>
                  <span className="session-report-workflow-count-value">{wfMissing}</span>
                </li>
                <li>
                  <span className="session-report-workflow-count-label">Conflicting</span>
                  <span className="session-report-workflow-count-value">{wfConflicting}</span>
                </li>
                <li>
                  <span className="session-report-workflow-count-label">Uncertain</span>
                  <span className="session-report-workflow-count-value">{wfUncertain}</span>
                </li>
              </ul>
              {workflowDetailItems.length > 0 ? (
                <>
                  <p className="session-report-muted">Issues (sample)</p>
                  <ul className="session-report-workflow-details">
                    {workflowDetailItems.map((item, i) => (
                      <li key={`${item.kind}-${i}-${workflowItemLabel(item.expected).slice(0, 24)}`}>
                        <span className="session-report-workflow-detail-kind">{item.kind}</span>
                        <span className="session-report-workflow-detail-text">
                          expected: <strong>{workflowItemLabel(item.expected)}</strong>
                          {item.kind === "conflicting" ? (
                            <>
                              {" "}
                              · actual: <strong>{workflowItemLabel(item.actual)}</strong>
                            </>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </section>
        </>
      )}

      <footer className="session-report-footer">
        {typeof onContinueToWaiting === "function" && waitingItemCount > 0 ? (
          <button type="button" className="btn btn-secondary" onClick={onContinueToWaiting}>
            Next: help me with items ({waitingItemCount})
          </button>
        ) : null}
        {typeof onBackToRooms === "function" ? (
          <button type="button" className="btn btn-primary" onClick={onBackToRooms}>
            Continue to rooms
          </button>
        ) : null}
      </footer>
    </div>
    </>
  );
}

import "./WaitingRoom.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import GuidedStepChrome from "../onboarding/GuidedStepChrome.jsx";
import "../voice/ClairaVoiceChrome.css";
import { speakVoiceKey } from "../voice/speakVoiceKey.js";
import { getRiskInsights, getUserControlState, setUserControlRule } from "../clairaApiClient.js";
import { isBypassReviewPipelineRow, isConfirmPipelineRow } from "../pipelineRowUtils.js";

/**
 * @typedef {"high" | "medium" | "low"} ReviewPriority
 * @typedef {{
 *   label: string,
 *   score: number,
 * }} ConflictOption
 * @typedef {{
 *   kind: "classification_conflict",
 *   predicted_label: string | null,
 *   options: ConflictOption[],
 *   requires_user_input: boolean,
 *   filePath: string,
 *   potential_conflict?: boolean,
 *   strict_oversight?: boolean,
 *   tunnel_validation_mismatch?: boolean,
 *   expectedCategory?: string | null,
 * }} ClassificationConflict
 * @typedef {{
 *   file: string,
 *   reason: string,
 *   priority: ReviewPriority,
 *   score?: number,
 *   filePath?: string,
 *   classification_conflict?: ClassificationConflict,
 * }} ReviewItem
 */

/** @param {unknown} p */
function normalizePriority(p) {
  const s = String(p ?? "").toLowerCase();
  if (s === "high") return "high";
  if (s === "medium") return "medium";
  return "low";
}

/** @param {unknown} row */
function rowRel(row) {
  if (row == null || typeof row !== "object") return "—";
  const r = /** @type {Record<string, unknown>} */ (row);
  return String(r.rel ?? "?");
}

/** @param {unknown} row */
function rowFilePath(row) {
  if (row == null || typeof row !== "object") return "";
  const r = /** @type {Record<string, unknown>} */ (row);
  return typeof r.filePath === "string" ? r.filePath : "";
}

/** @param {unknown} entry */
function logEntryKey(entry) {
  const e = entry && typeof entry === "object" ? /** @type {Record<string, unknown>} */ (entry) : {};
  const ts = typeof e.timestamp === "number" ? e.timestamp : "";
  const p = String(e.predicted_label ?? "");
  const d = String(e.destination ?? "");
  if (ts === "" && !p && !d) return "";
  return `${ts}|${p}|${d}`;
}

/**
 * @param {{
 *   pipelineResults?: unknown[],
 *   sessionBypassLogSnapshot?: unknown[],
 *   reviewItems?: ReviewItem[],
 *   onConflictResolved?: (detail: {
 *     predicted_label: string | null,
 *     selected_label: string,
 *     filePath: string,
 *     scope: "global" | "single",
 *   }) => void,
 *   onContinueToRooms?: () => void,
 *   categoryUi?: Record<string, { label?: string, description?: string }>,
 *   guidedStep?: number,
 * }} props
 */
export default function WaitingRoom({
  pipelineResults = [],
  sessionBypassLogSnapshot = [],
  reviewItems = [],
  onConflictResolved,
  onContinueToRooms,
  categoryUi = {},
  guidedStep,
}) {
  const items = Array.isArray(reviewItems) ? reviewItems : [];
  const hasReviewItems = items.length > 0;
  const results = Array.isArray(pipelineResults) ? pipelineResults : [];

  /** @type {["review"|"confirm"|"bypassed"|"rules"|"activity", string][]} */
  const tabs = useMemo(
    () => [
      ["review", "Review"],
      ["confirm", "Confirm"],
      ["bypassed", "Bypassed review"],
      ["rules", "Rules / preferences"],
      ["activity", "Activity / log"],
    ],
    [],
  );

  const [activeTab, setActiveTab] = useState(/** @type {"review"|"confirm"|"bypassed"|"rules"|"activity"} */ ("review"));
  const [ucState, setUcState] = useState({ rules: /** @type {unknown[]} */ ([]), bypassLog: /** @type {unknown[]} */ ([]) });
  const [riskInsights, setRiskInsights] = useState(/** @type {unknown} */ (null));
  const [newRuleLabel, setNewRuleLabel] = useState("");
  const [newRuleEffect, setNewRuleEffect] = useState(/** @type {"force_review"|"bypass_review"} */ ("bypass_review"));
  const [rulesMessage, setRulesMessage] = useState(/** @type {string | null} */ (null));

  const confirmRows = useMemo(() => results.filter(isConfirmPipelineRow), [results]);
  const bypassRows = useMemo(() => results.filter(isBypassReviewPipelineRow), [results]);

  const sessionLogKeys = useMemo(() => {
    const snap = Array.isArray(sessionBypassLogSnapshot) ? sessionBypassLogSnapshot : [];
    const set = new Set();
    for (const e of snap) {
      const k = logEntryKey(e);
      if (k) set.add(k);
    }
    return set;
  }, [sessionBypassLogSnapshot]);

  const sessionLogNewestFirst = useMemo(() => {
    const s = Array.isArray(sessionBypassLogSnapshot) ? [...sessionBypassLogSnapshot] : [];
    s.reverse();
    return s;
  }, [sessionBypassLogSnapshot]);

  /** Full log on disk, newest first, excluding entries that belong to this run (so they only appear under Current session). */
  const bypassHistoryEntries = useMemo(() => {
    const log = ucState.bypassLog.slice();
    log.reverse();
    return log.filter((e) => !sessionLogKeys.has(logEntryKey(e)));
  }, [ucState.bypassLog, sessionLogKeys]);

  const activityBadgeCount = sessionLogNewestFirst.length + bypassHistoryEntries.length;

  const refreshUserControl = useCallback(async () => {
    setRulesMessage(null);
    try {
      const s = await getUserControlState();
      setUcState({
        rules: Array.isArray(s?.rules) ? s.rules : [],
        bypassLog: Array.isArray(s?.bypassLog) ? s.bypassLog : [],
      });
    } catch {
      setUcState({ rules: [], bypassLog: [] });
      setRulesMessage("Could not load user control state.");
    }
  }, []);

  useEffect(() => {
    void refreshUserControl();
  }, [refreshUserControl]);

  useEffect(() => {
    if (activeTab !== "activity") return;
    void (async () => {
      try {
        const r = await getRiskInsights();
        setRiskInsights(r);
      } catch {
        setRiskInsights(null);
      }
    })();
  }, [activeTab]);

  /** @type {Record<ReviewPriority, ReviewItem[]>} */
  const buckets = { high: [], medium: [], low: [] };
  for (const raw of items) {
    const item = {
      file: String(raw?.file ?? ""),
      reason: String(raw?.reason ?? ""),
      priority: normalizePriority(raw?.priority),
      score: typeof raw?.score === "number" && Number.isFinite(raw.score) ? raw.score : undefined,
      filePath: typeof raw?.filePath === "string" ? raw.filePath : undefined,
      classification_conflict:
        raw?.classification_conflict && typeof raw.classification_conflict === "object"
          ? /** @type {ClassificationConflict} */ (raw.classification_conflict)
          : undefined,
    };
    buckets[item.priority].push(item);
  }

  return (
    <>
      {typeof guidedStep === "number" ? (
        <GuidedStepChrome step={guidedStep} phaseLabel="Learning" />
      ) : null}
      <div className="waiting-room">
        <header className="waiting-room-header">
          <div className="claira-screen-heading-row">
            <div>
              <h1>Review and control</h1>
              <p>
                Separate tabs for items that need decisions, confirmation-only runs, this run&rsquo;s bypassed items,
                your rules, and the bypass audit trail. Bypassed items never appear in the Review tab. This run&rsquo;s
                bypass list is session-only; full disk history lives under Activity / log.
              </p>
            </div>
          </div>
        </header>

        <div className="waiting-room-tabs" role="tablist" aria-label="Post-processing views">
          {tabs.map(([id, label]) => {
            const count =
              id === "review"
                ? items.length
                : id === "confirm"
                  ? confirmRows.length
                  : id === "bypassed"
                    ? bypassRows.length
                    : id === "rules"
                      ? ucState.rules.length
                      : activityBadgeCount;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={`waiting-room-tab ${activeTab === id ? "waiting-room-tab--active" : ""}`}
                onClick={() => setActiveTab(id)}
              >
                {label}
                {count > 0 ? <span className="waiting-room-tab-badge">{count}</span> : null}
              </button>
            );
          })}
        </div>

        {typeof onContinueToRooms === "function" ? (
          <div className="waiting-room-continue-wrap">
            <button type="button" className="btn btn-primary" onClick={onContinueToRooms}>
              Continue to Rooms
            </button>
          </div>
        ) : null}

        {activeTab === "review" ? (
          <>
            {hasReviewItems ? (
              <div className="waiting-room-alert" role="status">
                <span className="dot" aria-hidden="true" />
                <span>
                  I need you on this—{items.length} item{items.length === 1 ? "" : "s"} waiting for your review
                </span>
              </div>
            ) : (
              <div className="waiting-room-empty waiting-room-empty--tab">
                Nothing in the review queue. Items that only had review bypassed appear under &ldquo;Bypassed
                review&rdquo;; auto-move-off items appear under &ldquo;Confirm&rdquo;.
              </div>
            )}
            {hasReviewItems ? (
              <div className="waiting-room-columns">
                <section className="waiting-room-column" aria-labelledby="col-high">
                  <h2 id="col-high">
                    <span aria-hidden="true">{"\u{1F534}"}</span> High priority
                  </h2>
                  {buckets.high.map((item, i) => (
                    <ReviewCard
                      key={`high-${item.file}-${i}`}
                      item={item}
                      categoryUi={categoryUi}
                      onConflictResolved={onConflictResolved}
                    />
                  ))}
                  {buckets.high.length === 0 ? <p className="waiting-room-column-empty">None</p> : null}
                </section>

                <section className="waiting-room-column" aria-labelledby="col-medium">
                  <h2 id="col-medium">
                    <span aria-hidden="true">{"\u{1F7E1}"}</span> Medium
                  </h2>
                  {buckets.medium.map((item, i) => (
                    <ReviewCard
                      key={`medium-${item.file}-${i}`}
                      item={item}
                      categoryUi={categoryUi}
                      onConflictResolved={onConflictResolved}
                    />
                  ))}
                  {buckets.medium.length === 0 ? <p className="waiting-room-column-empty">None</p> : null}
                </section>

                <section className="waiting-room-column" aria-labelledby="col-low">
                  <h2 id="col-low">
                    <span aria-hidden="true">{"\u26AA"}</span> Low
                  </h2>
                  {buckets.low.map((item, i) => (
                    <ReviewCard
                      key={`low-${item.file}-${i}`}
                      item={item}
                      categoryUi={categoryUi}
                      onConflictResolved={onConflictResolved}
                    />
                  ))}
                  {buckets.low.length === 0 ? <p className="waiting-room-column-empty">None</p> : null}
                </section>
              </div>
            ) : null}
          </>
        ) : null}

        {activeTab === "confirm" ? (
          <div className="waiting-room-tab-panel">
            <p className="waiting-room-tab-hint">
              These items have an automatic classification, but auto-move is off (<code>execution_mode: confirm</code>).
              The file was not moved until you confirm your workflow elsewhere.
            </p>
            {confirmRows.length === 0 ? (
              <div className="waiting-room-empty waiting-room-empty--tab">No confirmation-mode items in this run.</div>
            ) : (
              <ul className="waiting-room-dl-list">
                {confirmRows.map((row, i) => {
                  const pc =
                    row && typeof row === "object"
                      ? /** @type {Record<string, unknown>} */ (row).place_card
                      : null;
                  const pco = pc && typeof pc === "object" ? /** @type {Record<string, unknown>} */ (pc) : null;
                  return (
                    <li key={`c-${rowRel(row)}-${i}`} className="card waiting-room-meta-card">
                      <div className="waiting-room-meta-k">File</div>
                      <div className="waiting-room-meta-v">{rowRel(row)}</div>
                      <div className="waiting-room-meta-k">Predicted label</div>
                      <div className="waiting-room-meta-v">{String(pco?.predicted_label ?? "—")}</div>
                      <div className="waiting-room-meta-k">Destination</div>
                      <div className="waiting-room-meta-v">{String(pco?.proposed_destination ?? "—")}</div>
                      <div className="waiting-room-meta-k">Execution</div>
                      <div className="waiting-room-meta-v">confirm (no move yet)</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {activeTab === "bypassed" ? (
          <div className="waiting-room-tab-panel">
            <p className="waiting-room-tab-hint">
              <strong>Current session only</strong> — rows from this run&rsquo;s pipeline results where{" "}
              <code>user_override === bypass_review</code>. Claira still recorded <strong>decision: review</strong>; execution
              proceeded because a <strong>bypass_review</strong> rule matched. Persisted log lines and older runs are under{" "}
              <strong>Activity / log</strong>. Manage rules under <strong>Rules / preferences</strong>.
            </p>
            {bypassRows.length === 0 ? (
              <p className="waiting-room-column-empty">No bypassed items in the current results.</p>
            ) : (
              <ul className="waiting-room-dl-list">
                {bypassRows.map((row, i) => {
                  const rowRec = row && typeof row === "object" ? /** @type {Record<string, unknown>} */ (row) : {};
                  const pc =
                    row && typeof row === "object"
                      ? /** @type {Record<string, unknown>} */ (row).place_card
                      : null;
                  const pco = pc && typeof pc === "object" ? /** @type {Record<string, unknown>} */ (pc) : null;
                  const snapArr = Array.isArray(sessionBypassLogSnapshot) ? sessionBypassLogSnapshot : [];
                  const snapEl = snapArr[i];
                  const snapOb = snapEl && typeof snapEl === "object" ? /** @type {Record<string, unknown>} */ (snapEl) : null;
                  const tsLog = typeof snapOb?.timestamp === "number" ? snapOb.timestamp : null;
                  const tsUi = typeof rowRec.sessionBypassAt === "number" ? rowRec.sessionBypassAt : null;
                  const tsDis = tsLog ?? tsUi;
                  return (
                    <li key={`b-${rowRel(row)}-${i}`} className="card waiting-room-meta-card">
                      <div className="waiting-room-meta-k">Original decision</div>
                      <div className="waiting-room-meta-v">review</div>
                      <div className="waiting-room-meta-k">User override</div>
                      <div className="waiting-room-meta-v">bypass_review</div>
                      <div className="waiting-room-meta-k">Predicted label</div>
                      <div className="waiting-room-meta-v">{String(pco?.predicted_label ?? "—")}</div>
                      <div className="waiting-room-meta-k">Destination</div>
                      <div className="waiting-room-meta-v">{String(pco?.proposed_destination ?? "—")}</div>
                      <div className="waiting-room-meta-k">Timestamp</div>
                      <div className="waiting-room-meta-v">
                        {tsDis != null ? new Date(tsDis).toLocaleString() : "—"}
                      </div>
                      <div className="waiting-room-meta-k">Reason</div>
                      <div className="waiting-room-meta-v">{String(pco?.reason ?? "—")}</div>
                      <div className="waiting-room-meta-k">File</div>
                      <div className="waiting-room-meta-v">{rowRel(row)}</div>
                      <div className="waiting-room-meta-k">Path</div>
                      <div className="waiting-room-meta-v">{rowFilePath(row) || "—"}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {activeTab === "rules" ? (
          <div className="waiting-room-tab-panel">
            <p className="waiting-room-tab-hint">
              Rules apply by <strong>predicted label</strong> (same string Claira predicted). Disable or delete a rule to
              reverse bypass or force behavior.
            </p>
            {rulesMessage ? <div className="waiting-room-inline-msg">{rulesMessage}</div> : null}

            <div className="waiting-room-add-rule card">
              <h3 className="waiting-room-subheading">Add rule</h3>
              <label className="waiting-room-field">
                <span>Predicted label</span>
                <input
                  type="text"
                  value={newRuleLabel}
                  onChange={(ev) => setNewRuleLabel(ev.target.value)}
                  placeholder="e.g. terrain"
                  autoComplete="off"
                />
              </label>
              <label className="waiting-room-field">
                <span>Effect</span>
                <select
                  value={newRuleEffect}
                  onChange={(ev) =>
                    setNewRuleEffect(
                      ev.target.value === "force_review" ? "force_review" : "bypass_review",
                    )
                  }
                >
                  <option value="bypass_review">bypass_review — skip review interruption (execution proceeds)</option>
                  <option value="force_review">force_review — always send to review</option>
                </select>
              </label>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  void (async () => {
                    const label = newRuleLabel.trim();
                    if (!label) {
                      setRulesMessage("Enter a predicted label.");
                      return;
                    }
                    const res = await setUserControlRule({
                      predicted_label: label,
                      effect: newRuleEffect,
                      enabled: true,
                    });
                    if (res && /** @type {{ ok?: boolean }} */ (res).ok === false) {
                      setRulesMessage(String(/** @type {{ error?: string }} */ (res).error ?? "Save failed"));
                      return;
                    }
                    setNewRuleLabel("");
                    await refreshUserControl();
                  })();
                }}
              >
                Save rule
              </button>
            </div>

            <h3 className="waiting-room-subheading">Saved rules</h3>
            {ucState.rules.length === 0 ? (
              <p className="waiting-room-column-empty">No rules in <code>policies/userControl.json</code>.</p>
            ) : (
              <ul className="waiting-room-rule-list">
                {ucState.rules.map((raw, i) => {
                  const r = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
                  const pred = String(r.predicted_label ?? "");
                  const effect = String(r.effect ?? "");
                  const enabled = r.enabled !== false;
                  return (
                    <li key={`${pred}-${effect}-${i}`} className="card waiting-room-rule-card">
                      <div className="waiting-room-rule-head">
                        <span
                          className={`waiting-room-effect-badge ${
                            effect === "force_review"
                              ? "waiting-room-effect-badge--force"
                              : "waiting-room-effect-badge--bypass"
                          }`}
                        >
                          {effect === "force_review" ? "force_review" : "bypass_review"}
                        </span>
                        <code className="waiting-room-rule-label">{pred || "(empty)"}</code>
                      </div>
                      <div className="waiting-room-rule-actions">
                        <label className="waiting-room-toggle">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={() => {
                              void (async () => {
                                await setUserControlRule({
                                  predicted_label: pred,
                                  effect: /** @type {"force_review"|"bypass_review"} */ (effect),
                                  enabled: !enabled,
                                });
                                await refreshUserControl();
                              })();
                            }}
                          />
                          <span>Enabled</span>
                        </label>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            speakVoiceKey("warning_delete_rule");
                            void (async () => {
                              await setUserControlRule({
                                predicted_label: pred,
                                effect: /** @type {"force_review"|"bypass_review"} */ (effect),
                                remove: true,
                              });
                              await refreshUserControl();
                            })();
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <button type="button" className="btn btn-secondary waiting-room-refresh" onClick={() => void refreshUserControl()}>
              Refresh from disk
            </button>
          </div>
        ) : null}

        {activeTab === "activity" ? (
          <div className="waiting-room-tab-panel">
            <h3 className="waiting-room-subheading">Current session (bypass log)</h3>
            <p className="waiting-room-tab-hint">
              Entries from <code>bypass_review.json</code> that belong to this processing run (matched after the run
              completes). <strong>File-level detail</strong> is only on the <strong>Bypassed review</strong> tab — this
              section is the audit trail. Newest first.
            </p>
            {sessionLogNewestFirst.length === 0 ? (
              <p className="waiting-room-column-empty">
                {bypassRows.length > 0
                  ? "Log lines are not synced yet. Use Refresh log from disk below, or open this tab again after processing."
                  : "No bypass log entries for this run."}
              </p>
            ) : (
              <ul className="waiting-room-dl-list">
                {sessionLogNewestFirst.map((entry, i) => {
                  const e = entry && typeof entry === "object" ? /** @type {Record<string, unknown>} */ (entry) : {};
                  const ts = typeof e.timestamp === "number" ? e.timestamp : 0;
                  return (
                    <li key={`sess-log-${ts}-${i}`} className="card waiting-room-meta-card waiting-room-meta-card--log">
                      <div className="waiting-room-meta-k">Time</div>
                      <div className="waiting-room-meta-v">{ts ? new Date(ts).toLocaleString() : "—"}</div>
                      <div className="waiting-room-meta-k">Original decision</div>
                      <div className="waiting-room-meta-v">{String(e.original_decision ?? "—")}</div>
                      <div className="waiting-room-meta-k">User override</div>
                      <div className="waiting-room-meta-v">{String(e.user_override ?? "—")}</div>
                      <div className="waiting-room-meta-k">Predicted label</div>
                      <div className="waiting-room-meta-v">{String(e.predicted_label ?? "—")}</div>
                      <div className="waiting-room-meta-k">Destination</div>
                      <div className="waiting-room-meta-v">{String(e.destination ?? "—")}</div>
                    </li>
                  );
                })}
              </ul>
            )}

            <h3 className="waiting-room-subheading">History</h3>
            <p className="waiting-room-tab-hint">
              Older entries from <code>bypass_review.json</code>. Events listed under <strong>Current session</strong>{" "}
              are omitted here so nothing is duplicated between the two sections.
            </p>
            {bypassHistoryEntries.length === 0 ? (
              <p className="waiting-room-column-empty">No prior bypass log entries, or log not loaded yet.</p>
            ) : (
              <ul className="waiting-room-dl-list">
                {bypassHistoryEntries.map((entry, i) => {
                  const e = entry && typeof entry === "object" ? /** @type {Record<string, unknown>} */ (entry) : {};
                  const ts = typeof e.timestamp === "number" ? e.timestamp : 0;
                  return (
                    <li key={`hist-${ts}-${i}`} className="card waiting-room-meta-card waiting-room-meta-card--log">
                      <div className="waiting-room-meta-k">Time</div>
                      <div className="waiting-room-meta-v">{ts ? new Date(ts).toLocaleString() : "—"}</div>
                      <div className="waiting-room-meta-k">Original decision</div>
                      <div className="waiting-room-meta-v">{String(e.original_decision ?? "—")}</div>
                      <div className="waiting-room-meta-k">User override</div>
                      <div className="waiting-room-meta-v">{String(e.user_override ?? "—")}</div>
                      <div className="waiting-room-meta-k">Predicted label</div>
                      <div className="waiting-room-meta-v">{String(e.predicted_label ?? "—")}</div>
                      <div className="waiting-room-meta-k">Destination</div>
                      <div className="waiting-room-meta-v">{String(e.destination ?? "—")}</div>
                    </li>
                  );
                })}
              </ul>
            )}

            <button type="button" className="btn btn-secondary waiting-room-refresh" onClick={() => void refreshUserControl()}>
              Refresh log from disk
            </button>

            <h3 className="waiting-room-subheading">Session risk signals</h3>
            <p className="waiting-room-tab-hint">
              In-memory hints from corrections this session (not durable learning). Empty if you have not triggered risk
              updates.
            </p>
            {!riskInsights ? (
              <p className="waiting-room-column-empty">Could not load risk insights.</p>
            ) : (
              <pre className="waiting-room-json-preview">{JSON.stringify(riskInsights, null, 2)}</pre>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * @param {{
 *   item: ReviewItem,
 *   categoryUi?: Record<string, { label?: string }>,
 *   onConflictResolved?: (detail: {
 *     predicted_label: string | null,
 *     selected_label: string,
 *     filePath: string,
 *     scope: "global" | "single",
 *   }) => void,
 * }} props
 */
function ReviewCard({ item, onConflictResolved, categoryUi = {} }) {
  const [conflictPhase, setConflictPhase] = useState(/** @type {"pick" | "scope"} */ ("pick"));
  const [pendingLabel, setPendingLabel] = useState(/** @type {string | null} */ (null));

  const cc = item.classification_conflict;
  const isConflict =
    cc?.kind === "classification_conflict" &&
    cc.requires_user_input === true &&
    Array.isArray(cc.options) &&
    cc.options.length > 0 &&
    typeof cc.filePath === "string" &&
    cc.filePath.length > 0;

  if (isConflict) {
    const tunnelMismatch = cc.tunnel_validation_mismatch === true;
    const patternMismatch = cc.potential_conflict === true;
    const strict = cc.strict_oversight === true;

    if (conflictPhase === "scope" && pendingLabel != null) {
      return (
        <article className="card waiting-room-card waiting-room-card--conflict">
          <div className="file">{item.file || "(unnamed)"}</div>
          <div className="reason">{item.reason || "—"}</div>
          <p className="waiting-room-conflict-prompt">
            <strong>Should this be applied to all similar cases?</strong>
          </p>
          <p className="waiting-room-scope-hint">
            Chosen label:{" "}
            <strong>
              {pendingLabel
                ? categoryUi[String(pendingLabel).trim()]?.label?.trim() || pendingLabel
                : "—"}
            </strong>
            {strict ? (
              <span className="waiting-room-strict-note"> Strict oversight: confirm learning scope.</span>
            ) : null}
          </p>
          <div className="waiting-room-conflict-actions waiting-room-scope-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onConflictResolved?.({
                  predicted_label: cc.predicted_label ?? null,
                  selected_label: pendingLabel,
                  filePath: cc.filePath,
                  scope: "global",
                });
                setConflictPhase("pick");
                setPendingLabel(null);
              }}
            >
              Yes (learn globally)
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                onConflictResolved?.({
                  predicted_label: cc.predicted_label ?? null,
                  selected_label: pendingLabel,
                  filePath: cc.filePath,
                  scope: "single",
                });
                setConflictPhase("pick");
                setPendingLabel(null);
              }}
            >
              No (this instance only)
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setConflictPhase("pick");
                setPendingLabel(null);
              }}
            >
              Back
            </button>
          </div>
        </article>
      );
    }

    return (
      <article className="card waiting-room-card waiting-room-card--conflict">
        <div className="file">{item.file || "(unnamed)"}</div>
        <div className="reason">{item.reason || "—"}</div>
        {patternMismatch ? (
          <p className="waiting-room-tunnel-hint" role="status">
            This doesn’t match the reference pattern I expected—tell me which category fits.
          </p>
        ) : null}
        {tunnelMismatch ? (
          <p className="waiting-room-tunnel-hint" role="status">
            From our guided setup, I didn&apos;t land on the category we expected
            {cc.expectedCategory != null && String(cc.expectedCategory).length
              ? ` (${String(cc.expectedCategory)})`
              : ""}
            . Pick the right label below and I’ll learn from it.
          </p>
        ) : null}
        <p className="waiting-room-conflict-prompt">
          <strong>I need your call—which category is this?</strong>
        </p>
        <div className="waiting-room-conflict-actions">
          {cc.options.map((opt) => {
            const slug = String(opt.label ?? "").trim();
            const nice = categoryUi[slug]?.label?.trim() || slug;
            return (
              <button
                key={opt.label}
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setPendingLabel(opt.label);
                  setConflictPhase("scope");
                }}
              >
                {nice}
                {typeof opt.score === "number" ? (
                  <span className="waiting-room-option-score"> ({opt.score.toFixed(2)})</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </article>
    );
  }

  return (
    <article className="card waiting-room-card">
      <div className="file">{item.file || "(unnamed)"}</div>
      <div className="reason">{item.reason || "—"}</div>
      {item.score != null ? (
        <div className="score">Score: {item.score}</div>
      ) : null}
      <div className="waiting-room-actions">
        <button type="button" className="btn btn-secondary" disabled title="Coming soon">
          Assign Room
        </button>
        <button type="button" className="btn btn-secondary" disabled title="Coming soon">
          Apply Rule
        </button>
        <button type="button" className="btn btn-secondary" disabled title="Coming soon">
          Allow Once
        </button>
      </div>
    </article>
  );
}

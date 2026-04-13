import "./WaitingRoom.css";
import { useState } from "react";

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

/**
 * @param {{
 *   reviewItems?: ReviewItem[],
 *   onConflictResolved?: (detail: {
 *     predicted_label: string | null,
 *     selected_label: string,
 *     filePath: string,
 *     scope: "global" | "single",
 *   }) => void,
 *   onContinueToRooms?: () => void,
 *   categoryUi?: Record<string, { label?: string, description?: string }>,
 * }} props
 */
export default function WaitingRoom({
  reviewItems = [],
  onConflictResolved,
  onContinueToRooms,
  categoryUi = {},
}) {
  const items = Array.isArray(reviewItems) ? reviewItems : [];
  const hasItems = items.length > 0;

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
    <div className="waiting-room">
      {hasItems ? (
        <div className="waiting-room-alert" role="status">
          <span className="dot" aria-hidden="true" />
          <span>Review required — {items.length} item{items.length === 1 ? "" : "s"} need attention</span>
        </div>
      ) : null}

      <header className="waiting-room-header">
        <h1>Waiting room</h1>
        <p>Triage items by priority. Choose a category when Claira asks where an item should go.</p>
      </header>

      {typeof onContinueToRooms === "function" ? (
        <div className="waiting-room-continue-wrap">
          <button type="button" className="btn btn-primary" onClick={onContinueToRooms}>
            Continue to Rooms
          </button>
        </div>
      ) : null}

      {!hasItems ? (
        <div className="waiting-room-empty">All clear — no items in review</div>
      ) : (
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
      )}
    </div>
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
            Reference pattern mismatch — please confirm the correct category.
          </p>
        ) : null}
        {tunnelMismatch ? (
          <p className="waiting-room-tunnel-hint" role="status">
            Guided setup: result didn&apos;t match the expected category
            {cc.expectedCategory != null && String(cc.expectedCategory).length
              ? ` (${String(cc.expectedCategory)})`
              : ""}
            . Choose the correct label below.
          </p>
        ) : null}
        <p className="waiting-room-conflict-prompt">
          <strong>Review item — choose category</strong>
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

import "./WaitingRoom.css";

/**
 * @typedef {"high" | "medium" | "low"} ReviewPriority
 * @typedef {{
 *   file: string,
 *   reason: string,
 *   priority: ReviewPriority,
 *   score?: number
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
 *   onResolve?: (detail: { action: string, item: ReviewItem }) => void,
 *   onContinueToRooms?: () => void,
 * }} props
 * Note: Item action buttons only console.log; onResolve is reserved for later wiring.
 */
export default function WaitingRoom({ reviewItems = [], onResolve, onContinueToRooms }) {
  void onResolve;
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
    };
    buckets[item.priority].push(item);
  }

  /**
   * @param {string} action
   * @param {ReviewItem} item
   */
  const logAction = (action, item) => {
    console.log(`[WaitingRoom] ${action}`, { action, item });
  };

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
        <p>Triage items by priority. Actions are logged only until backend wiring is added.</p>
      </header>

      {typeof onContinueToRooms === "function" ? (
        <div className="waiting-room-continue-wrap">
          <button type="button" className="waiting-room-continue-btn" onClick={onContinueToRooms}>
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
                onAction={logAction}
              />
            ))}
            {buckets.high.length === 0 ? (
              <p style={{ color: "#6b7280", fontSize: "0.85rem", margin: 0 }}>None</p>
            ) : null}
          </section>

          <section className="waiting-room-column" aria-labelledby="col-medium">
            <h2 id="col-medium">
              <span aria-hidden="true">{"\u{1F7E1}"}</span> Medium
            </h2>
            {buckets.medium.map((item, i) => (
              <ReviewCard
                key={`medium-${item.file}-${i}`}
                item={item}
                onAction={logAction}
              />
            ))}
            {buckets.medium.length === 0 ? (
              <p style={{ color: "#6b7280", fontSize: "0.85rem", margin: 0 }}>None</p>
            ) : null}
          </section>

          <section className="waiting-room-column" aria-labelledby="col-low">
            <h2 id="col-low">
              <span aria-hidden="true">{"\u26AA"}</span> Low
            </h2>
            {buckets.low.map((item, i) => (
              <ReviewCard
                key={`low-${item.file}-${i}`}
                item={item}
                onAction={logAction}
              />
            ))}
            {buckets.low.length === 0 ? (
              <p style={{ color: "#6b7280", fontSize: "0.85rem", margin: 0 }}>None</p>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * @param {{
 *   item: ReviewItem,
 *   onAction: (action: string, item: ReviewItem) => void,
 * }} props
 */
function ReviewCard({ item, onAction }) {
  return (
    <article className="waiting-room-card">
      <div className="file">{item.file || "(unnamed)"}</div>
      <div className="reason">{item.reason || "—"}</div>
      {item.score != null ? (
        <div className="score">Score: {item.score}</div>
      ) : null}
      <div className="waiting-room-actions">
        <button type="button" onClick={() => onAction("assign_room", item)}>
          Assign Room
        </button>
        <button type="button" onClick={() => onAction("apply_rule", item)}>
          Apply Rule
        </button>
        <button type="button" onClick={() => onAction("allow_once", item)}>
          Allow Once
        </button>
      </div>
    </article>
  );
}

import "./SuggestionsPanel.css";

/**
 * @typedef {{
 *   type: string,
 *   message: string,
 *   predicted?: string,
 *   selected?: string,
 *   count?: number
 * }} SuggestionItem
 */

/**
 * @param {{ suggestions?: SuggestionItem[] }} props
 */
export default function SuggestionsPanel({ suggestions = [] }) {
  const list = Array.isArray(suggestions) ? suggestions : [];

  return (
    <div className="suggestions-panel">
      <header className="suggestions-panel-header">
        <h2>Suggestions</h2>
        <p>Insights from the suggestion engine (display only).</p>
      </header>

      {list.length === 0 ? (
        <div className="card suggestions-panel-empty">No suggestions at this time</div>
      ) : (
        <ul className="suggestions-panel-list">
          {list.map((s, i) => (
            <li key={`${s.type}-${i}`}>
              <SuggestionCard suggestion={s} index={i} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * @param {{ suggestion: SuggestionItem, index: number }} props
 */
function SuggestionCard({ suggestion, index }) {
  const type = String(suggestion?.type ?? "unknown");
  const message = String(suggestion?.message ?? "");
  const predicted = suggestion?.predicted != null ? String(suggestion.predicted) : null;
  const selected = suggestion?.selected != null ? String(suggestion.selected) : null;
  const count = typeof suggestion?.count === "number" && Number.isFinite(suggestion.count) ? suggestion.count : null;

  const isPromoteRule = type === "promote_to_rule";

  const onAction = () => {
    if (isPromoteRule) {
      console.log("[SuggestionsPanel] Apply Rule", { type, message, predicted, selected, count, index });
    } else {
      console.log("[SuggestionsPanel] Dismiss", { type, message, index });
    }
  };

  return (
    <article className="card suggestion-card">
      <div className="type-pill">{type.replace(/_/g, " ")}</div>
      <p className="message">{message || "—"}</p>
      {(predicted != null && predicted.length) || (selected != null && selected.length) || count != null ? (
        <div className="meta">
          {predicted != null && predicted.length ? (
            <>
              <strong>Predicted:</strong> {predicted}
              {selected != null && selected.length ? (
                <>
                  {" "}
                  → <strong>Selected:</strong> {selected}
                </>
              ) : null}
            </>
          ) : selected != null && selected.length ? (
            <>
              <strong>Selected:</strong> {selected}
            </>
          ) : null}
          {count != null ? (
            <>
              {(predicted != null && predicted.length) || (selected != null && selected.length) ? " · " : null}
              <strong>Count:</strong> {count}
            </>
          ) : null}
        </div>
      ) : null}
      <div className="suggestion-card-actions">
        {isPromoteRule ? (
          <button type="button" className="btn btn-primary" onClick={onAction}>
            Apply Rule
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={onAction}>
            Dismiss
          </button>
        )}
      </div>
    </article>
  );
}

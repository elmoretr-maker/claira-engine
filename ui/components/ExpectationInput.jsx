import { useCallback, useEffect, useRef, useState } from "react";
import { expandIntent } from "../../core/intentEngine.js";
import "./ExpectationInput.css";

/**
 * @param {string} raw
 * @returns {string[]}
 */
export function parseExpectationLines(raw) {
  return String(raw)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** @param {string} id */
function formatIndustryLabel(id) {
  return String(id || "general")
    .replace(/_/g, " ")
    .trim();
}

/**
 * @param {{
 *   items?: string[],
 *   onItemsChange?: (items: string[]) => void,
 * }} props
 */
export default function ExpectationInput({ items = [], onItemsChange }) {
  const [intentText, setIntentText] = useState("");
  const [text, setText] = useState(() => (Array.isArray(items) ? items.join("\n") : ""));
  const [intentSummary, setIntentSummary] = useState(
    /** @type {{ industry: string, keywords: string[] } | null} */ (null),
  );

  const itemsJoined = Array.isArray(items) ? items.join("\n") : "";
  const prevItemsJoinedRef = useRef(itemsJoined);
  useEffect(() => {
    if (itemsJoined === prevItemsJoinedRef.current) return;
    prevItemsJoinedRef.current = itemsJoined;
    setText(itemsJoined);
  }, [itemsJoined]);

  const notify = useCallback(
    (raw) => {
      onItemsChange?.(parseExpectationLines(raw));
    },
    [onItemsChange],
  );

  const handleGenerateTasks = useCallback(() => {
    const { industry, suggestedTasks, extractedKeywords } = expandIntent(intentText);
    const lines = suggestedTasks.filter((t) => typeof t === "string" && t.trim().length > 0);
    const body = lines.join("\n");
    setText(body);
    notify(body);
    setIntentSummary({
      industry: formatIndustryLabel(industry),
      keywords: [...extractedKeywords],
    });
  }, [intentText, notify]);

  return (
    <div className="expectation-input">
      <label className="expectation-input-label" htmlFor="expectation-intent-field">
        In a sentence, how do you work? (optional)
      </label>
      <input
        id="expectation-intent-field"
        type="text"
        className="expectation-intent-text"
        value={intentText}
        placeholder="e.g. I run a gym and need staff to upload intake forms before class…"
        onChange={(e) => setIntentText(e.target.value)}
        autoComplete="off"
      />
      <button type="button" className="expectation-generate-btn" onClick={handleGenerateTasks}>
        Generate Tasks
      </button>

      {intentSummary ? (
        <div className="expectation-input-context" aria-live="polite">
          <p className="expectation-input-context-line">
            <span className="expectation-input-context-key">I’m hearing:</span> {intentSummary.industry}
          </p>
          <p className="expectation-input-context-line">
            <span className="expectation-input-context-key">Keywords:</span>{" "}
            {intentSummary.keywords.length > 0 ? intentSummary.keywords.join(", ") : "—"}
          </p>
        </div>
      ) : null}

      <label className="expectation-input-label expectation-input-label--tasks" htmlFor="expectation-input-field">
        What you want me to watch for (optional)
      </label>
      <textarea
        id="expectation-input-field"
        className="expectation-input-textarea"
        value={text}
        placeholder="One outcome or check per line—I'll measure against these"
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          notify(v);
        }}
        rows={4}
        spellCheck={false}
      />
      <p className="expectation-input-hint">I’ll compare what actually happens to this list</p>
    </div>
  );
}

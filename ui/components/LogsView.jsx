import { useCallback, useEffect, useRef, useState } from "react";
import { getMovesLog } from "../../interfaces/api.js";
import "./LogsView.css";

/**
 * @param {{ onBack: () => void }} props
 */
export default function LogsView({ onBack }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const scrollRef = useRef(/** @type {HTMLPreElement | null} */ (null));

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const t = await getMovesLog();
      setText(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setText("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, loading]);

  const displayBody = error ? "" : loading && !text ? "Loading…" : text.length ? text : "(no entries yet)";

  return (
    <div className="logs-view">
      <div className="logs-view-toolbar">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void load()} disabled={loading}>
          Refresh Logs
        </button>
      </div>
      {error ? <p className="logs-view-error">{error}</p> : null}
      <pre ref={scrollRef} className="logs-view-pre">
        {displayBody}
      </pre>
    </div>
  );
}

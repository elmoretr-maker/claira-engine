/**
 * @param {unknown} value
 */
export function copyCapabilityValue(value) {
  const text =
    value === null || value === undefined
      ? String(value)
      : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);
  void navigator.clipboard.writeText(text).catch(() => {});
}

/**
 * @param {{ value: unknown, depth?: number }} props
 */
export default function CapabilityResultTree({ value, depth = 0 }) {
  const muted = "var(--text-muted, #6b7280)";

  if (value === null || value === undefined) {
    return <span style={{ color: muted }}>{String(value)}</span>;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return (
      <span>
        {String(value)}
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: "0.72rem", padding: "0.15rem 0.45rem", marginLeft: "0.35rem" }}
          onClick={() => copyCapabilityValue(value)}
        >
          Copy
        </button>
      </span>
    );
  }
  if (typeof value === "string") {
    return (
      <span style={{ wordBreak: "break-word" }}>
        {value}
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: "0.72rem", padding: "0.15rem 0.45rem", marginLeft: "0.35rem" }}
          onClick={() => copyCapabilityValue(value)}
        >
          Copy
        </button>
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span>[]</span>;
    return (
      <ul style={{ margin: "0.2rem 0", paddingLeft: "1.1rem", listStyle: "disc" }}>
        {value.map((v, i) => (
          <li key={`i-${i}`} style={{ marginBottom: "0.35rem" }}>
            <span style={{ color: muted }}>[{i}] </span>
            <CapabilityResultTree value={v} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (value));
    if (entries.length === 0) return <span>{"{}"}</span>;
    return (
      <div
        style={{
          marginLeft: depth === 0 ? 0 : "0.35rem",
          borderLeft: depth === 0 ? "none" : "1px solid var(--border-default, #e5e7eb)",
          paddingLeft: depth === 0 ? 0 : "0.5rem",
        }}
      >
        {entries.map(([k, v]) => (
          <details
            key={k}
            open={depth < 2}
            style={{ marginBottom: "0.4rem" }}
          >
            <summary style={{ cursor: "pointer" }}>
              <strong>{k}</strong>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: "0.72rem", padding: "0.15rem 0.45rem", marginLeft: "0.35rem" }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  copyCapabilityValue(v);
                }}
              >
                Copy
              </button>
            </summary>
            <div style={{ marginTop: "0.25rem" }}>
              <CapabilityResultTree value={v} depth={depth + 1} />
            </div>
          </details>
        ))}
      </div>
    );
  }

  return <span>{String(value)}</span>;
}

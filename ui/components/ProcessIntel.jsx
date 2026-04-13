import "./ProcessIntel.css";

/**
 * @typedef {{
 *   purpose?: string,
 *   actions?: string[],
 *   priority?: string,
 *   review_required?: boolean,
 * }} ProcessEntry
 */

/**
 * @param {{ entry: ProcessEntry | null | undefined, categoryKey?: string }} props
 */
export default function ProcessIntel({ entry, categoryKey }) {
  if (!entry || typeof entry !== "object") {
    return (
      <div className="process-intel process-intel--default" data-category={categoryKey ?? ""}>
        <p className="process-intel-purpose">
          No workflow entry in <span className="mono">processes.json</span> for this category — default routing and
          review rules apply.
        </p>
      </div>
    );
  }
  const purpose = typeof entry.purpose === "string" ? entry.purpose.trim() : "";
  const priorityRaw = String(entry.priority ?? "medium").toLowerCase();
  const priority =
    priorityRaw === "low" || priorityRaw === "medium" || priorityRaw === "high" ? priorityRaw : "medium";
  const review = entry.review_required === true;
  const actions = Array.isArray(entry.actions) ? entry.actions.filter((a) => typeof a === "string" && a.trim()) : [];

  if (!purpose && actions.length === 0) {
    return (
      <div className="process-intel process-intel--default" data-category={categoryKey ?? ""}>
        <p className="process-intel-purpose">Process metadata is empty for this category — default handling applies.</p>
      </div>
    );
  }

  return (
    <div className="process-intel" data-category={categoryKey ?? ""}>
      <div className="process-intel-badges">
        <span className={`process-intel-priority process-intel-priority--${priority}`} title="Handling priority">
          {priority} priority
        </span>
        {review ? (
          <span className="process-intel-review" title="Workflow suggests human review">
            Review expected
          </span>
        ) : (
          <span className="process-intel-auto" title="May route with standard automation">
            Standard handling
          </span>
        )}
      </div>
      {purpose ? <p className="process-intel-purpose">{purpose}</p> : null}
      {actions.length > 0 ? (
        <ul className="process-intel-actions">
          {actions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

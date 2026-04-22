/**
 * PrioritySummary.jsx
 *
 * Compact summary bar showing entity counts per urgency level.
 * Static display — Phase 3 will add click-to-filter behavior.
 *
 * Props:
 *   entities — MergedEntity[]
 */

import "./EntityPerformance.css";

/**
 * @param {{ entities: Array<{ urgency: string }> }} props
 */
export default function PrioritySummary({ entities }) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const e of entities) {
    if (e.urgency === "critical") counts.critical++;
    else if (e.urgency === "high")   counts.high++;
    else if (e.urgency === "medium") counts.medium++;
    else                             counts.low++;
  }

  const cells = [
    { key: "critical", dot: "critical", label: "Critical",  count: counts.critical },
    { key: "high",     dot: "high",     label: "High",      count: counts.high     },
    { key: "medium",   dot: "medium",   label: "Monitor",   count: counts.medium   },
    { key: "low",      dot: "low",      label: "Performing",count: counts.low      },
  ];

  return (
    <div className="ep-priority-summary" role="status" aria-label="Entity urgency summary">
      {cells.map(({ key, dot, label, count }) => (
        <div key={key} className={`ep-priority-summary__cell ep-priority-summary__cell--${dot}`}>
          <span className="ep-priority-summary__cell-dot" aria-hidden="true" />
          <span className="ep-priority-summary__cell-count">{count}</span>
          <span className="ep-priority-summary__cell-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

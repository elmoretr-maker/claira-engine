import "./WorkflowStatus.css";

/**
 * @param {{
 *   workflowResult?: {
 *     matched?: unknown[],
 *     missing?: unknown[],
 *     conflicting?: unknown[],
 *     uncertain?: unknown[],
 *   },
 * }} props
 */
export default function WorkflowStatus({ workflowResult }) {
  const w = workflowResult ?? {};
  const missing = Array.isArray(w.missing) ? w.missing.length : 0;
  const conflicting = Array.isArray(w.conflicting) ? w.conflicting.length : 0;
  const uncertain = Array.isArray(w.uncertain) ? w.uncertain.length : 0;

  /** @type { "success" | "warning" | "danger" } */
  let tone = "success";
  let label = "All tasks complete";
  if (missing > 0 || conflicting > 0) {
    tone = "danger";
    label = "Issues detected";
  } else if (uncertain > 0) {
    tone = "warning";
    label = "Needs review";
  }

  return (
    <div className={`workflow-status workflow-status--${tone}`} role="status" aria-live="polite">
      <span className="workflow-status-dot" aria-hidden />
      <span className="workflow-status-label">{label}</span>
    </div>
  );
}

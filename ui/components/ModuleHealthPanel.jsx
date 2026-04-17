import { useMemo } from "react";
import {
  MODULE_REGISTRY,
  REGISTERED_WORKFLOW_MODULE_IDS,
  createInitialModuleRuntimeState,
} from "../../workflow/modules/moduleRegistry.js";
import { getModuleHealth } from "../../workflow/modules/moduleHealth.js";
import "./ModuleHealthPanel.css";

/**
 * Informational only — no actions, no auto-fix.
 *
 * @param {{ onBack: () => void }} props
 */
export default function ModuleHealthPanel({ onBack }) {
  const report = useMemo(() => {
    const state = { moduleRuntimeState: createInitialModuleRuntimeState() };
    return getModuleHealth(state);
  }, []);

  return (
    <div className="module-health-panel app-screen-padding">
      <div className="module-health-header">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <h1 className="module-health-title">Module Health</h1>
      </div>
      <p className="module-health-lead">
        Read-only status from each module&apos;s <code>health.check</code> on the current runtime slice. Empty stores
        typically report healthy.
      </p>
      <ul className="module-health-list">
        {REGISTERED_WORKFLOW_MODULE_IDS.map((id) => {
          const mod = MODULE_REGISTRY[id];
          const row = report[id];
          const status = row?.status ?? "—";
          const issues = Array.isArray(row?.issues) ? row.issues : [];
          const statusClass =
            status === "healthy"
              ? "module-health-status--ok"
              : status === "warning"
                ? "module-health-status--warn"
                : status === "error"
                  ? "module-health-status--err"
                  : "";
          return (
            <li key={id} className="module-health-card">
              <div className="module-health-card-head">
                <span className="module-health-name">{mod.label}</span>
                <span className={`module-health-status ${statusClass}`} role="status">
                  {status}
                </span>
              </div>
              <p className="module-health-id">
                <code>{id}</code>
              </p>
              {issues.length > 0 ? (
                <ul className="module-health-issues">
                  {issues.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              ) : (
                <p className="module-health-no-issues">No issues reported.</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

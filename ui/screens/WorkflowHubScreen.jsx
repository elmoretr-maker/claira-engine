import { useCallback, useEffect, useState } from "react";
import { listWorkflowCompositions } from "../../interfaces/api.js";
import { formatModuleListForHub } from "../workflow/workflowLabelHelpers.js";
import { useIndustry } from "../IndustryContext.jsx";

/**
 * @param {{
 *   onBack: () => void,
 *   onOpenComposition: (row: Record<string, unknown>) => void,
 * }} props
 */
export default function WorkflowHubScreen({ onBack, onOpenComposition }) {
  const { loadIndustryPack, industrySlug } = useIndustry();
  const [workflows, setWorkflows] = useState(/** @type {unknown[]} */ ([]));
  const [activePackSlug, setActivePackSlug] = useState("");
  const [busySlug, setBusySlug] = useState(/** @type {string} */ (""));
  const [error, setError] = useState(/** @type {string | null} */ (null));

  useEffect(() => {
    void (async () => {
      try {
        const r = await listWorkflowCompositions();
        if (r && typeof r === "object") {
          if (Array.isArray(r.workflows)) setWorkflows(r.workflows);
          if (typeof r.activePackSlug === "string") setActivePackSlug(r.activePackSlug);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const openRow = useCallback(
    async (row) => {
      const slug = typeof row?.slug === "string" ? row.slug : "";
      if (!slug) return;
      setError(null);
      setBusySlug(slug);
      try {
        if (slug !== industrySlug) {
          await loadIndustryPack(slug);
        }
        onOpenComposition(row);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusySlug("");
      }
    },
    [industrySlug, loadIndustryPack, onOpenComposition],
  );

  return (
    <div className="app-screen-padding" style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <h1 style={{ margin: 0, fontSize: "1.2rem" }}>Workflows</h1>
      </div>
      <p style={{ fontSize: "0.9rem", color: "var(--text-muted, #6b7280)", marginBottom: "1rem" }}>
        Choose a workflow to open. Your industry pack updates when you pick one from a different pack so
        processing stays in sync.
      </p>
      {import.meta.env.DEV ? (
        <p style={{ fontSize: "0.7rem", color: "var(--text-muted, #6b7280)", marginBottom: "0.75rem" }}>
          Dev: active pack <code>{activePackSlug || "—"}</code>
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: "var(--danger, #c00)", marginBottom: "1rem" }}>
          {error}
        </p>
      ) : null}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {workflows.length === 0 ? (
          <li style={{ color: "var(--text-muted, #6b7280)" }}>
            No workflows found. Add a workflow template to a pack to see it here.
          </li>
        ) : (
          workflows.map((w) => {
            const slug = typeof w?.slug === "string" ? w.slug : "";
            const displayName = String(w?.label ?? "").trim();
            const isActive = slug === activePackSlug;
            const modIds = Array.isArray(w?.modules)
              ? w.modules.map((x) => String(x ?? "").trim()).filter(Boolean)
              : [];
            const mo = /** @type {Record<string, unknown>} */ (w.moduleOptions);
            const modulesLine = formatModuleListForHub(modIds, mo);
            return (
              <li
                key={slug}
                style={{
                  borderBottom: "1px solid var(--border-subtle, rgba(0,0,0,0.08))",
                  padding: "0.85rem 0",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: "1.05rem" }}>{displayName}</span>
                    {isActive ? (
                      <span
                        style={{
                          fontSize: "0.7rem",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          padding: "0.15rem 0.45rem",
                          borderRadius: 4,
                          background: "var(--surface-elevated, rgba(0,0,0,0.06))",
                          color: "var(--text-muted, #6b7280)",
                        }}
                      >
                        Current
                      </span>
                    ) : null}
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--text-muted, #6b7280)",
                      marginTop: "0.35rem",
                    }}
                  >
                    Includes: {modulesLine}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!!busySlug}
                  onClick={() => void openRow(w)}
                >
                  {busySlug === slug ? "Loading…" : "Open"}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

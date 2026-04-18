import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { defaultWidgetOrderByModule, getWorkflowWidgetEntry } from "../../workflow/ui/uiRegistry.js";
import { assertWorkflowTemplateContract } from "../../workflow/validation/workflowTemplateContract.js";
import { getEntityTypeLabels, getWorkflowSectionTitles } from "../workflow/workflowLabelHelpers.js";
import { getEntity } from "../../interfaces/api.js";
import CapabilitySessionPanel from "../components/CapabilitySessionPanel.jsx";

/**
 * @param {{
 *   composition: {
 *     slug: string,
 *     packLabel?: string,
 *     workflowSource?: string,
 *     template?: Record<string, unknown>,
 *   },
 *   onBack: () => void,
 *   pipelineResultRows?: unknown[],
 *   capabilityDomainMode?: string,
 *   onCapabilityDomainModeChange?: (v: string) => void,
 *   capabilityPlanMode?: "single" | "planned",
 *   onCapabilityPlanModeChange?: (v: "single" | "planned") => void,
 * }} props
 */
export default function WorkflowScreen({
  composition,
  onBack,
  pipelineResultRows = [],
  capabilityDomainMode = "general",
  onCapabilityDomainModeChange,
  capabilityPlanMode = "single",
  onCapabilityPlanModeChange,
}) {
  const entryBlocked = composition?.workflowSource !== "generated";
  const tmpl = composition.template;
  const [contractError, setContractError] = useState(/** @type {string | null} */ (null));

  useEffect(() => {
    if (entryBlocked) {
      setContractError(null);
      return;
    }
    try {
      const hint = `packs/${composition.slug}/workflow_template.json`;
      assertWorkflowTemplateContract(tmpl, hint);
      setContractError(null);
    } catch (e) {
      setContractError(e instanceof Error ? e.message : String(e));
    }
  }, [composition.slug, tmpl, entryBlocked]);

  const workflowTitle = tmpl && typeof tmpl.label === "string" ? tmpl.label.trim() : "";
  const templateId = tmpl && typeof tmpl.templateId === "string" ? tmpl.templateId.trim() : "";
  const modList =
    tmpl && Array.isArray(tmpl.modules)
      ? tmpl.modules.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [];
  const moduleOptions =
    tmpl && tmpl.moduleOptions && typeof tmpl.moduleOptions === "object" && !Array.isArray(tmpl.moduleOptions)
      ? /** @type {Record<string, unknown>} */ (tmpl.moduleOptions)
      : /** @type {Record<string, unknown>} */ ({});

  const { singular: entitySingular, plural: entityPlural } = useMemo(
    () => getEntityTypeLabels(moduleOptions),
    [moduleOptions],
  );

  const sectionTitles = useMemo(() => getWorkflowSectionTitles(moduleOptions), [moduleOptions]);

  const [entityId, setEntityId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [highlightedEventId, setHighlightedEventId] = useState("");
  const [selectedEntityName, setSelectedEntityName] = useState("");
  const [loadingSelection, setLoadingSelection] = useState(false);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  const pipelineRows = Array.isArray(pipelineResultRows) ? pipelineResultRows : [];

  useEffect(() => {
    if (!entityId) {
      setSelectedEntityName("");
      return;
    }
    setLoadingSelection(true);
    void (async () => {
      try {
        const r = await getEntity({ entityId });
        const name =
          r && typeof r === "object" && r.client && typeof r.client.displayName === "string"
            ? r.client.displayName
            : "";
        setSelectedEntityName(name);
      } finally {
        setLoadingSelection(false);
      }
    })();
  }, [entityId, refreshKey]);

  const onAttachComplete = useCallback(async () => {
    bump();
    const r = await getEntity({ entityId });
    if (r && typeof r === "object" && Array.isArray(r.events) && r.events.length > 0) {
      const sorted = r.events.slice().sort((a, b) => {
        const ta = typeof a?.at === "string" ? a.at : "";
        const tb = typeof b?.at === "string" ? b.at : "";
        return tb.localeCompare(ta);
      });
      const top = sorted[0];
      if (top && typeof top.id === "string") setHighlightedEventId(top.id);
    }
  }, [entityId, bump]);

  const uiCopy = useMemo(
    () => ({
      entitySingular,
      entityPlural,
      emptyEntityList: `No ${entityPlural.toLowerCase()} yet — create one to begin.`,
      emptyTimeline: "No activity yet — add data to see the timeline.",
      selectEntityFirst: "Select an entity before adding data",
    }),
    [entitySingular, entityPlural],
  );

  const commonProps = useMemo(
    () => ({
      entityId,
      templateId,
      moduleOptions,
      onEntitySelect: setEntityId,
      onEntitiesChanged: bump,
      onAttachComplete,
      refreshKey,
      uiCopy,
      highlightedEventId,
    }),
    [
      entityId,
      templateId,
      moduleOptions,
      bump,
      onAttachComplete,
      refreshKey,
      uiCopy,
      highlightedEventId,
    ],
  );

  const leftModules = modList.filter((m) => m === "entity_tracking");
  const assetModules = modList.filter((m) => m === "asset_registry");
  const timelineModules = modList.filter((m) => m === "event_log");

  /**
   * @param {string[]} mids
   */
  function renderModuleColumn(mids) {
    return mids.flatMap((mid) => {
      const order = defaultWidgetOrderByModule[mid] ?? [];
      return order.map((wid) => {
        const entry = getWorkflowWidgetEntry(mid, wid);
        if (!entry) return null;
        const C = entry.Component;
        return (
          <Suspense
            key={`${mid}-${wid}`}
            fallback={<p style={{ fontSize: "0.85rem", color: "var(--text-muted, #6b7280)" }}>Loading…</p>}
          >
            <C {...commonProps} />
          </Suspense>
        );
      });
    });
  }

  const sectionHeadingStyle = {
    fontSize: "0.95rem",
    fontWeight: 600,
    margin: "0 0 0.65rem",
    letterSpacing: "0.02em",
  };

  if (entryBlocked) {
    return (
      <div className="app-screen-padding" style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Back
          </button>
          <h1 style={{ margin: 0, fontSize: "1.2rem" }}>Workflow</h1>
        </div>
        <p role="alert" style={{ marginBottom: "1rem" }}>
          This workflow is only available for custom-built systems.
        </p>
      </div>
    );
  }

  if (contractError) {
    return (
      <div className="app-screen-padding" style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Back
          </button>
          <h1 style={{ margin: 0, fontSize: "1.2rem" }}>Workflow</h1>
        </div>
        <p role="alert" style={{ color: "var(--danger, #c00)", marginBottom: "1rem" }}>
          {contractError}
        </p>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted, #6b7280)" }}>
          Fix workflow_template.json for this pack, or run <code>node dev/migrate_workflow_templates.mjs</code> from
          the repo root.
        </p>
      </div>
    );
  }

  if (!workflowTitle || !templateId || modList.length === 0) {
    return (
      <div className="app-screen-padding">
        <p role="alert">Invalid workflow composition (missing template fields).</p>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="app-screen-padding" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.75rem" }}>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <h1 style={{ margin: 0, fontSize: "1.2rem" }}>{workflowTitle}</h1>
      </div>

      <p style={{ fontSize: "0.88rem", color: "var(--text-muted, #6b7280)", marginBottom: "1rem" }}>
        {loadingSelection && entityId
          ? "Loading selection…"
          : entityId && selectedEntityName
            ? `Selected: ${selectedEntityName}`
            : entityId
              ? "Selected: (unnamed)"
              : "No record selected"}
      </p>

      {import.meta.env.DEV ? (
        <div
          style={{
            fontSize: "0.7rem",
            color: "var(--text-muted, #6b7280)",
            marginBottom: "1rem",
            padding: "0.5rem",
            border: "1px dashed var(--border-default, #ccc)",
            borderRadius: 6,
          }}
        >
          <div>
            <strong>Dev</strong> · validation: <code>ok</code>
          </div>
          <div>
            templateId: <code>{templateId}</code>
          </div>
          <div>
            modules: <code>[{modList.join(", ")}]</code>
          </div>
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: "1.25rem",
          alignItems: "start",
        }}
      >
        <section aria-labelledby="workflow-entities-heading">
          <h2 id="workflow-entities-heading" style={sectionHeadingStyle}>
            {sectionTitles.entities}
          </h2>
          {renderModuleColumn(leftModules)}
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {assetModules.length > 0 ? (
            <section aria-labelledby="workflow-add-data-heading">
              <h2 id="workflow-add-data-heading" style={sectionHeadingStyle}>
                {sectionTitles.addData}
              </h2>
              {renderModuleColumn(assetModules)}
            </section>
          ) : null}

          {timelineModules.length > 0 ? (
            <section aria-labelledby="workflow-activity-heading">
              <h2 id="workflow-activity-heading" style={sectionHeadingStyle}>
                {sectionTitles.activity}
              </h2>
              {renderModuleColumn(timelineModules)}
            </section>
          ) : null}
        </div>
      </div>

      <CapabilitySessionPanel
        pipelineRows={pipelineRows}
        capabilityDomainMode={capabilityDomainMode}
        onCapabilityDomainModeChange={onCapabilityDomainModeChange}
        capabilityPlanMode={capabilityPlanMode}
        onCapabilityPlanModeChange={onCapabilityPlanModeChange}
      />
    </div>
  );
}

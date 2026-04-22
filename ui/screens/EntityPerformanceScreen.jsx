/**
 * EntityPerformanceScreen.jsx
 *
 * Main dashboard for entity pipeline output.
 * Phase 2: ActionQueue clicks now expand the matching row in EntityTable.
 *
 * Layout (top → bottom):
 *   1. Header      — title, entity count, Back button
 *   2. Top row     — ActionQueue (left) + PrioritySummary (right)
 *   3. Table       — EntityTable with expandable rows (one open at a time)
 *
 * Props:
 *   entities — MergedEntity[] from mergeEntityPipelineData()
 *   onBack   — () => void
 */

import { useCallback, useRef, useState } from "react";
import "./EntityPerformanceScreen.css";
import { sortByUrgencyThenRank } from "../utils/engineDisplayFormatters.js";
import ActionQueue    from "../components/ActionQueue.jsx";
import PrioritySummary from "../components/PrioritySummary.jsx";
import EntityTable    from "../components/EntityTable.jsx";

/**
 * @param {{
 *   entities: object[],
 *   onBack:   () => void,
 * }} props
 */
export default function EntityPerformanceScreen({ entities, onBack }) {
  const sorted = sortByUrgencyThenRank(Array.isArray(entities) ? entities : []);

  // Shared ref map: entityId → <tr> element
  const scrollRefMap = useRef(new Map());

  // Lifted expand state — shared between ActionQueue (sets it) and EntityTable (reads it)
  const [expandedId, setExpandedId] = useState(/** @type {string|null} */ (null));

  const handleScrollTo = useCallback((entityId) => {
    // Expand the target row
    setExpandedId(entityId);

    // Scroll to it (after a brief tick so the detail row has rendered)
    requestAnimationFrame(() => {
      const el = scrollRefMap.current.get(entityId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.outline      = "2px solid var(--accent)";
        el.style.outlineOffset = "-2px";
        setTimeout(() => {
          el.style.outline      = "";
          el.style.outlineOffset = "";
        }, 1200);
      }
    });
  }, []);

  const hasData = sorted.length > 0;

  return (
    <div className="ep-screen app-screen-fade">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="ep-screen__header">
        <div className="ep-screen__title-block">
          <h1 className="ep-screen__title">Entity Performance</h1>
          <p className="ep-screen__subtitle">
            Ranked by urgency · {sorted.length} {sorted.length === 1 ? "entity" : "entities"}
          </p>
        </div>
        <div className="ep-screen__header-actions">
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            ← Back
          </button>
        </div>
      </div>

      {/* ── No-data state ───────────────────────────────────────────── */}
      {!hasData ? (
        <div className="ep-screen__no-data">
          <div className="ep-screen__no-data-icon">📊</div>
          <h2 className="ep-screen__no-data-title">No performance data yet</h2>
          <p className="ep-screen__no-data-body">
            Run a complete workflow — or use Business Analyzer — to see ranked entity results here.
          </p>
        </div>
      ) : (
        <>
          {/* ── Top row: ActionQueue + PrioritySummary ──────────────── */}
          <div className="ep-screen__top-row">
            <ActionQueue entities={sorted} onScrollTo={handleScrollTo} />
            <div className="ep-screen__summary-aside">
              <span className="ep-screen__summary-aside-label">Urgency breakdown</span>
              <PrioritySummary entities={sorted} />
            </div>
          </div>

          {/* ── Ranked entity table (Phase 2: expandable rows) ──────── */}
          <div className="ep-screen__table-section">
            <div className="ep-screen__table-header">
              <h2 className="ep-screen__table-title">All Entities</h2>
              <span className="ep-screen__table-count">
                {sorted.length} {sorted.length === 1 ? "entity" : "entities"} · click any row for details
              </span>
            </div>
            <EntityTable
              entities={sorted}
              scrollRefMap={scrollRefMap}
              expandedId={expandedId}
              onSetExpanded={setExpandedId}
            />
          </div>
        </>
      )}
    </div>
  );
}

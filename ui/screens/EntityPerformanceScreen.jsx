/**
 * EntityPerformanceScreen.jsx
 *
 * Main dashboard for entity pipeline output.
 * Surfaces all four engine pipeline stages in a single, user-actionable view.
 *
 * Layout (top → bottom):
 *   1. Header      — title, entity count, Back button
 *   2. Top row     — ActionQueue (left) + PrioritySummary (right)
 *   3. Table       — EntityTable sorted by urgency then rank
 *
 * Props:
 *   entities    — MergedEntity[] from mergeEntityPipelineData()
 *                 Pass SAMPLE_ENTITIES for development / testing.
 *   onBack      — () => void  called when Back is pressed
 *
 * Rules applied (from approved plan):
 *   ✅ Default sort: urgency (critical → low) then rank
 *   ✅ ActionQueue with tier grouping + scroll-to behavior
 *   ✅ PrioritySummary static counts
 *   ✅ Tier labels: "Top Performer" / "Mid Tier" / "At Risk" / "Critical"
 *   ✅ Optional "#N of M" position badge
 *   ✅ Empty state for act-now queue
 *   ✅ No API calls — data passed in as props
 *   ✅ No detail panel (Phase 2)
 *   ✅ No filters (Phase 3)
 *   ✅ No Insights hook (Phase 4)
 */

import { useCallback, useRef } from "react";
import "./EntityPerformanceScreen.css";
import { sortByUrgencyThenRank } from "../utils/engineDisplayFormatters.js";
import ActionQueue from "../components/ActionQueue.jsx";
import PrioritySummary from "../components/PrioritySummary.jsx";
import EntityTable from "../components/EntityTable.jsx";

/**
 * @param {{
 *   entities: object[],
 *   onBack:   () => void,
 * }} props
 */
export default function EntityPerformanceScreen({ entities, onBack }) {
  // Sort once at the screen level — all child components receive pre-sorted data.
  const sorted = sortByUrgencyThenRank(Array.isArray(entities) ? entities : []);

  // Shared ref map: entityId → <tr> element.
  // ActionQueue uses this to scroll the target row into view.
  const scrollRefMap = useRef(new Map());

  const handleScrollTo = useCallback((entityId) => {
    const el = scrollRefMap.current.get(entityId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Brief highlight flash to orient the user
      el.style.outline = "2px solid var(--accent)";
      el.style.outlineOffset = "-2px";
      setTimeout(() => {
        el.style.outline = "";
        el.style.outlineOffset = "";
      }, 1200);
    }
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
            Run a complete workflow (entity registration → snapshot logging → delta computation →
            trend interpretation → ranking → recommendations) to see results here.
          </p>
        </div>
      ) : (
        <>
          {/* ── Top row: ActionQueue + PrioritySummary ────────────────── */}
          <div className="ep-screen__top-row">
            <ActionQueue entities={sorted} onScrollTo={handleScrollTo} />

            <div className="ep-screen__summary-aside">
              <span className="ep-screen__summary-aside-label">Urgency breakdown</span>
              <PrioritySummary entities={sorted} />
            </div>
          </div>

          {/* ── Ranked entity table ────────────────────────────────────── */}
          <div className="ep-screen__table-section">
            <div className="ep-screen__table-header">
              <h2 className="ep-screen__table-title">All Entities</h2>
              <span className="ep-screen__table-count">
                {sorted.length} {sorted.length === 1 ? "entity" : "entities"} · sorted by urgency then rank
              </span>
            </div>
            <EntityTable entities={sorted} scrollRefMap={scrollRefMap} />
          </div>
        </>
      )}
    </div>
  );
}

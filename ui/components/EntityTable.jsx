/**
 * EntityTable.jsx
 *
 * The main ranked-entity display table.
 *
 * Responsibilities:
 *   - Render header row with column labels
 *   - Render an EntityRow per entity
 *   - Maintain a ref map so ActionQueue can scroll to specific rows
 *   - Show empty state when no entities provided
 *
 * Props:
 *   entities    — MergedEntity[], already sorted by urgency then rank
 *   onScrollRef — called with (entityId, element) so parent can store refs
 *                 (used by ActionQueue scroll-to handler)
 *
 * Phase 3 will add sort/filter controls above the table.
 */

import { useCallback, useRef } from "react";
import "./EntityPerformance.css";
import EntityRow from "./EntityRow.jsx";

// ── Column definitions ─────────────────────────────────────────────────────────

// FIX 3: Score removed from main table (available in Phase 2 detail panel).
const COLUMNS = [
  { key: "rank",      label: "Rank",      className: "",             style: { width: 64, paddingLeft: 16 } },
  { key: "label",     label: "Name",      className: "",             style: {} },
  { key: "direction", label: "Trend",     className: "",             style: { width: 40, textAlign: "center" } },
  { key: "velocity",  label: "Movement",  className: "",             style: {} },
  { key: "tier",      label: "Tier",      className: "ep-col--tier", style: {} },
  { key: "action",    label: "Action",    className: "",             style: { minWidth: 160 } },
  { key: "urgency",   label: "Urgency",   className: "",             style: {} },
  { key: "alerts",    label: "Alerts",    className: "",             style: {} },
];

// ── EntityTable ────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   entities: object[],
 *   scrollRefMap?: React.MutableRefObject<Map<string, HTMLTableRowElement>>,
 * }} props
 */
export default function EntityTable({ entities, scrollRefMap }) {
  // Internal ref map if none provided externally
  const internalRefMap = useRef(new Map());
  const refMap = scrollRefMap ?? internalRefMap;

  const setRowRef = useCallback(
    (entityId, el) => {
      if (el) {
        refMap.current.set(entityId, el);
      } else {
        refMap.current.delete(entityId);
      }
    },
    [refMap],
  );

  const totalCount = entities.length;

  return (
    <div style={{ overflowX: "auto", borderRadius: 10 }}>
      <table className="ep-table" aria-label="Entity performance rankings">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key} className={col.className} style={col.style}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {totalCount === 0 ? (
            <tr>
              <td className="ep-table__empty" colSpan={COLUMNS.length}>
                No entity performance data available for this run.
              </td>
            </tr>
          ) : (
            entities.map((entity) => (
              <EntityRow
                key={entity.entityId}
                entity={entity}
                totalCount={totalCount}
                rowRef={(el) => setRowRef(entity.entityId, el)}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

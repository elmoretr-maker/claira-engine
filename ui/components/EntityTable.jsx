/**
 * EntityTable.jsx
 *
 * The main ranked-entity display table.
 * Phase 2: supports expandable rows with a single open at a time.
 *
 * Responsibilities:
 *   - Render column header row
 *   - Render EntityRow per entity (collapsed or expanded)
 *   - Maintain expandedId state (only one row open at a time)
 *   - Accept expandedId / onSetExpanded from parent for ActionQueue integration
 *   - Maintain ref map so ActionQueue can scroll to specific rows
 *
 * Props:
 *   entities     — MergedEntity[], pre-sorted by urgency then rank
 *   scrollRefMap — MutableRefObject<Map<string, HTMLElement>>
 *   expandedId   — (optional) controlled expand state from parent
 *   onSetExpanded — (optional) controlled expand setter from parent
 */

import { useCallback, useRef, useState } from "react";
import "./EntityPerformance.css";
import EntityRow from "./EntityRow.jsx";

// ── Column definitions ──────────────────────────────────────────────────────

const COLUMNS = [
  { key: "expand",    label: "",          className: "",             style: { width: 32, paddingLeft: 10 } },
  { key: "rank",      label: "Rank",      className: "",             style: { width: 64 } },
  { key: "label",     label: "Name",      className: "",             style: {} },
  { key: "direction", label: "Trend",     className: "",             style: { width: 40, textAlign: "center" } },
  { key: "velocity",  label: "Movement",  className: "",             style: {} },
  { key: "tier",      label: "Tier",      className: "ep-col--tier", style: {} },
  { key: "action",    label: "Action",    className: "",             style: { minWidth: 160 } },
  { key: "urgency",   label: "Urgency",   className: "",             style: {} },
  { key: "alerts",    label: "Alerts",    className: "",             style: {} },
];

const COL_SPAN = COLUMNS.length;

// ── EntityTable ─────────────────────────────────────────────────────────────

/**
 * @param {{
 *   entities:      object[],
 *   scrollRefMap?: React.MutableRefObject<Map<string, HTMLElement>>,
 *   expandedId?:   string | null,
 *   onSetExpanded?: (id: string | null) => void,
 * }} props
 */
export default function EntityTable({ entities, scrollRefMap, expandedId: controlledId, onSetExpanded }) {
  // Internal ref map if none provided externally
  const internalRefMap = useRef(new Map());
  const refMap = scrollRefMap ?? internalRefMap;

  // Internal expand state (used when parent doesn't control it)
  const [internalExpandedId, setInternalExpandedId] = useState(/** @type {string|null} */ (null));

  // Use controlled or internal state
  const expandedId    = controlledId !== undefined ? controlledId    : internalExpandedId;
  const setExpandedId = onSetExpanded              ? onSetExpanded   : setInternalExpandedId;

  const setRowRef = useCallback(
    (entityId, el) => {
      if (el) refMap.current.set(entityId, el);
      else    refMap.current.delete(entityId);
    },
    [refMap],
  );

  const handleToggle = useCallback(
    (entityId) => {
      setExpandedId(expandedId === entityId ? null : entityId);
    },
    [expandedId, setExpandedId],
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
              <td className="ep-table__empty" colSpan={COL_SPAN}>
                No entity performance data available for this run.
              </td>
            </tr>
          ) : (
            entities.map((entity) => (
              <EntityRow
                key={entity.entityId}
                entity={entity}
                totalCount={totalCount}
                isExpanded={expandedId === entity.entityId}
                onToggle={() => handleToggle(entity.entityId)}
                rowRef={(el) => setRowRef(entity.entityId, el)}
                colSpan={COL_SPAN}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

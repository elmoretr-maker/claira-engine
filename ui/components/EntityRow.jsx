/**
 * EntityRow.jsx
 *
 * A single entity row in EntityTable.
 * Phase 2: now supports expand/collapse with an inline EntityDetailPanel.
 *
 * Each entity renders as a React fragment containing:
 *   1. The collapsed summary <tr>  (always visible)
 *   2. An expanded detail <tr>     (visible when isExpanded = true)
 *
 * Columns (left → right):
 *   Expand  |  Rank  |  Name  |  Trend  |  Movement  |  Tier  |  Action + Reason  |  Urgency  |  Alerts
 *
 * Props:
 *   entity      — MergedEntity (fully merged pipeline record)
 *   totalCount  — number of entities (for "of M" sub-label)
 *   isExpanded  — whether the detail panel is open
 *   onToggle    — () => void   toggle expand/collapse
 *   rowRef      — (el) => void forwarded ref for scroll-to
 *   colSpan     — number of columns (passed from EntityTable)
 */

import "./EntityPerformance.css";
import {
  formatDirectionalVelocity,
  formatImpactSummary,
} from "../utils/engineDisplayFormatters.js";
import {
  UrgencyChip,
  DirectionIndicator,
  ActionPill,
  RankBadge,
  TierLabel,
  AlertBadge,
} from "./EntityPerformanceAtoms.jsx";
import EntityDetailPanel from "./EntityDetailPanel.jsx";

/**
 * @param {string} urgency
 * @param {number} percentile
 * @param {string} direction
 * @returns {string}
 */
function resolveRowAccentClass(urgency, percentile, direction) {
  if (urgency === "critical") return "ep-row--critical";
  if (urgency === "high")     return "ep-row--high";
  if (percentile <= 0.2 && direction === "up") return "ep-row--top-performer";
  return "";
}

/**
 * @param {{
 *   entity:     object,
 *   totalCount: number,
 *   isExpanded: boolean,
 *   onToggle:   () => void,
 *   rowRef?:    (el: HTMLTableRowElement | null) => void,
 *   colSpan:    number,
 * }} props
 */
export default function EntityRow({ entity, totalCount, isExpanded, onToggle, rowRef, colSpan }) {
  const {
    entityId, label, rank, tieBreakReason,
    direction, velocity, velocityPerTime,
    action, urgency, reason, alertCount, percentile,
  } = entity;

  const accentClass     = resolveRowAccentClass(urgency, percentile, direction);
  const velocityDisplay = formatDirectionalVelocity(velocityPerTime, direction);
  const impactLine      = formatImpactSummary(reason ?? "");

  return (
    <>
      {/* ── Collapsed summary row ─────────────────────────────────── */}
      <tr
        ref={rowRef}
        id={`ep-row-${entityId}`}
        className={`ep-row ${accentClass}${isExpanded ? " ep-row--expanded" : ""}`}
        onClick={onToggle}
        role="button"
        aria-expanded={isExpanded}
        aria-label={`${label}, rank ${rank} — click to ${isExpanded ? "collapse" : "expand"} details`}
        style={{ cursor: "pointer" }}
      >
        {/* Expand chevron */}
        <td style={{ width: 32, paddingLeft: 10 }}>
          <span className="ep-row__chevron" aria-hidden="true">
            {isExpanded ? "▲" : "▼"}
          </span>
        </td>

        {/* Rank */}
        <td style={{ width: 64 }}>
          <RankBadge rank={rank} total={totalCount} tieBreakReason={tieBreakReason} />
        </td>

        {/* Label */}
        <td>
          <span className="ep-row__label" title={label}>{label}</span>
        </td>

        {/* Direction */}
        <td style={{ width: 40, textAlign: "center" }}>
          <DirectionIndicator direction={direction} urgency={urgency} />
        </td>

        {/* Movement */}
        <td>
          <span
            className={`ep-row__velocity ep-row__velocity--${direction ?? "flat"}`}
            title={`Raw velocity: ${Number.isFinite(velocity) ? velocity : "—"}`}
          >
            {velocityDisplay}
          </span>
        </td>

        {/* Tier */}
        <td className="ep-col--tier">
          <TierLabel percentile={percentile} />
        </td>

        {/* Action + reason */}
        <td style={{ minWidth: 160 }}>
          <ActionPill action={action} />
          {impactLine ? (
            <div className="ep-row__reason" title={impactLine}>{impactLine}</div>
          ) : null}
        </td>

        {/* Urgency */}
        <td>
          <UrgencyChip urgency={urgency} />
        </td>

        {/* Alert count */}
        <td className="ep-row__alerts">
          <AlertBadge count={alertCount} />
        </td>
      </tr>

      {/* ── Expanded detail panel row ─────────────────────────────── */}
      {isExpanded && (
        <tr className="ep-detail-row">
          <td colSpan={colSpan}>
            <EntityDetailPanel entity={entity} />
          </td>
        </tr>
      )}
    </>
  );
}

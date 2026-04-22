/**
 * EntityRow.jsx
 *
 * A single collapsed entity row in the EntityTable.
 *
 * Columns rendered (left → right):
 *   Rank (#N / of M)  |  Name  |  Trend  |  Movement  |  Tier  |  Action + Reason  |  Urgency  |  Alerts
 *
 * Changes from Phase 1:
 *   FIX 1 — RankBadge shows "#N" with "of M" sub-label; TierLabel shows tier only.
 *   FIX 2 — Velocity displayed as "↑ Gaining 0.83/day", "↓ Losing 1.65/day", "→ Stable".
 *   FIX 3 — Score column removed (available in Phase 2 detail panel).
 *   FIX 4 — Action cell shows ActionPill + 1-line reason below it.
 *   FIX 6 — DirectionIndicator receives urgency for intensified coloring.
 *
 * Row accent behavior:
 *   - critical urgency → red left border
 *   - high urgency     → orange left border
 *   - top performer    → green left border (percentile ≤ 0.2, direction "up")
 *
 * Phase 2 will add expand/collapse toggle (EntityDetailPanel).
 *
 * Props:
 *   entity      — MergedEntity (fully merged pipeline record)
 *   totalCount  — number of entities in dataset (for "of M" sub-label)
 *   rowRef      — (el) => void  forwarded ref for scroll-to
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

/**
 * Derive the CSS accent class for a row based on urgency and performance tier.
 *
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
 *   entity: {
 *     entityId:        string,
 *     label:           string,
 *     rank:            number,
 *     score:           number,
 *     tieBreakReason:  string[],
 *     direction:       string,
 *     velocity:        number,
 *     velocityPerTime: number,
 *     action:          string,
 *     urgency:         string,
 *     reason:          string,
 *     alertCount:      number,
 *     percentile:      number,
 *   },
 *   totalCount: number,
 *   rowRef?:    (el: HTMLTableRowElement | null) => void,
 * }} props
 */
export default function EntityRow({ entity, totalCount, rowRef }) {
  const {
    entityId, label, rank, tieBreakReason,
    direction, velocity, velocityPerTime,
    action, urgency, reason, alertCount, percentile,
  } = entity;

  const accentClass     = resolveRowAccentClass(urgency, percentile, direction);
  const velocityDisplay = formatDirectionalVelocity(velocityPerTime, direction);
  const impactLine      = formatImpactSummary(reason ?? "");

  return (
    <tr
      ref={rowRef}
      id={`ep-row-${entityId}`}
      className={`ep-row ${accentClass}`}
      aria-label={`${label}, rank ${rank}`}
    >
      {/* Rank + position */}
      <td style={{ width: 64, paddingLeft: 16 }}>
        <RankBadge rank={rank} total={totalCount} tieBreakReason={tieBreakReason} />
      </td>

      {/* Label */}
      <td>
        <span className="ep-row__label" title={label}>{label}</span>
      </td>

      {/* Direction — urgency-aware color (FIX 6) */}
      <td style={{ width: 40, textAlign: "center" }}>
        <DirectionIndicator direction={direction} urgency={urgency} />
      </td>

      {/* Movement — directional velocity (FIX 2) */}
      <td>
        <span
          className={`ep-row__velocity ep-row__velocity--${direction ?? "flat"}`}
          title={`Raw velocity: ${Number.isFinite(velocity) ? velocity : "—"}`}
        >
          {velocityDisplay}
        </span>
      </td>

      {/* Tier — name only, no position (FIX 1) */}
      <td className="ep-col--tier">
        <TierLabel percentile={percentile} />
      </td>

      {/* Action + reason (FIX 3 removes score; FIX 4 adds reason) */}
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
  );
}

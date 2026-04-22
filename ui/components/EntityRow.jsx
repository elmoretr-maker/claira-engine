/**
 * EntityRow.jsx
 *
 * A single collapsed entity row in the EntityTable.
 *
 * Columns rendered (left → right):
 *   Rank  |  Label  |  Dir  |  Velocity/day  |  Score  |  Tier + #N of M  |  Action  |  Urgency  |  Alerts
 *
 * Row accent behavior:
 *   - critical urgency   → red left border
 *   - high urgency       → orange left border
 *   - top performer      → green left border (percentile ≤ 0.2, direction "up")
 *
 * Phase 2 will add expand/collapse toggle (EntityDetailPanel).
 *
 * Props:
 *   entity      — MergedEntity (fully merged pipeline record)
 *   totalCount  — number of entities in dataset (for "#N of M" badge)
 *   rowRef      — (el) => void  forwarded ref for scroll-to
 */

import "./EntityPerformance.css";
import {
  formatVelocityPerDay,
  formatRankLabel,
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
 *     entityId:       string,
 *     label:          string,
 *     rank:           number,
 *     score:          number,
 *     tieBreakReason: string[],
 *     direction:      string,
 *     velocityPerTime: number,
 *     action:         string,
 *     urgency:        string,
 *     alertCount:     number,
 *     percentile:     number,
 *   },
 *   totalCount: number,
 *   rowRef?:    (el: HTMLTableRowElement | null) => void,
 * }} props
 */
export default function EntityRow({ entity, totalCount, rowRef }) {
  const {
    entityId, label, rank, score, tieBreakReason,
    direction, velocityPerTime,
    action, urgency, alertCount, percentile,
  } = entity;

  const accentClass = resolveRowAccentClass(urgency, percentile, direction);
  const velocityDisplay = formatVelocityPerDay(velocityPerTime);
  const scoreDisplay = Number.isFinite(score) ? score.toFixed(1).replace(/\.0$/, "") : "—";

  return (
    <tr
      ref={rowRef}
      id={`ep-row-${entityId}`}
      className={`ep-row ${accentClass}`}
      aria-label={`${label}, rank ${rank}`}
    >
      {/* Rank */}
      <td style={{ width: 48, paddingLeft: 16 }}>
        <RankBadge rank={rank} tieBreakReason={tieBreakReason} />
      </td>

      {/* Label */}
      <td>
        <span className="ep-row__label" title={label}>{label}</span>
      </td>

      {/* Direction */}
      <td style={{ width: 36, textAlign: "center" }}>
        <DirectionIndicator direction={direction} />
      </td>

      {/* Velocity / day */}
      <td>
        <span className="ep-row__velocity">{velocityDisplay}</span>
      </td>

      {/* Score */}
      <td className="ep-col--score">
        <span className="ep-row__score">{scoreDisplay}</span>
      </td>

      {/* Tier + position */}
      <td className="ep-col--tier">
        <div className="ep-row__tier-group">
          <TierLabel percentile={percentile} rank={rank} total={totalCount} />
        </div>
      </td>

      {/* Recommended action */}
      <td>
        <ActionPill action={action} />
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

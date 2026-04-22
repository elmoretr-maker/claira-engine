/**
 * EntityDetailPanel.jsx
 *
 * Phase 2 — Expandable entity detail panel.
 * Renders inline below the selected entity row in EntityTable.
 *
 * Five sections (left → right on desktop, stacked on mobile):
 *   1. Impact       — user-facing explanation of what's happening
 *   2. State        — start/end values, net change, deliveries, sales
 *   3. Trend        — direction, daily/weekly velocity, period info
 *   4. Recommendation — action, urgency, alert count, full reason
 *   5. Insights     — disabled "Compare Changes" placeholder (Phase 4)
 *
 * Rules:
 *   - No API calls — receives full merged entity as prop
 *   - All labels are human-readable (no raw field names shown)
 *   - Consistent colors with EntityPerformance.css tokens
 *   - No modal — inline only
 */

import "./EntityPerformance.css";
import { ActionPill, UrgencyChip, AlertBadge } from "./EntityPerformanceAtoms.jsx";
import { formatDirectionalVelocity } from "../utils/engineDisplayFormatters.js";

const MS_PER_DAY  = 86_400_000;
const MS_PER_WEEK = MS_PER_DAY * 7;

/** Format a numeric value with a sign prefix (+/-) */
function signed(n) {
  if (!Number.isFinite(n)) return "—";
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return "0";
}

/** Format a date string to a short readable form */
function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
}

/** Format a velocity per-time (ms) as X/day, or "—" */
function velocityDay(velocityPerTime) {
  if (!Number.isFinite(velocityPerTime) || velocityPerTime === 0) return null;
  return Math.abs(velocityPerTime) * MS_PER_DAY;
}

/** @param {number} n */
function fmtNum(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

/** @param {number} n  @param {number} decimals */
function fmtDec(n, decimals = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

/**
 * @param {{
 *   entity: {
 *     entityId:        string,
 *     label:           string,
 *     rank:            number,
 *     score:           number,
 *     direction:       string,
 *     velocity:        number,
 *     velocityPerTime: number,
 *     periodCount:     number,
 *     netDelta:        number,
 *     salesTotal:      number,
 *     startValue:      number,
 *     endValue:        number,
 *     deliveryTotal:   number,
 *     timeRange:       { startTimestamp: string, endTimestamp: string, durationMs: number } | null,
 *     action:          string,
 *     urgency:         string,
 *     reason:          string,
 *     alertCount:      number,
 *     percentile:      number,
 *   }
 * }} props
 */
export default function EntityDetailPanel({ entity }) {
  const {
    label,
    direction, velocity, velocityPerTime, periodCount,
    netDelta, salesTotal, startValue, endValue, deliveryTotal,
    timeRange,
    action, urgency, reason, alertCount,
  } = entity;

  const vDay  = velocityDay(velocityPerTime);
  const vWeek = vDay !== null ? vDay * 7 : null;
  const durationDays = timeRange?.durationMs != null
    ? Math.round(timeRange.durationMs / MS_PER_DAY)
    : null;

  const dirVelocityStr = formatDirectionalVelocity(velocityPerTime, direction);
  const netClass = netDelta > 0 ? "ep-detail__kv-val--pos"
                 : netDelta < 0 ? "ep-detail__kv-val--neg"
                 : "";
  const dirClass = direction === "up" ? "ep-detail__kv-val--up"
                 : direction === "down" ? "ep-detail__kv-val--down"
                 : "";

  const impactText = reason?.trim() || "";

  return (
    <div className="ep-detail" role="region" aria-label={`Details for ${label}`}>

      {/* ── Section 1: Impact ──────────────────────────────────────── */}
      <div className="ep-detail__section">
        <h4 className="ep-detail__section-title">What's happening</h4>
        {impactText ? (
          <p className={`ep-detail__impact`}>{impactText}</p>
        ) : (
          <p className="ep-detail__impact ep-detail__impact--empty">
            No analysis available for this entity.
          </p>
        )}
      </div>

      {/* ── Section 2: State ───────────────────────────────────────── */}
      <div className="ep-detail__section">
        <h4 className="ep-detail__section-title">State</h4>
        <dl className="ep-detail__kv">
          <dt className="ep-detail__kv-key">Starting value</dt>
          <dd className="ep-detail__kv-val">{fmtNum(startValue)}</dd>

          <dt className="ep-detail__kv-key">Current value</dt>
          <dd className="ep-detail__kv-val">{fmtNum(endValue)}</dd>

          <dt className="ep-detail__kv-key">Net change</dt>
          <dd className={`ep-detail__kv-val ${netClass}`}>{signed(netDelta)}</dd>

          <dt className="ep-detail__kv-key">Deliveries in</dt>
          <dd className="ep-detail__kv-val">{fmtNum(deliveryTotal)}</dd>

          <dt className="ep-detail__kv-key">Sales out</dt>
          <dd className="ep-detail__kv-val">{fmtNum(salesTotal)}</dd>
        </dl>
      </div>

      {/* ── Section 3: Trend ───────────────────────────────────────── */}
      <div className="ep-detail__section">
        <h4 className="ep-detail__section-title">Trend</h4>
        <dl className="ep-detail__kv">
          <dt className="ep-detail__kv-key">Direction</dt>
          <dd className={`ep-detail__kv-val ${dirClass}`}>
            {direction === "up" ? "↑ Rising" : direction === "down" ? "↓ Falling" : "→ Stable"}
          </dd>

          <dt className="ep-detail__kv-key">Daily rate</dt>
          <dd className="ep-detail__kv-val">
            {vDay !== null ? `${fmtDec(vDay, 1)} / day` : "—"}
          </dd>

          <dt className="ep-detail__kv-key">Weekly rate</dt>
          <dd className="ep-detail__kv-val">
            {vWeek !== null ? `${fmtDec(vWeek, 1)} / week` : "—"}
          </dd>

          {timeRange ? (
            <>
              <dt className="ep-detail__kv-key">Period start</dt>
              <dd className="ep-detail__kv-val">{fmtDate(timeRange.startTimestamp)}</dd>

              <dt className="ep-detail__kv-key">Period end</dt>
              <dd className="ep-detail__kv-val">{fmtDate(timeRange.endTimestamp)}</dd>

              <dt className="ep-detail__kv-key">Duration</dt>
              <dd className="ep-detail__kv-val">
                {durationDays !== null ? `${durationDays} day${durationDays === 1 ? "" : "s"}` : "—"}
              </dd>
            </>
          ) : null}

          <dt className="ep-detail__kv-key">Data points</dt>
          <dd className="ep-detail__kv-val">
            {Number.isFinite(periodCount) && periodCount > 0 ? `${periodCount} snapshot${periodCount === 1 ? "" : "s"}` : "—"}
          </dd>
        </dl>
      </div>

      {/* ── Section 4: Recommendation ──────────────────────────────── */}
      <div className="ep-detail__section">
        <h4 className="ep-detail__section-title">Recommended action</h4>
        <div className="ep-detail__rec-row">
          <ActionPill action={action} />
          <UrgencyChip urgency={urgency} />
          {alertCount > 0 && <AlertBadge count={alertCount} />}
        </div>
        {impactText && (
          <p className="ep-detail__reason">{impactText}</p>
        )}
      </div>

      {/* ── Section 5: Insights placeholder ────────────────────────── */}
      <div className="ep-detail__section">
        <h4 className="ep-detail__section-title">Insights</h4>
        <button
          type="button"
          className="ep-detail__insights-btn"
          disabled
          aria-disabled="true"
          title="Comparative analysis coming soon"
        >
          📊 Compare Changes
        </button>
        <p className="ep-detail__insights-hint">
          Comparative analysis across time periods — coming soon.
        </p>
      </div>

    </div>
  );
}

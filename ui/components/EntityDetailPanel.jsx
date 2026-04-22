/**
 * EntityDetailPanel.jsx
 *
 * Phase 2 (refined) — Expandable entity detail panel.
 * Renders inline below the selected entity row.
 *
 * Layout: 6 sections in a structured grid
 *   ┌────────────────────────────── Impact (full-width) ───────────────────────────────┐
 *   │  State   │   Trend   │   Recommendation   │   Rank Context                      │
 *   └──────────────────────── Insights placeholder (full-width) ─────────────────────┘
 *
 * Rules:
 *   - NO raw field names displayed
 *   - NO raw timestamps (always formatted)
 *   - Velocity always expressed in /day or /week (never /ms)
 *   - Arrows and colors for direction (↑ green, ↓ red, → neutral)
 *   - "Not enough data" shown instead of empty/broken fields
 *   - ADD 7: down + high/critical → stronger red accent on Impact section
 */

import "./EntityPerformance.css";
import { ActionPill, UrgencyChip, AlertBadge } from "./EntityPerformanceAtoms.jsx";
import { formatRankLabel } from "../utils/engineDisplayFormatters.js";

const MS_PER_DAY = 86_400_000;

// ── Human-readable labels for tie-break reason keys ──────────────────────────

const REASON_NAMES = {
  "score":              "performance score",
  "direction":          "trend direction",
  "direction priority": "trend direction",
  "velocity":           "rate of change",
  "salesTotal":         "sales volume",
  "entityId":           "name",
};

// ── Pure helper functions ─────────────────────────────────────────────────────

/**
 * Format a number with sign prefix.
 * Returns "—" for non-finite values, "0" for zero, "+N" for positive, "-N" for negative.
 * @param {number} n
 */
function signed(n) {
  if (!Number.isFinite(n)) return "—";
  if (n > 0) return `+${n.toLocaleString()}`;
  if (n < 0) return `${n.toLocaleString()}`;
  return "0";
}

/**
 * Format a number safely; returns fallback for non-finite values.
 * @param {number} n
 * @param {string} [fallback]
 */
function safeNum(n, fallback = "—") {
  if (!Number.isFinite(n)) return fallback;
  return n.toLocaleString();
}

/**
 * Format a decimal number to N places; returns fallback for non-finite.
 * @param {number} n
 * @param {number} decimals
 * @param {string} [fallback]
 */
function safeDec(n, decimals = 1, fallback = "—") {
  if (!Number.isFinite(n) || n === 0) return fallback;
  return n.toFixed(decimals);
}

/**
 * Format an ISO date string to "Mon D, YYYY" (e.g. "Apr 22, 2026").
 * Returns "—" for empty/invalid input.
 * @param {string | undefined | null} iso
 */
function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch {
    return "—";
  }
}

/**
 * Compute absolute daily rate from velocityPerTime (per ms).
 * Returns null when velocity is zero or invalid.
 * @param {number} velocityPerTime
 */
function toPerDay(velocityPerTime) {
  if (!Number.isFinite(velocityPerTime) || velocityPerTime === 0) return null;
  return Math.abs(velocityPerTime) * MS_PER_DAY;
}

// ── Impact section generator ──────────────────────────────────────────────────

/**
 * Generate a 1–2 sentence plain-language explanation of what is happening.
 * Answers "why should I care?" without technical terms.
 * Uses entity data fields for precision; falls back to reason string.
 *
 * @param {{
 *   direction:    string,
 *   urgency:      string,
 *   salesTotal:   number,
 *   deliveryTotal:number,
 *   netDelta:     number,
 *   reason:       string,
 * }} entity
 * @returns {string}
 */
function rewriteImpact(entity) {
  const { direction, urgency, salesTotal, deliveryTotal, reason } = entity;

  const hasSales      = Number.isFinite(salesTotal)    && salesTotal    > 0;
  const hasDeliveries = Number.isFinite(deliveryTotal) && deliveryTotal > 0;
  const outpacing     = hasSales && salesTotal > deliveryTotal;

  if (direction === "down" && urgency === "critical") {
    if (outpacing) {
      return "Sales are significantly outpacing replenishment, causing inventory to fall rapidly. Immediate action is needed to prevent stockouts.";
    }
    return "This item is in critical decline. Immediate attention is required to prevent further loss.";
  }

  if (direction === "down" && urgency === "high") {
    if (outpacing) {
      return "Inventory is decreasing faster than it is being replenished. Consider restocking soon to avoid running out.";
    }
    return "This item is declining at a concerning rate. Investigate the cause and consider corrective action.";
  }

  if (direction === "down") {
    if (outpacing) {
      return "More is going out than coming in, causing a gradual decline. Monitor closely and restock if the trend continues.";
    }
    return "This item is slowly declining. Keep an eye on the trend and restock if needed.";
  }

  if (direction === "up") {
    if (hasDeliveries && !hasSales) {
      return "Restocking is adding inventory but sales activity hasn't started yet. Watch for when demand begins.";
    }
    return "This item is performing well and growing steadily. No immediate action is required.";
  }

  if (direction === "flat") {
    if (hasSales && hasDeliveries) {
      return "Sales and replenishment are roughly balanced, keeping levels stable. Activity is healthy and consistent.";
    }
    return "Activity is stable with minimal change. No immediate action is required.";
  }

  // Fallback to engine reason when direction is unknown
  return reason?.trim() || "Not enough data to generate an explanation.";
}

// ── Rank context tie-break formatter ─────────────────────────────────────────

/**
 * Convert tieBreakReason array into a readable sentence explaining ranking logic.
 * Returns null when there is nothing useful to say.
 *
 * Engine examples:
 *   ["score"]                                      → Ranked by performance score.
 *   ["tied score", "direction priority"]           → Tied on score — placed higher due to stronger trend direction.
 *   ["tied score", "tied direction", "velocity"]   → Tied on score and trend — placed higher by rate of change.
 *
 * @param {string[]} reasons
 * @returns {string | null}
 */
function formatTieBreakSentence(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) return null;

  const [first] = reasons;

  // Decided by score alone (no tie)
  if (first === "score") return "Ranked by overall performance score.";

  // Decided by a non-tied factor directly
  if (!first.startsWith("tied ")) {
    return `Ranked by ${REASON_NAMES[first] ?? first}.`;
  }

  // Collect tied factors and the decisive tiebreaker
  const tiedOn = [];
  let decisive = null;
  for (const r of reasons) {
    if (r.startsWith("tied ")) {
      const key = r.replace("tied ", "");
      tiedOn.push(REASON_NAMES[key] ?? key);
    } else {
      decisive = REASON_NAMES[r] ?? r;
      break;
    }
  }

  if (!decisive) return "Ranked alphabetically after a complete tie.";

  const tiedStr = tiedOn.length === 1
    ? tiedOn[0]
    : `${tiedOn.slice(0, -1).join(", ")} and ${tiedOn.at(-1)}`;

  return `Tied on ${tiedStr} — placed higher by stronger ${decisive}.`;
}

// ── Main component ────────────────────────────────────────────────────────────

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
    rank, tieBreakReason, percentile,
    direction, velocity, velocityPerTime, periodCount,
    netDelta, salesTotal, startValue, endValue, deliveryTotal,
    timeRange,
    action, urgency, reason, alertCount,
  } = entity;

  // Pre-compute derived values
  const perDay   = toPerDay(velocityPerTime);
  const perWeek  = perDay !== null ? perDay * 7 : null;
  const durationDays = timeRange?.durationMs != null
    ? Math.round(timeRange.durationMs / MS_PER_DAY)
    : null;

  const impactText   = rewriteImpact(entity);
  const tieBreakText = formatTieBreakSentence(tieBreakReason);
  const { tier, badge } = formatRankLabel(percentile, { rank, total: undefined });

  // Value classes
  const netClass = netDelta > 0 ? "ep-detail__kv-val--pos"
                 : netDelta < 0 ? "ep-detail__kv-val--neg" : "";
  const dirClass = direction === "up"   ? "ep-detail__kv-val--up"
                 : direction === "down" ? "ep-detail__kv-val--down" : "";

  // ADD 7: stronger accent for down + high/critical
  const urgentDownClass = direction === "down" && urgency === "critical" ? "ep-detail--urgent-down"
                        : direction === "down" && urgency === "high"     ? "ep-detail--high-down"
                        : "";

  return (
    <div
      className={`ep-detail ${urgentDownClass}`.trim()}
      role="region"
      aria-label={`Details for ${label}`}
    >

      {/* ── Section 1: Impact — full-width top ────────────────────── */}
      <div className="ep-detail__section ep-detail__section--impact">
        <h4 className="ep-detail__section-title">What's happening</h4>
        <p className={`ep-detail__impact${!impactText ? " ep-detail__impact--empty" : ""}`}>
          {impactText || "Not enough data available to generate an explanation."}
        </p>
      </div>

      {/* ── Section 2: State ───────────────────────────────────────── */}
      <div className="ep-detail__section">
        <h4 className="ep-detail__section-title">State</h4>
        <dl className="ep-detail__kv">
          <dt className="ep-detail__kv-key">Starting value</dt>
          <dd className="ep-detail__kv-val">{safeNum(startValue, "Not enough data")}</dd>

          <dt className="ep-detail__kv-key">Current value</dt>
          <dd className="ep-detail__kv-val">{safeNum(endValue, "Not enough data")}</dd>

          <dt className="ep-detail__kv-key">Net change</dt>
          <dd className={`ep-detail__kv-val ${netClass}`}>{signed(netDelta)}</dd>

          <dt className="ep-detail__kv-key">Received</dt>
          <dd className="ep-detail__kv-val">
            {Number.isFinite(deliveryTotal) && deliveryTotal > 0 ? safeNum(deliveryTotal) : "None recorded"}
          </dd>

          <dt className="ep-detail__kv-key">Sold / used</dt>
          <dd className="ep-detail__kv-val">
            {Number.isFinite(salesTotal) && salesTotal > 0 ? safeNum(salesTotal) : "None recorded"}
          </dd>
        </dl>
      </div>

      {/* ── Section 3: Trend ───────────────────────────────────────── */}
      <div className="ep-detail__section">
        <h4 className="ep-detail__section-title">Trend</h4>
        <dl className="ep-detail__kv">
          <dt className="ep-detail__kv-key">Direction</dt>
          <dd className={`ep-detail__kv-val ${dirClass}`}>
            {direction === "up"   ? "↑ Rising"
           : direction === "down" ? "↓ Falling"
           : direction === "flat" ? "→ Stable"
           : "Not enough data"}
          </dd>

          <dt className="ep-detail__kv-key">Daily rate</dt>
          <dd className={`ep-detail__kv-val ${dirClass}`}>
            {perDay !== null
              ? `${direction === "down" ? "−" : "+"}${safeDec(perDay)} / day`
              : "—"}
          </dd>

          <dt className="ep-detail__kv-key">Weekly rate</dt>
          <dd className={`ep-detail__kv-val ${dirClass}`}>
            {perWeek !== null
              ? `${direction === "down" ? "−" : "+"}${safeDec(perWeek)} / week`
              : "—"}
          </dd>

          {timeRange ? (
            <>
              <dt className="ep-detail__kv-key">Period</dt>
              <dd className="ep-detail__kv-val" style={{ fontSize: "0.78rem" }}>
                {fmtDate(timeRange.startTimestamp)} – {fmtDate(timeRange.endTimestamp)}
              </dd>
              <dt className="ep-detail__kv-key">Duration</dt>
              <dd className="ep-detail__kv-val">
                {durationDays !== null
                  ? `${durationDays} day${durationDays === 1 ? "" : "s"}`
                  : "—"}
              </dd>
            </>
          ) : null}

          <dt className="ep-detail__kv-key">Data points</dt>
          <dd className="ep-detail__kv-val">
            {Number.isFinite(periodCount) && periodCount > 0
              ? `${periodCount} snapshot${periodCount === 1 ? "" : "s"}`
              : "Not enough data"}
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
        {reason?.trim() ? (
          <p className="ep-detail__reason">{reason.trim()}</p>
        ) : (
          <p className="ep-detail__reason ep-detail__reason--empty">
            No specific recommendation available.
          </p>
        )}
      </div>

      {/* ── Section 5: Rank Context ─────────────────────────────────── */}
      <div className="ep-detail__section ep-detail__section--rank">
        <h4 className="ep-detail__section-title">Rank context</h4>
        <div className="ep-detail__rank-badge">
          {badge || (Number.isFinite(rank) ? `#${rank}` : "—")}
        </div>
        <div className="ep-detail__rank-tier">{tier}</div>
        {tieBreakText && (
          <p className="ep-detail__tiebreak">{tieBreakText}</p>
        )}
      </div>

      {/* ── Section 6: Insights placeholder — full-width bottom ─────── */}
      <div className="ep-detail__section ep-detail__section--insights">
        <h4 className="ep-detail__section-title">Insights</h4>
        <div className="ep-detail__insights-inner">
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
            Track how this entity changes over time — comparative analysis is coming in a future release.
          </p>
        </div>
      </div>

    </div>
  );
}

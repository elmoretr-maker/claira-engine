/**
 * EntityDetailPanel.jsx
 *
 * Phase 2 — Entity Detail Panel (final UX refinement pass).
 *
 * Layout: 6 sections in a structured grid
 *   ┌──────────────────────── Impact (full-width) ─────────────────────────┐
 *   │  State   │  Trend   │  Recommendation  │  Rank Context               │
 *   └──────────────────────── Insights (full-width) ──────────────────────┘
 *
 * Refinements applied:
 *   FIX 1 — rewriteImpact() is data-driven and includes implied action
 *   FIX 2 — Data completeness indicator (High/Medium/Low) shown in Trend
 *   FIX 3 — "Over the last X days" time context in Trend
 *   FIX 4 — Recommendation hierarchy: Action (bold) → Urgency → Reason
 *   FIX 5 — Relative rank context: "Top X%", "Bottom X%", or "#N of M"
 *   FIX 6 — Insights placeholder with improved helper text
 */

import "./EntityPerformance.css";
import { ActionPill, UrgencyChip, AlertBadge } from "./EntityPerformanceAtoms.jsx";

const MS_PER_DAY = 86_400_000;

// ── Value formatters ──────────────────────────────────────────────────────────

/** Format with locale-aware thousands separator; returns "—" for non-finite. */
function n(v, fallback = "—") {
  if (!Number.isFinite(v)) return fallback;
  return v.toLocaleString();
}

/** Format decimal to N places; returns fallback if non-finite or zero. */
function dec(v, places = 1, fallback = "—") {
  if (!Number.isFinite(v) || v === 0) return fallback;
  return v.toFixed(places);
}

/** Format with mandatory +/− sign prefix. */
function signed(v) {
  if (!Number.isFinite(v)) return "—";
  if (v > 0) return `+${v.toLocaleString()}`;
  if (v < 0) return `−${Math.abs(v).toLocaleString()}`;
  return "0";
}

/** Format ISO date to "Apr 22, 2026". Returns "—" for invalid input. */
function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch { return "—"; }
}

/** Absolute daily rate from velocityPerTime (per ms). Null if zero/invalid. */
function toPerDay(vpt) {
  if (!Number.isFinite(vpt) || vpt === 0) return null;
  return Math.abs(vpt) * MS_PER_DAY;
}

// ── FIX 1 — Impact generator ─────────────────────────────────────────────────

/**
 * Generate a 1–2 sentence plain-language explanation grounded in actual data.
 * Answers "what is happening and what should I do about it?"
 *
 * Rules:
 *   - References real numbers from the dataset (salesTotal, deliveryTotal, netDelta)
 *   - Ends with an implied action — never leaves the user without next-step guidance
 *   - Uses neutral language that works for inventory, workforce, or custom intents
 *   - Maximum 2 sentences; no technical field names or jargon
 *
 * @param {object} entity
 * @returns {string}
 */
function rewriteImpact(entity) {
  const { direction, urgency, salesTotal, deliveryTotal, netDelta, reason } = entity;

  const hasSales       = Number.isFinite(salesTotal)    && salesTotal    > 0;
  const hasDeliveries  = Number.isFinite(deliveryTotal) && deliveryTotal > 0;
  const hasActivity    = hasSales || hasDeliveries;
  const outpacing      = hasSales && hasDeliveries && salesTotal > deliveryTotal;
  const noReplenishment= hasSales && !hasDeliveries;
  const surplus        = hasDeliveries && hasSales && deliveryTotal > salesTotal;
  const noActivity     = !hasSales && !hasDeliveries;
  const loss           = Number.isFinite(netDelta) && netDelta < 0 ? Math.abs(netDelta) : null;
  const gain           = Number.isFinite(netDelta) && netDelta > 0 ? netDelta : null;
  const gap            = outpacing ? salesTotal - deliveryTotal : null;

  // ── Critical decline ───────────────────────────────────────────────────────
  if (direction === "down" && urgency === "critical") {
    if (noReplenishment && loss !== null) {
      return `${salesTotal.toLocaleString()} units left inventory this period with no incoming replenishment recorded — stock is depleting with nothing to offset it. Placing a restock order immediately is strongly recommended to prevent a stockout.`;
    }
    if (outpacing && gap !== null && loss !== null) {
      return `Sales outpaced replenishment by ${gap.toLocaleString()} units this period, resulting in a net loss of ${loss.toLocaleString()}. At this rate, stock will be exhausted before the next expected delivery — restock immediately.`;
    }
    if (loss !== null) {
      return `Inventory fell by ${loss.toLocaleString()} this period with no clear recovery signal. This is a critical decline — take immediate corrective action to prevent stock failure.`;
    }
    return "This item is in critical decline. Immediate intervention is required to prevent inventory failure — investigate the cause and act now.";
  }

  // ── High urgency decline ───────────────────────────────────────────────────
  if (direction === "down" && urgency === "high") {
    if (noReplenishment) {
      return `Outgoing activity is consuming stock with no replenishment recorded this period. If deliveries are not scheduled, running out is likely — consider placing an order soon.`;
    }
    if (outpacing && gap !== null && loss !== null) {
      return `Inventory is decreasing faster than it is being replenished: ${salesTotal.toLocaleString()} units out, ${deliveryTotal.toLocaleString()} in, net −${loss.toLocaleString()}. Restocking is likely needed soon to maintain availability.`;
    }
    if (loss !== null) {
      return `This item lost ${loss.toLocaleString()} units of value this period. The decline is significant — review your restock schedule before the situation becomes critical.`;
    }
    return "This item is declining at a concerning rate. Investigate the root cause and review your replenishment schedule before the situation worsens.";
  }

  // ── Moderate or low decline ────────────────────────────────────────────────
  if (direction === "down") {
    if (noReplenishment && loss !== null) {
      return `Activity is reducing stock (${loss.toLocaleString()} net loss) without recorded replenishment. The trend is gradual, but scheduling a delivery before it becomes urgent is advisable.`;
    }
    if (outpacing) {
      return `Outgoing activity is slightly outpacing replenishment this period, causing a gradual decline. The situation is not urgent, but a restock before the trend accelerates would be prudent.`;
    }
    if (noActivity && loss !== null) {
      return `Stock dropped by ${loss.toLocaleString()} without any recorded activity this period. This may indicate an untracked removal — review your records to confirm accuracy before taking action.`;
    }
    return "This item is gradually declining. No immediate action is required, but monitor the trend closely and restock if the pattern continues into the next period.";
  }

  // ── Growing ────────────────────────────────────────────────────────────────
  if (direction === "up") {
    if (surplus && gain !== null) {
      return `Replenishment (${deliveryTotal.toLocaleString()} in) is outpacing sales (${salesTotal.toLocaleString()} out), growing inventory by ${gain.toLocaleString()} this period. Confirm demand justifies this buffer — overstocking ties up capital unnecessarily.`;
    }
    if (hasDeliveries && !hasSales && gain !== null) {
      return `Inventory grew by ${gain.toLocaleString()} from incoming deliveries with no sales activity recorded this period. Verify that demand exists — sitting on unsold stock is a cost to manage.`;
    }
    if (hasSales && hasSales && gain !== null) {
      return `Despite active sales (${salesTotal.toLocaleString()} out), net inventory grew by ${gain.toLocaleString()} — replenishment is keeping ahead of demand. Performance is healthy; ensure the supply cadence can be maintained.`;
    }
    return "This item is growing steadily. Performance is positive and trending in the right direction — no immediate action is required. Ensure supply can keep pace if growth accelerates.";
  }

  // ── Stable ─────────────────────────────────────────────────────────────────
  if (direction === "flat") {
    if (hasSales && hasDeliveries) {
      return `Sales (${salesTotal.toLocaleString()}) and replenishment (${deliveryTotal.toLocaleString()}) are closely balanced this period, keeping levels stable. The current approach is working well — no changes are needed at this time.`;
    }
    if (noActivity) {
      return "No sales or delivery activity was recorded for this period. Confirm whether this is expected or whether data may be missing — inactive items may still incur holding costs.";
    }
    return "Activity is stable with minimal net change. No immediate action is required — check whether the current steady state aligns with your targets for this item.";
  }

  // Fallback to raw engine reason (or generic message)
  return reason?.trim() || "Not enough data to generate a meaningful explanation for this item.";
}

// ── FIX 2 — Data completeness ─────────────────────────────────────────────────

/**
 * @param {object} entity
 * @returns {{ level: "high"|"medium"|"low", label: string, description: string }}
 */
function computeCompleteness(entity) {
  const { periodCount, salesTotal, deliveryTotal, timeRange } = entity;
  const hasEvents   = (Number.isFinite(salesTotal)    && salesTotal    > 0)
                   || (Number.isFinite(deliveryTotal) && deliveryTotal > 0);
  const hasTime     = timeRange != null && Number.isFinite(timeRange.durationMs) && timeRange.durationMs > 0;
  const hasSnapshots = Number.isFinite(periodCount) && periodCount >= 2;

  if (hasSnapshots && hasEvents && hasTime) {
    return { level: "high",   label: "Complete",      description: "Snapshots + activity + time range" };
  }
  if (hasSnapshots && hasTime) {
    return { level: "medium", label: "Partial",       description: "Snapshots present, no activity recorded" };
  }
  return   { level: "low",    label: "Limited",       description: "Minimal data — results may be imprecise" };
}

// ── FIX 5 — Relative rank text ────────────────────────────────────────────────

/**
 * Produce a human-readable rank descriptor.
 * Uses "Top X%" for top quartile, "Bottom X%" for bottom quartile, "#N of M" otherwise.
 *
 * @param {number} rank
 * @param {number} percentile  (rank / totalEntities)
 * @param {number} [totalCount]
 * @returns {{ primary: string, context: string | null }}
 */
function relativeRank(rank, percentile, totalCount) {
  if (!Number.isFinite(rank)) return { primary: "—", context: null };

  // Derive total from rank/percentile when not supplied directly
  const total = totalCount
    || (Number.isFinite(percentile) && percentile > 0 ? Math.round(rank / percentile) : null);

  const posStr = total ? `#${rank} of ${total}` : `#${rank}`;

  if (!Number.isFinite(percentile)) return { primary: posStr, context: null };

  const pct = Math.round(percentile * 100);

  if (rank === 1)           return { primary: posStr, context: "Top performer" };
  if (total && rank === total) return { primary: posStr, context: "Lowest ranked" };
  if (pct <= 25)            return { primary: posStr, context: `Top ${pct}%` };
  if (pct >= 75)            return { primary: posStr, context: `Bottom ${100 - pct}%` };
  return                           { primary: posStr, context: "Mid range" };
}

// ── FIX 3 — Tie-break sentence formatter ─────────────────────────────────────

const REASON_NAMES = {
  "score":              "performance score",
  "direction":          "trend direction",
  "direction priority": "trend direction",
  "velocity":           "rate of change",
  "salesTotal":         "sales volume",
  "entityId":           "name",
};

/** @param {string[]} reasons @returns {string | null} */
function formatTieBreak(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) return null;
  const [first] = reasons;
  if (first === "score") return "Ranked by overall performance score.";
  if (!first.startsWith("tied ")) return `Ranked by ${REASON_NAMES[first] ?? first}.`;
  const tiedOn = [];
  let decisive = null;
  for (const r of reasons) {
    if (r.startsWith("tied ")) tiedOn.push(REASON_NAMES[r.replace("tied ", "")] ?? r.replace("tied ", ""));
    else { decisive = REASON_NAMES[r] ?? r; break; }
  }
  if (!decisive) return "Ranked alphabetically after a complete tie.";
  const tiedStr = tiedOn.length === 1
    ? tiedOn[0]
    : `${tiedOn.slice(0, -1).join(", ")} and ${tiedOn.at(-1)}`;
  return `Tied on ${tiedStr} — placed higher by stronger ${decisive}.`;
}

// ── Tier label helper ─────────────────────────────────────────────────────────

function tierLabel(percentile) {
  if (!Number.isFinite(percentile)) return "Unknown";
  if (percentile <= 0.25) return "Top Performer";
  if (percentile <= 0.50) return "Mid Tier";
  if (percentile <= 0.75) return "At Risk";
  return "Critical";
}

// ── Component ─────────────────────────────────────────────────────────────────

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
 *   },
 *   totalCount?: number,
 * }} props
 */
export default function EntityDetailPanel({ entity, totalCount }) {
  const {
    label,
    rank, tieBreakReason, percentile,
    direction, velocityPerTime, periodCount,
    netDelta, salesTotal, startValue, endValue, deliveryTotal,
    timeRange,
    action, urgency, reason, alertCount,
  } = entity;

  // ── Derived values ──────────────────────────────────────────────────────────
  const perDay  = toPerDay(velocityPerTime);
  const perWeek = perDay !== null ? perDay * 7 : null;
  const durationDays = timeRange?.durationMs != null
    ? Math.round(timeRange.durationMs / MS_PER_DAY)
    : null;

  const impactText  = rewriteImpact(entity);
  const completeness = computeCompleteness(entity);
  const rankInfo    = relativeRank(rank, percentile, totalCount);
  const tieBreakText = formatTieBreak(tieBreakReason);
  const tier        = tierLabel(percentile);

  // FIX 3 — Time context string
  const timeContext = durationDays != null && durationDays > 0
    ? `Over the last ${durationDays} day${durationDays === 1 ? "" : "s"}`
    : null;

  // ── CSS modifier classes ────────────────────────────────────────────────────
  const netClass = netDelta > 0 ? "ep-detail__kv-val--pos"
                 : netDelta < 0 ? "ep-detail__kv-val--neg" : "";
  const dirClass = direction === "up"   ? "ep-detail__kv-val--up"
                 : direction === "down" ? "ep-detail__kv-val--down" : "";

  // FIX 7 (from prev pass): stronger red/orange accent for critical/high down
  const urgentDownClass =
    direction === "down" && urgency === "critical" ? "ep-detail--urgent-down"
  : direction === "down" && urgency === "high"     ? "ep-detail--high-down"
  : "";

  return (
    <div
      className={`ep-detail ${urgentDownClass}`.trim()}
      role="region"
      aria-label={`Details for ${label}`}
    >

      {/* ── Section 1: Impact — full-width top ──────────────────────── */}
      <div className="ep-detail__section ep-detail__section--impact">
        <h4 className="ep-detail__section-title">What's happening</h4>
        <p className={`ep-detail__impact${!impactText ? " ep-detail__impact--empty" : ""}`}>
          {impactText || "Not enough data available to generate an explanation."}
        </p>
      </div>

      {/* ── Section 2: State ────────────────────────────────────────── */}
      <div className="ep-detail__section">
        <h4 className="ep-detail__section-title">State</h4>
        <dl className="ep-detail__kv">
          <dt className="ep-detail__kv-key">Starting value</dt>
          <dd className="ep-detail__kv-val">{n(startValue, "Not recorded")}</dd>

          <dt className="ep-detail__kv-key">Current value</dt>
          <dd className="ep-detail__kv-val">{n(endValue, "Not recorded")}</dd>

          <dt className="ep-detail__kv-key">Net change</dt>
          <dd className={`ep-detail__kv-val ${netClass}`}>{signed(netDelta)}</dd>

          <dt className="ep-detail__kv-key">Received</dt>
          <dd className="ep-detail__kv-val">
            {Number.isFinite(deliveryTotal) && deliveryTotal > 0 ? n(deliveryTotal) : "None recorded"}
          </dd>

          <dt className="ep-detail__kv-key">Sold / used</dt>
          <dd className="ep-detail__kv-val">
            {Number.isFinite(salesTotal) && salesTotal > 0 ? n(salesTotal) : "None recorded"}
          </dd>
        </dl>
      </div>

      {/* ── Section 3: Trend ────────────────────────────────────────── */}
      <div className="ep-detail__section">
        {/* FIX 3 — time context in section title */}
        <h4 className="ep-detail__section-title">
          {timeContext ? `Trend · ${timeContext}` : "Trend"}
        </h4>
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
              ? `${direction === "down" ? "−" : "+"}${dec(perDay)} / day`
              : "—"}
          </dd>

          <dt className="ep-detail__kv-key">Weekly rate</dt>
          <dd className={`ep-detail__kv-val ${dirClass}`}>
            {perWeek !== null
              ? `${direction === "down" ? "−" : "+"}${dec(perWeek)} / week`
              : "—"}
          </dd>

          {timeRange ? (
            <>
              <dt className="ep-detail__kv-key">From</dt>
              <dd className="ep-detail__kv-val" style={{ fontSize: "0.78rem" }}>
                {fmtDate(timeRange.startTimestamp)}
              </dd>
              <dt className="ep-detail__kv-key">To</dt>
              <dd className="ep-detail__kv-val" style={{ fontSize: "0.78rem" }}>
                {fmtDate(timeRange.endTimestamp)}
              </dd>
            </>
          ) : null}

          <dt className="ep-detail__kv-key">Snapshots</dt>
          <dd className="ep-detail__kv-val">
            {Number.isFinite(periodCount) && periodCount > 0
              ? `${periodCount} measurement${periodCount === 1 ? "" : "s"}`
              : "Not enough data"}
          </dd>
        </dl>

        {/* FIX 2 — Data completeness indicator */}
        <div className={`ep-detail__completeness ep-detail__completeness--${completeness.level}`}
             title={completeness.description}>
          <span className="ep-detail__completeness-dot" aria-hidden="true" />
          <span className="ep-detail__completeness-label">
            {completeness.label} data
          </span>
        </div>
      </div>

      {/* ── Section 4: Recommendation ───────────────────────────────── */}
      {/* FIX 4 — Hierarchy: Action (primary) → Urgency → Reason */}
      <div className="ep-detail__section">
        <h4 className="ep-detail__section-title">Recommended action</h4>

        {/* Primary: Action */}
        <div className="ep-detail__rec-action">
          <ActionPill action={action} />
        </div>

        {/* Secondary: Urgency + Alerts */}
        <div className="ep-detail__rec-meta">
          <UrgencyChip urgency={urgency} />
          {alertCount > 0 && <AlertBadge count={alertCount} />}
        </div>

        {/* Supporting: Reason */}
        {reason?.trim() ? (
          <p className="ep-detail__reason">{reason.trim()}</p>
        ) : (
          <p className="ep-detail__reason ep-detail__reason--empty">
            No specific recommendation available.
          </p>
        )}
      </div>

      {/* ── Section 5: Rank Context ──────────────────────────────────── */}
      {/* FIX 5 — Top X% / Bottom X% / #N of M */}
      <div className="ep-detail__section ep-detail__section--rank">
        <h4 className="ep-detail__section-title">Rank context</h4>

        <div className="ep-detail__rank-badge">{rankInfo.primary}</div>
        {rankInfo.context && (
          <div className="ep-detail__rank-context">{rankInfo.context}</div>
        )}
        <div className="ep-detail__rank-tier">{tier}</div>

        {tieBreakText && (
          <p className="ep-detail__tiebreak">{tieBreakText}</p>
        )}
      </div>

      {/* ── Section 6: Insights placeholder — full-width bottom ──────── */}
      {/* FIX 6 — Improved label and helper text */}
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
            See how this item is evolving over time — comparative analysis across periods is coming soon.
          </p>
        </div>
      </div>

    </div>
  );
}

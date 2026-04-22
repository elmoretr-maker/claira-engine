/**
 * EntityPerformanceAtoms.jsx
 *
 * Small, stateless display atoms used throughout the Entity Performance UI.
 * Each atom is a pure presentation component — no state, no side effects.
 *
 * Atoms exported:
 *   UrgencyChip        — color-coded urgency badge (critical/high/medium/low)
 *   DirectionIndicator — ↑ ↓ → with semantic color, urgency-aware intensity
 *   ActionPill         — reorder / promote / investigate / monitor
 *   RankBadge          — #N with "of M" sub-label + tie-break tooltip
 *   TierLabel          — "Top Performer" / "Mid Tier" / "At Risk" / "Critical"
 *   AlertBadge         — 🔔 N alerts badge (renders null when count = 0)
 *
 * FIX 1: RankBadge now shows "#N of M" (primary + sub-label).
 *         TierLabel shows tier name only — no position badge.
 * FIX 6: DirectionIndicator accepts optional `urgency` prop for intensified
 *         coloring when direction="down" and urgency is critical or high.
 */

import "./EntityPerformance.css";
import {
  formatUrgencyLabel,
  formatActionLabel,
  formatRankLabel,
  formatTieBreakReason,
} from "../utils/engineDisplayFormatters.js";

// ── UrgencyChip ────────────────────────────────────────────────────────────────

/**
 * @param {{ urgency: "critical"|"high"|"medium"|"low"|string }} props
 */
export function UrgencyChip({ urgency }) {
  return (
    <span className={`ep-urgency-chip ep-urgency-chip--${urgency ?? "low"}`}>
      ● {formatUrgencyLabel(urgency)}
    </span>
  );
}

// ── DirectionIndicator ─────────────────────────────────────────────────────────
// FIX 6: when direction="down" + urgency is critical/high → stronger red class.

/**
 * @param {{
 *   direction: "up"|"down"|"flat"|string,
 *   urgency?:  string,
 *   size?:     "sm"|"md",
 * }} props
 */
export function DirectionIndicator({ direction, urgency, size = "md" }) {
  const SYMBOL = { up: "↑", flat: "→", down: "↓" };
  const symbol = SYMBOL[direction] ?? "→";
  const dir    = direction === "up" || direction === "down" || direction === "flat" ? direction : "flat";

  // Urgency-intensified: down + critical/high = brighter, bolder red
  const intensified = dir === "down" && (urgency === "critical" || urgency === "high");

  const className = [
    "ep-direction",
    `ep-direction--${dir}`,
    intensified ? "ep-direction--urgent-down" : "",
  ].filter(Boolean).join(" ");

  return (
    <span
      className={className}
      style={size === "sm" ? { fontSize: "0.85rem" } : undefined}
      aria-label={`Trend: ${dir}`}
    >
      {symbol}
    </span>
  );
}

// ── ActionPill ─────────────────────────────────────────────────────────────────

const ACTION_ICONS = {
  reorder:     "↩",
  promote:     "★",
  investigate: "?",
  monitor:     "◎",
};

/** @param {{ action: "reorder"|"promote"|"investigate"|"monitor"|string }} props */
export function ActionPill({ action }) {
  const key = ["reorder", "promote", "investigate", "monitor"].includes(action) ? action : "monitor";
  return (
    <span className={`ep-action-pill ep-action-pill--${key}`}>
      <span aria-hidden="true">{ACTION_ICONS[key] ?? "•"}</span>
      {formatActionLabel(action)}
    </span>
  );
}

// ── RankBadge ──────────────────────────────────────────────────────────────────
// FIX 1: shows "#N" badge + "of M" sub-label as the primary position display.

/**
 * @param {{
 *   rank:            number,
 *   total?:          number,
 *   tieBreakReason?: string[],
 * }} props
 */
export function RankBadge({ rank, total, tieBreakReason }) {
  const topThreeClass = rank <= 3 ? ` ep-rank-badge--${rank}` : "";
  const tooltip = formatTieBreakReason(tieBreakReason ?? []);
  return (
    <div className="ep-rank-block" data-tooltip={tooltip}>
      <span className={`ep-rank-badge${topThreeClass}`} aria-label={`Rank ${rank}`}>
        #{rank}
      </span>
      {total != null && total > 0 ? (
        <span className="ep-rank-of">of {total}</span>
      ) : null}
    </div>
  );
}

// ── TierLabel ──────────────────────────────────────────────────────────────────
// FIX 1: shows tier name only — position badge removed (now in RankBadge).

const TIER_CLASS = {
  "Top Performer": "top",
  "Mid Tier":      "mid",
  "At Risk":       "at-risk",
  "Critical":      "critical",
};

/**
 * @param {{
 *   percentile: number,
 * }} props
 */
export function TierLabel({ percentile }) {
  const { tier } = formatRankLabel(percentile);
  const cls = TIER_CLASS[tier] ?? "mid";
  return (
    <span className={`ep-tier-label ep-tier-label--${cls}`}>{tier}</span>
  );
}

// ── AlertBadge ─────────────────────────────────────────────────────────────────
// FIX 6 confirm: renders null when count = 0. ✅

/** @param {{ count: number }} props */
export function AlertBadge({ count }) {
  if (!count || count <= 0) return null;
  return (
    <span className="ep-alert-badge" aria-label={`${count} alert${count === 1 ? "" : "s"}`}>
      🔔 {count}
    </span>
  );
}

/**
 * EntityPerformanceAtoms.jsx
 *
 * Small, stateless display atoms used throughout the Entity Performance UI.
 * Each atom is a pure presentation component — no state, no side effects.
 *
 * Atoms exported:
 *   UrgencyChip       — color-coded urgency badge (critical/high/medium/low)
 *   DirectionIndicator — ↑ ↓ → with semantic color
 *   ActionPill        — reorder / promote / investigate / monitor
 *   RankBadge         — #N rank with optional tooltip
 *   TierLabel         — "Top Performer" / "Mid Tier" / "At Risk" / "Critical"
 *   AlertBadge        — 🔔 N alerts badge (hidden when 0)
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
  const DOT = { critical: "●", high: "●", medium: "●", low: "●" };
  return (
    <span className={`ep-urgency-chip ep-urgency-chip--${urgency ?? "low"}`}>
      {DOT[urgency] ?? "●"} {formatUrgencyLabel(urgency)}
    </span>
  );
}

// ── DirectionIndicator ─────────────────────────────────────────────────────────

/** @param {{ direction: "up"|"down"|"flat"|string, size?: "sm"|"md" }} props */
export function DirectionIndicator({ direction, size = "md" }) {
  const SYMBOL = { up: "↑", flat: "→", down: "↓" };
  const symbol = SYMBOL[direction] ?? "→";
  const dir    = direction === "up" || direction === "down" || direction === "flat" ? direction : "flat";
  return (
    <span
      className={`ep-direction ep-direction--${dir}`}
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

/**
 * @param {{
 *   rank:            number,
 *   tieBreakReason?: string[],
 * }} props
 */
export function RankBadge({ rank, tieBreakReason }) {
  const topThreeClass = rank <= 3 ? ` ep-rank-badge--${rank}` : "";
  const tooltip = formatTieBreakReason(tieBreakReason ?? []);
  return (
    <span
      className={`ep-rank-badge${topThreeClass}`}
      data-tooltip={tooltip}
      aria-label={`Rank ${rank}`}
    >
      #{rank}
    </span>
  );
}

// ── TierLabel ──────────────────────────────────────────────────────────────────

const TIER_CLASS = {
  "Top Performer": "top",
  "Mid Tier":      "mid",
  "At Risk":       "at-risk",
  "Critical":      "critical",
};

/**
 * @param {{
 *   percentile: number,
 *   rank?:      number,
 *   total?:     number,
 * }} props
 */
export function TierLabel({ percentile, rank, total }) {
  const { tier, badge } = formatRankLabel(percentile, { rank, total });
  const cls = TIER_CLASS[tier] ?? "mid";
  return (
    <span>
      <span className={`ep-tier-label ep-tier-label--${cls}`}>{tier}</span>
      {badge ? <span className="ep-tier-badge">{badge}</span> : null}
    </span>
  );
}

// ── AlertBadge ─────────────────────────────────────────────────────────────────

/** @param {{ count: number }} props */
export function AlertBadge({ count }) {
  if (!count || count <= 0) return null;
  return (
    <span className="ep-alert-badge" aria-label={`${count} alert${count === 1 ? "" : "s"}`}>
      🔔 {count}
    </span>
  );
}

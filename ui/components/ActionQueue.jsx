/**
 * ActionQueue.jsx
 *
 * Top-of-screen summary of entities requiring action, grouped into three urgency tiers:
 *   🔴 Act Now        — critical + high urgency
 *   🟡 Monitor        — medium urgency
 *   🟢 Performing Well — low urgency
 *
 * Each entity chip is clickable — scrolls the corresponding EntityRow into view.
 *
 * Props:
 *   entities    — MergedEntity[] sorted by urgency then rank
 *   onScrollTo  — (entityId: string) => void  called on chip click
 */

import "./EntityPerformance.css";
import { groupByActionTier } from "../utils/engineDisplayFormatters.js";
import { wellnessActionLabel } from "../utils/wellnessAnalysis.js";
import { ActionPill, DirectionIndicator } from "./EntityPerformanceAtoms.jsx";

// ── Tier strip ─────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   tierKey:    "act-now" | "monitor" | "well",
 *   icon:       string,
 *   label:      string,
 *   entities:   object[],
 *   onScrollTo: (id: string) => void,
 * }} props
 */
function ActionQueueTier({ tierKey, icon, label, entities, onScrollTo }) {
  return (
    <div className={`ep-action-queue__tier ep-action-queue__tier--${tierKey}`}>
      <div className="ep-action-queue__tier-header">
        <span aria-hidden="true">{icon}</span>
        {label}
        <span className="ep-action-queue__count">{entities.length}</span>
      </div>
      {entities.length > 0 ? (
        <div className="ep-action-queue__items">
          {entities.map((entity) => (
            <ActionQueueItem
              key={entity.entityId}
              entity={entity}
              onScrollTo={onScrollTo}
            />
          ))}
        </div>
      ) : (
        <div className="ep-action-queue__items" style={{ opacity: 0.45, fontStyle: "italic", fontSize: "0.8rem", color: "var(--text-secondary)", paddingTop: 4 }}>
          None
        </div>
      )}
    </div>
  );
}

// ── Individual chip ────────────────────────────────────────────────────────────

/**
 * @param {{
 *   entity:     { entityId: string, label: string, direction: string, action: string, urgency: string, rank: number },
 *   onScrollTo: (id: string) => void,
 * }} props
 */
function ActionQueueItem({ entity, onScrollTo }) {
  return (
    <button
      type="button"
      className="ep-action-queue__item"
      onClick={() => onScrollTo(entity.entityId)}
      title={`Go to ${entity.label}`}
    >
      <DirectionIndicator direction={entity.direction} size="sm" />
      <span className="ep-action-queue__item-label">{entity.label}</span>
      <span className="ep-action-queue__item-action">
        <ActionPill
          action={entity.action}
          label={
            entity.analyzerIntent === "weightloss"
              ? wellnessActionLabel(entity.action)
              : undefined
          }
        />
      </span>
    </button>
  );
}

// ── ActionQueue ────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   entities:   object[],
 *   onScrollTo: (entityId: string) => void,
 * }} props
 */
export default function ActionQueue({ entities, onScrollTo }) {
  const { actNow, monitor, performingWell } = groupByActionTier(entities);

  return (
    <div className="ep-action-queue">
      {/* Empty state: no critical/high items */}
      {actNow.length === 0 ? (
        <div className="ep-action-queue__all-well">
          <span aria-hidden="true" style={{ fontSize: "1.1rem" }}>✅</span>
          All items performing well — no immediate action required
        </div>
      ) : (
        <ActionQueueTier
          tierKey="act-now"
          icon="🔴"
          label="Act Now"
          entities={actNow}
          onScrollTo={onScrollTo}
        />
      )}

      <ActionQueueTier
        tierKey="monitor"
        icon="🟡"
        label="Monitor"
        entities={monitor}
        onScrollTo={onScrollTo}
      />

      <ActionQueueTier
        tierKey="well"
        icon="🟢"
        label="Performing Well"
        entities={performingWell}
        onScrollTo={onScrollTo}
      />
    </div>
  );
}

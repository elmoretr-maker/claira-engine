import { useCallback, useEffect, useState } from "react";
import { getEntity } from "../../../interfaces/api.js";

/**
 * @param {{
 *   entityId: string,
 *   templateId: string,
 *   moduleOptions: Record<string, unknown>,
 *   onEntitySelect: (id: string) => void,
 *   onEntitiesChanged: () => void,
 *   refreshKey?: number,
 *   highlightedEventId?: string,
 *   uiCopy: { emptyTimeline: string, selectEntityFirst: string },
 * }} props
 */
export default function EventLogTimelineWidget({
  entityId,
  refreshKey = 0,
  highlightedEventId = "",
  uiCopy,
}) {
  const [events, setEvents] = useState(/** @type {unknown[]} */ ([]));

  const load = useCallback(async () => {
    if (!entityId) {
      setEvents([]);
      return;
    }
    const r = await getEntity({ entityId });
    if (r && typeof r === "object" && Array.isArray(r.events)) {
      const sorted = r.events.slice().sort((a, b) => {
        const ta = typeof a?.at === "string" ? a.at : "";
        const tb = typeof b?.at === "string" ? b.at : "";
        return tb.localeCompare(ta);
      });
      setEvents(sorted);
    } else {
      setEvents([]);
    }
  }, [entityId]);

  useEffect(() => {
    void load().catch(() => {});
  }, [load, refreshKey]);

  return (
    <div>
      {!entityId ? (
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted, #6b7280)" }}>{uiCopy.selectEntityFirst}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "0.88rem" }}>
          {events.length === 0 ? (
            <li style={{ color: "var(--text-muted, #6b7280)" }}>{uiCopy.emptyTimeline}</li>
          ) : (
            events.map((ev) => {
              const id = typeof ev?.id === "string" ? ev.id : "";
              const type = typeof ev?.type === "string" ? ev.type : "";
              const at = typeof ev?.at === "string" ? ev.at : "";
              const isHighlight = highlightedEventId && id === highlightedEventId;
              return (
                <li
                  key={id || `${type}-${at}`}
                  style={{
                    borderBottom: "1px solid var(--border-subtle, rgba(0,0,0,0.08))",
                    padding: "0.45rem 0",
                    outline: isHighlight ? "2px solid var(--accent, #2563eb)" : undefined,
                    borderRadius: isHighlight ? 4 : undefined,
                  }}
                >
                  <strong>{type}</strong>
                  <span style={{ marginLeft: "0.5rem", color: "var(--text-muted, #6b7280)" }}>{at}</span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

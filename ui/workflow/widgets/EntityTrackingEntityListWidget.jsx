import { useEffect, useState } from "react";
import { listEntities } from "../../../interfaces/api.js";

/**
 * @param {{
 *   entityId: string,
 *   templateId: string,
 *   moduleOptions: Record<string, unknown>,
 *   onEntitySelect: (id: string) => void,
 *   refreshKey?: number,
 *   uiCopy: { emptyEntityList: string },
 * }} props
 */
export default function EntityTrackingEntityListWidget({
  entityId,
  moduleOptions: _moduleOptions,
  onEntitySelect,
  refreshKey = 0,
  uiCopy,
}) {
  const [entities, setEntities] = useState(/** @type {unknown[]} */ ([]));

  useEffect(() => {
    void (async () => {
      const r = await listEntities();
      if (r && typeof r === "object" && Array.isArray(r.clients)) {
        setEntities(r.clients);
      }
    })().catch(() => {});
  }, [refreshKey]);

  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {entities.length === 0 ? (
          <li style={{ color: "var(--text-muted, #6b7280)", fontSize: "0.9rem" }}>{uiCopy.emptyEntityList}</li>
        ) : (
          entities.map((c) => {
            const id = typeof c?.id === "string" ? c.id : "";
            const label = typeof c?.displayName === "string" ? c.displayName : id;
            const active = id === entityId;
            return (
              <li key={id || label} style={{ marginBottom: "0.35rem" }}>
                <button
                  type="button"
                  className={active ? "btn btn-primary" : "btn btn-ghost"}
                  style={{ width: "100%", justifyContent: "flex-start", fontSize: "0.9rem" }}
                  onClick={() => onEntitySelect(id)}
                >
                  {label}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

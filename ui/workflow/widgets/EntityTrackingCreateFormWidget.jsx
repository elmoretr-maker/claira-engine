import { useCallback, useState } from "react";
import { createEntity } from "../../../interfaces/api.js";

/**
 * @param {{
 *   entityId: string,
 *   templateId: string,
 *   moduleOptions: Record<string, unknown>,
 *   onEntitySelect: (id: string) => void,
 *   onEntitiesChanged: () => void,
 *   uiCopy: { entitySingular: string },
 * }} props
 */
export default function EntityTrackingCreateFormWidget({
  moduleOptions: _moduleOptions,
  onEntitySelect,
  onEntitiesChanged,
  uiCopy,
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));

  const singular = uiCopy.entitySingular;

  const submit = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await createEntity({ displayName: name.trim() });
      if (!r || typeof r !== "object" || r.ok !== true) {
        throw new Error(typeof r?.error === "string" ? r.error : "Create failed");
      }
      setName("");
      const id = typeof r.client?.id === "string" ? r.client.id : "";
      if (id) onEntitySelect(id);
      onEntitiesChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [name, onEntitySelect, onEntitiesChanged]);

  return (
    <section style={{ marginBottom: "0.25rem" }}>
      <p style={{ fontSize: "0.85rem", color: "var(--text-muted, #6b7280)", margin: "0 0 0.5rem" }}>
        Add {singular.toLowerCase()}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <input
          type="text"
          placeholder={`Name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          aria-label={`${singular} name`}
          style={{
            minWidth: 160,
            padding: "0.45rem 0.6rem",
            borderRadius: 6,
            border: "1px solid var(--border-default, #ccc)",
            background: "var(--surface-input, #fff)",
            color: "inherit",
            fontSize: "0.9rem",
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !name.trim()}
          onClick={() => void submit()}
        >
          Create
        </button>
      </div>
      {error ? (
        <p role="alert" style={{ color: "var(--danger, #c00)", fontSize: "0.85rem", marginTop: "0.35rem" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

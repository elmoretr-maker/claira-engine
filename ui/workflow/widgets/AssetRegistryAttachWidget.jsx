import { useCallback, useState } from "react";
import { processData } from "../../../interfaces/api.js";

/**
 * @param {{
 *   entityId: string,
 *   templateId: string,
 *   moduleOptions: Record<string, unknown>,
 *   onEntitySelect: (id: string) => void,
 *   onEntitiesChanged: () => void,
 *   onAttachComplete?: () => void | Promise<void>,
 *   uiCopy: { selectEntityFirst: string },
 * }} props
 */
export default function AssetRegistryAttachWidget({ entityId, onEntitiesChanged, onAttachComplete, uiCopy }) {
  const [busy, setBusy] = useState(false);
  const [attachPhase, setAttachPhase] = useState(/** @type {"uploading" | "processing" | null} */ (null));
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [moduleWarning, setModuleWarning] = useState(/** @type {string | null} */ (null));

  const handleFile = useCallback(
    async (file) => {
      if (!entityId || !file) return;
      setError(null);
      setModuleWarning(null);
      setBusy(true);
      setAttachPhase("uploading");
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        setAttachPhase("processing");
        const out = await processData(
          [
            {
              type: "image",
              data: { buffer: buf },
              metadata: { source: "workflow_ui", originalName: file.name || "upload.png" },
            },
          ],
          { workflowContext: { entityId } },
        );
        const postWf = /** @type {{ workflowModuleErrors?: string[] }} */ (out);
        if (Array.isArray(postWf.workflowModuleErrors) && postWf.workflowModuleErrors.length > 0) {
          setModuleWarning("Some data may not be fully updated");
        }
        onEntitiesChanged();
        await onAttachComplete?.();
      } catch {
        setError("Failed to add data. Please try again.");
      } finally {
        setBusy(false);
        setAttachPhase(null);
      }
    },
    [entityId, onEntitiesChanged, onAttachComplete],
  );

  const statusLine =
    busy && entityId
      ? attachPhase === "uploading"
        ? "Uploading…"
        : attachPhase === "processing"
          ? "Processing…"
          : "Processing…"
      : null;

  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <p style={{ fontSize: "0.8rem", color: "var(--text-muted, #6b7280)", margin: "0 0 0.5rem" }}>
        Files run through the standard Claira pipeline; this screen only adds data for the selected record.
      </p>
      <label style={{ display: "block", fontSize: "0.85rem" }}>
        Image
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy || !entityId}
          style={{ display: "block", marginTop: "0.35rem" }}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            void handleFile(f);
          }}
        />
      </label>
      {!entityId ? (
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted, #6b7280)", marginTop: "0.35rem" }}>
          {uiCopy.selectEntityFirst}
        </p>
      ) : null}
      {statusLine ? (
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted, #6b7280)", marginTop: "0.35rem" }}>{statusLine}</p>
      ) : null}
      {moduleWarning ? (
        <p role="status" style={{ color: "var(--warning-foreground, #b45309)", fontSize: "0.85rem", marginTop: "0.35rem" }}>
          {moduleWarning}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: "var(--danger, #c00)", fontSize: "0.85rem", marginTop: "0.35rem" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

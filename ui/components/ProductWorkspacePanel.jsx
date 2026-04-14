import { useCallback, useEffect, useRef, useState } from "react";
import {
  workspaceGeneratorSnapshot,
  workspaceScan,
  workspaceSimulationIngest,
  workspaceSync,
} from "../clairaApiClient.js";
import "../voice/ClairaVoiceChrome.css";
import "./ProductWorkspacePanel.css";

/**
 * @typedef {{ id: string, relPath: string, category: string | null, basename: string, attributes: Record<string, unknown>, needsReconcile?: boolean }} ScanItem
 */

/**
 * @param {string} key
 */
function friendlyReadModelPathLabel(key) {
  const k = String(key);
  if (k === "storeJson") return "My records file";
  if (k === "derivedManifest") return "Product list file (for automations)";
  if (k === "generatorSnapshot") return "Automation snapshot file";
  return k;
}

/**
 * @param {Record<string, unknown>} r
 */
function formatSyncSuccessToast(r) {
  const s = /** @type {{ renamed?: number, moved?: number, attrs?: number, categories?: number, removedOrphans?: number }} */ (
    r.summary ?? {}
  );
  const parts = [];
  if (s.renamed) parts.push(`renamed ${s.renamed}`);
  if (s.moved) parts.push(`moved ${s.moved}`);
  if (s.removedOrphans)
    parts.push(`removed ${s.removedOrphans} outdated link${s.removedOrphans === 1 ? "" : "s"} to files that are gone`);
  if (s.attrs) parts.push(`updated ${s.attrs} detail(s)`);
  if (s.categories) parts.push(`added ${s.categories} categor${s.categories === 1 ? "y" : "ies"}`);
  const summaryPart = parts.length > 0 ? ` ${parts.join(", ")}.` : " Everything already matched your files.";
  return "\u2705 All changes applied successfully." + summaryPart;
}

/**
 * @param {{
 *   industrySlug: string,
 *   packLabel: string,
 *   onBack: () => void,
 * }} props
 */
export default function ProductWorkspacePanel({
  industrySlug,
  packLabel,
  onBack,
}) {
  /** @type {"simulation" | "live"} */
  const [mode, setMode] = useState("simulation");
  const [items, setItems] = useState(/** @type {ScanItem[]} */ ([]));
  const [categories, setCategories] = useState(/** @type {string[]} */ ([]));
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(/** @type {{ kind: "ok" | "err", text: string } | null} */ (null));
  const [rowError, setRowError] = useState(/** @type {Record<string, string>} */ ({}));
  /** pending: relPath -> { rename?, moveCategory?, note? } (stable across reconcile until Sync) */
  const [pending, setPending] = useState(/** @type {Record<string, { rename?: string, moveCategory?: string, note?: string }>} */ ({}));

  const renameFieldRefs = useRef(/** @type {Record<string, HTMLInputElement | null>} */ ({}));
  const moveFieldRefs = useRef(/** @type {Record<string, HTMLSelectElement | null>} */ ({}));
  const noteFieldRefs = useRef(/** @type {Record<string, HTMLInputElement | null>} */ ({}));
   const [errorFocus, setErrorFocus] = useState(/** @type {{ itemId: string, field: "rename" | "move" | "note" } | null} */ (null));
  const [readModelDetail, setReadModelDetail] = useState(
    /** @type {{ generation: string | number, paths: Record<string, string> } | null} */ (null),
  );

  const loadScan = useCallback(async () => {
    if (!industrySlug) return;
    setBusy(true);
    try {
      const r = await workspaceScan({ industry: industrySlug, mode, accountId: "local" });
      if (!r?.ok) {
        setToast({
          kind: "err",
          text:
            typeof r?.error === "string"
              ? r.error
              : "I couldn’t load your product list from disk—check the pack and mode you’re using, then try Refresh.",
        });
        return;
      }
      const nextItems = Array.isArray(r.items) ? r.items : [];
      const nextCategories = Array.isArray(r.categories) ? r.categories : [];
      setItems(nextItems);
      setCategories(nextCategories);
      const paths = new Set(nextItems.map((i) => i.relPath));
      setPending((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (!paths.has(k)) delete next[k];
        }
        return next;
      });
      setRowError((prev) => {
        const ids = new Set(nextItems.map((i) => i.id).filter(Boolean));
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (!ids.has(k)) delete next[k];
        }
        return next;
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setToast({
        kind: "err",
        text: m.startsWith("I ") ? m : `I couldn’t refresh the list. ${m} Try Refresh again.`,
      });
    } finally {
      setBusy(false);
    }
  }, [industrySlug, mode]);

  useEffect(() => {
    void loadScan();
  }, [loadScan]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (Object.keys(rowError).length === 0) setErrorFocus(null);
  }, [rowError]);

  useEffect(() => {
    if (!errorFocus?.itemId) return;
    const { itemId, field } = errorFocus;
    const map = field === "move" ? moveFieldRefs : field === "note" ? noteFieldRefs : renameFieldRefs;
    const el = map.current[itemId];
    if (el && typeof el.focus === "function") {
      requestAnimationFrame(() => el.focus());
    }
  }, [errorFocus]);

  async function handleSync(operations) {
    if (!industrySlug) return;
    setBusy(true);
    try {
      const r = await workspaceSync({
        industry: industrySlug,
        mode,
        accountId: "local",
        operations,
      });
      if (!r?.ok) {
        const msg = typeof r?.error === "string" ? r.error : "I couldn’t apply your changes.";
        const raw = r?.itemErrors;
        const ie =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? /** @type {Record<string, string>} */ (raw)
            : {};
        setRowError(ie);
        const errs = Array.isArray(r.errors) ? r.errors : [];
        const top = errs.find((x) => x && typeof x === "object" && typeof /** @type {{ fix?: string }} */ (x).fix === "string");
        const fix = top && typeof /** @type {{ fix?: string }} */ (top).fix === "string" ? top.fix : "";
        const augment = fix && !msg.includes(fix) ? ` — ${fix}` : "";
        setToast({ kind: "err", text: `${msg}${augment}` });
        const withHint = errs.find(
          (e) =>
            e &&
            typeof e === "object" &&
            typeof /** @type {{ itemId?: string, focus?: string }} */ (e).itemId === "string",
        );
        const wid = withHint && /** @type {{ itemId?: string, focus?: string }} */ (withHint).itemId;
        const fc = withHint && /** @type {{ focus?: string }} */ (withHint).focus;
        const field =
          fc === "move" || fc === "note" || fc === "rename" ? fc : "rename";
        setErrorFocus(wid ? { itemId: String(wid), field } : null);
        return;
      }
      setRowError({});
      setErrorFocus(null);
      setReadModelDetail(null);
      setToast({ kind: "ok", text: formatSyncSuccessToast(r) });
      setPending({});
      await loadScan();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setToast({
        kind: "err",
        text: m.startsWith("I ") ? m : `I couldn’t finish that request. ${m} I’ll try again if you tap Update once more.`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleIngest(e) {
    const input = e.target;
    if (!input.files?.length) return;
    setBusy(true);
    try {
      const files = [...input.files];
      /** @type {{ name: string, base64: string }[]} */
      const payload = [];
      for (const f of files) {
        const b64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(f);
        });
        payload.push({ name: f.name, base64: b64 });
      }
      const r = await workspaceSimulationIngest({
        industry: industrySlug,
        accountId: "local",
        mode: "simulation",
        files: payload,
      });
      if (!r?.ok) {
        setToast({
          kind: "err",
          text:
            typeof r?.error === "string"
              ? r.error
              : "I couldn’t copy those files—try again with smaller or fewer files.",
        });
        return;
      }
      const copied = typeof r.copied === "number" ? r.copied : 0;
      const so = typeof r.skippedOversized === "number" ? r.skippedOversized : 0;
      const se = typeof r.skippedEmpty === "number" ? r.skippedEmpty : 0;
      let okText = `I copied ${copied} file(s) into your practice workspace—your originals are untouched.`;
      if (so) okText += ` I skipped ${so} that were over 40 MB.`;
      if (se) okText += ` I skipped ${se} empty file(s).`;
      setToast({ kind: "ok", text: okText });
      await loadScan();
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setToast({
        kind: "err",
        text: m.startsWith("I ") ? m : `I couldn’t finish copying. ${m}`,
      });
    } finally {
      setBusy(false);
      input.value = "";
    }
  }

  function buildOperationsFromPending() {
    /** @type {Record<string, unknown>[]} */
    const ops = [];
    const sorted = [...items].sort((a, b) => a.relPath.localeCompare(b.relPath));
    for (const it of sorted) {
      if (!it.id) continue;
      const p = pending[it.relPath];
      if (!p) continue;
      if (p.rename != null && String(p.rename).trim() && String(p.rename).trim() !== it.basename) {
        ops.push({ op: "rename", itemId: it.id, newBasename: String(p.rename).trim() });
      }
      if (p.moveCategory != null && String(p.moveCategory).trim() && p.moveCategory !== it.category) {
        ops.push({ op: "move", itemId: it.id, category: String(p.moveCategory).trim() });
      }
      const curNote = it.attributes?.note != null ? String(it.attributes.note) : "";
      if (p.note != null && String(p.note).trim() !== curNote.trim()) {
        ops.push({ op: "setAttribute", itemId: it.id, attributeKey: "note", attributeValue: String(p.note).trim() });
      }
    }
    return ops;
  }

  const needsReconcile = items.some((x) => x.needsReconcile);
  const hasRowErrors = Object.keys(rowError).length > 0;
  const pendingOps = buildOperationsFromPending();

  return (
    <div className="product-workspace">
      <header className="pw-header">
        <div>
          <h1 className="pw-title">Workspace</h1>
          <p className="pw-sub">
            {packLabel || industrySlug} —             I build this list from your files on disk only. I’ll save your edits when you tap Update.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", flexShrink: 0 }}>
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Back
          </button>
        </div>
      </header>

      {toast ? (
        <div className={toast.kind === "ok" ? "pw-toast pw-toast--ok" : "pw-toast pw-toast--err"} role="status">
          {toast.text}
        </div>
      ) : null}

      <section className="pw-toolbar card">
        <div className="pw-mode">
          <span className="pw-label">Mode</span>
          <label>
            <input
              type="radio"
              name="ws-mode"
              checked={mode === "simulation"}
              onChange={() => setMode("simulation")}
            />
            Practice (simulation)
          </label>
          <label>
            <input type="radio" name="ws-mode" checked={mode === "live"} onChange={() => setMode("live")} />
            Live
          </label>
        </div>
        <div className="pw-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void loadScan()}>
            Refresh list
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || !needsReconcile}
            title={
              needsReconcile
                ? "I’ll link new files to my records and refresh the list—no file moves."
                : "Nothing new to link right now."
            }
            onClick={() => void handleSync([])}
          >
            Reconcile metadata
          </button>
          <label className={mode === "live" ? "pw-ingest pw-ingest--disabled" : "pw-ingest"} title={mode === "live" ? "Switch to practice mode to copy files in, or add files under your live folder on disk." : undefined}>
            <span className="btn btn-secondary">Copy into practice workspace</span>
            <input
              type="file"
              multiple
              accept="image/*,.png,.jpg,.jpeg,.webp,.pdf"
              hidden
              disabled={mode === "live" || busy}
              onChange={(e) => void handleIngest(e)}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void handleSync(buildOperationsFromPending())}
          >
            Update
          </button>
        </div>
      </section>

      <p className="pw-mode-callout" role="status">
        {mode === "simulation" ? (
          <>
            <strong>Practice mode.</strong> I only copy into your practice workspace under this app—I'll never modify
            the original files you pick from your computer.
          </>
        ) : (
          <>
            <strong>Live mode.</strong> I read and apply changes directly in your live workspace folder on disk. After
            you change files elsewhere, tap Refresh so I see the latest list.
          </>
        )}
      </p>

      {needsReconcile ? (
        <p className="pw-hint card">
          Some files aren’t linked to my records yet. Tap <strong>Reconcile metadata</strong> so I can recognize them
          (no file moves).
        </p>
      ) : null}

      {hasRowErrors ? (
        <div className="pw-retry-bar card">
          <p>
            I couldn’t apply one or more changes—see the notes under the highlighted rows. Fix them, then tap{" "}
            <strong>Update</strong> again. I’ll retry the same edits you already started—nothing gets applied twice.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || pendingOps.length === 0}
            onClick={() => void handleSync(pendingOps)}
          >
            Try Update again
          </button>
        </div>
      ) : null}

      <section className="pw-table-wrap card">
        <h2 className="pw-h2">Product list (from disk)</h2>
        {items.length === 0 ? (
          <p className="pw-muted">No files yet under inbox/ or output/. Copy files in practice mode or add folders.</p>
        ) : (
          <table className="pw-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Category</th>
                <th>Rename to</th>
                <th>Move to</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const pathKey = it.relPath;
                const refKey = it.id || it.relPath;
                const pe = pending[pathKey] ?? {};
                const err = it.id ? rowError[it.id] : undefined;
                return (
                  <tr key={it.relPath} className={err ? "pw-row--err" : ""} title={err || undefined}>
                    <td className="mono">
                      <div>{it.basename}</div>
                      <div className="pw-muted small">{it.relPath}</div>
                      {!it.id ? <span className="pw-badge">needs reconcile</span> : null}
                    </td>
                    <td>{it.category ?? "—"}</td>
                    <td>
                      <div>
                        <input
                          ref={(el) => {
                            if (it.id) renameFieldRefs.current[it.id] = el;
                            renameFieldRefs.current[refKey] = el;
                          }}
                          className="pw-input"
                          disabled={!it.id}
                          placeholder={it.basename}
                          value={pe.rename ?? ""}
                          onChange={(e) =>
                            setPending((p) => ({
                              ...p,
                              [pathKey]: { ...p[pathKey], rename: e.target.value },
                            }))
                          }
                        />
                        {err ? <p className="pw-inline-hint">{err}</p> : null}
                      </div>
                    </td>
                    <td>
                      <select
                        ref={(el) => {
                          if (it.id) moveFieldRefs.current[it.id] = el;
                        }}
                        className="pw-input"
                        disabled={!it.id}
                        value={pe.moveCategory ?? it.category ?? ""}
                        onChange={(e) => {
                          const newCat = e.target.value;
                          const origCat = it.category ?? "";
                          const prevEffective = pe.moveCategory ?? origCat;
                          setPending((p) => ({
                            ...p,
                            [pathKey]: { ...p[pathKey], moveCategory: newCat },
                          }));
                          if (!it.id || !newCat || newCat === prevEffective || !origCat) return;
                          const peerPaths = items
                            .filter(
                              (x) =>
                                x.id &&
                                x.relPath !== pathKey &&
                                (x.category ?? "") === origCat &&
                                ((pending[x.relPath]?.moveCategory ?? x.category ?? "") === origCat),
                            )
                            .map((x) => x.relPath);
                          if (peerPaths.length === 0) return;
                          const ok = window.confirm(
                            `Apply this category to ${peerPaths.length} other item(s) in the same category (${origCat})?`,
                          );
                          if (!ok) return;
                          setPending((p) => {
                            const next = { ...p };
                            for (const rp of peerPaths) {
                              next[rp] = { ...next[rp], moveCategory: newCat };
                            }
                            return next;
                          });
                        }}
                      >
                        <option value="">—</option>
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        ref={(el) => {
                          if (it.id) noteFieldRefs.current[it.id] = el;
                        }}
                        className="pw-input"
                        disabled={!it.id}
                        placeholder="Optional"
                        value={pe.note ?? String(it.attributes?.note ?? "")}
                        onChange={(e) =>
                          setPending((p) => ({
                            ...p,
                            [pathKey]: { ...p[pathKey], note: e.target.value },
                          }))
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="pw-footer card">
        <p className="pw-muted">
          After you save changes with Update, I refresh what automations are allowed to read. I never move files from
          this button.{" "}
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={async () => {
              try {
                const g = await workspaceGeneratorSnapshot({ industry: industrySlug, mode, accountId: "local" });
                if (g?.ok) {
                  const paths =
                    g.paths && typeof g.paths === "object" && !Array.isArray(g.paths)
                      ? /** @type {Record<string, string>} */ (g.paths)
                      : {};
                  setReadModelDetail({
                    generation: g.syncGeneration ?? "—",
                    paths,
                  });
                  if (import.meta.env.DEV) {
                    console.log("Read model (dev only)", g);
                  }
                  setToast({
                    kind: "ok",
                    text: "I’m current after your last Update. Open Details below only if you need exact file locations.",
                  });
                } else {
                  setReadModelDetail(null);
                  setToast({
                    kind: "err",
                    text:
                      typeof g?.error === "string"
                        ? g.error
                        : "I couldn’t load the read model—run Update or Reconcile first, then try again.",
                  });
                }
              } catch (e) {
                setReadModelDetail(null);
                const m = e instanceof Error ? e.message : String(e);
                setToast({
                  kind: "err",
                  text: m.startsWith("I ") ? m : `I couldn’t load the read model. ${m}`,
                });
              }
            }}
          >
            Preview read model
          </button>
        </p>
        {readModelDetail ? (
          <details
            className="pw-readmodel-details"
            onToggle={(e) => {
              if (import.meta.env.DEV && e.currentTarget.open) {
                console.log("Read model paths (dev only)", readModelDetail.paths);
              }
            }}
          >
            <summary className="pw-readmodel-summary">Details</summary>
            <div className="pw-readmodel-detail-body">
              <p className="pw-muted small">
                Here’s what I’m using after your last successful Update. You opened this on purpose—it isn’t needed for
                day-to-day use.
              </p>
              <p className="pw-muted small">
                Count after last Update: <span className="mono">{String(readModelDetail.generation)}</span>
              </p>
              {Object.keys(readModelDetail.paths).length === 0 ? (
                <p className="pw-muted small">I don’t have file locations to show right now.</p>
              ) : (
                <ul className="pw-readmodel-path-list">
                  {Object.entries(readModelDetail.paths).map(([label, path]) => (
                    <li key={label}>
                      <span className="pw-readmodel-path-label">{friendlyReadModelPathLabel(label)}</span>
                      <code className="pw-readmodel-path">{path}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}

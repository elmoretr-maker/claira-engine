import { useCallback, useEffect, useRef, useState } from "react";
import "./CatalogBuilderScreen.css";

// ── Helpers ───────────────────────────────────────────────────────────────────

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(/** @type {string} */ (e.target?.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function looksLikeHtml(text) {
  const t = text.trimStart();
  return t.startsWith("<!DOCTYPE") || t.startsWith("<html") || t.startsWith("<HTML");
}

/** Convert a product name to a safe folder slug. */
function toFolderSlug(name) {
  return (name ?? "product")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "product";
}

/**
 * Normalise a raw product from the API response into an editable shape.
 * @param {Record<string, any>} p
 * @param {number} i
 */
function normaliseProduct(p, i) {
  const name = p.metadata?.suggestedTitle ?? p.name ?? `Product ${i + 1}`;
  return {
    id:           p.id ?? String(i),
    name,
    originalName: name,
    images:       Array.isArray(p.images) ? p.images : [],
    tags:         Array.isArray(p.metadata?.tags) ? p.metadata.tags : [],
  };
}

// ── Image thumbnail tile ──────────────────────────────────────────────────────

/**
 * @param {{ src: string, name: string, onRemove: () => void }} props
 */
function ImageTile({ src, name, onRemove }) {
  return (
    <div className="catalog-tile">
      <img className="catalog-tile__img" src={src} alt={name} />
      <span className="catalog-tile__name" title={name}>{name}</span>
      <button type="button" className="catalog-tile__remove" onClick={onRemove} aria-label="Remove image">
        ✕
      </button>
    </div>
  );
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

/**
 * @param {{ id: string, label: string, checked: boolean, onChange: (v: boolean) => void, hint?: string }} props
 */
function Toggle({ id, label, checked, onChange, hint }) {
  return (
    <label className="catalog-toggle" htmlFor={id}>
      <span className="catalog-toggle__track" aria-hidden="true">
        <span className={`catalog-toggle__thumb ${checked ? "catalog-toggle__thumb--on" : ""}`} />
      </span>
      <input
        id={id}
        type="checkbox"
        className="catalog-toggle__input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="catalog-toggle__label">
        {label}
        {hint ? <span className="catalog-toggle__hint">{hint}</span> : null}
      </span>
    </label>
  );
}

// ── Editable product card ─────────────────────────────────────────────────────

/**
 * @param {{
 *   product: { id: string, name: string, originalName: string, images: string[], tags: string[] },
 *   index: number,
 *   onNameChange: (index: number, name: string) => void,
 * }} props
 */
function ProductCard({ product, index, onNameChange }) {
  const nameChanged = product.name !== product.originalName;

  return (
    <li className="catalog-result__product">
      <div className="catalog-result__product-head">
        <div className="catalog-result__name-row">
          <input
            type="text"
            className={`catalog-result__name-input ${nameChanged ? "catalog-result__name-input--edited" : ""}`}
            value={product.name}
            onChange={(e) => onNameChange(index, e.target.value)}
            aria-label={`Product ${index + 1} name`}
          />
          {nameChanged ? (
            <button
              type="button"
              className="catalog-result__name-reset"
              title="Reset to AI-generated name"
              onClick={() => onNameChange(index, product.originalName)}
            >
              ↩
            </button>
          ) : null}
        </div>
        {product.tags.length > 0 ? (
          <ul className="catalog-result__tags">
            {product.tags.slice(0, 6).map((tag) => (
              <li key={tag} className="catalog-result__tag">{tag}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {product.images.length > 0 ? (
        <div className="catalog-result__product-images">
          {product.images.slice(0, 6).map((src, idx) => (
            <img
              key={idx}
              className="catalog-result__product-thumb"
              src={src}
              alt={`${product.name} image ${idx + 1}`}
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          ))}
          {product.images.length > 6 ? (
            <span className="catalog-result__product-more">+{product.images.length - 6}</span>
          ) : null}
        </div>
      ) : null}

      <div className="catalog-result__folder-preview-row">
        <span className="catalog-result__folder-preview-label">Folder:</span>
        <code className="catalog-result__folder-preview-slug">
          {toFolderSlug(product.name)}/
        </code>
      </div>
    </li>
  );
}

// ── Result display ────────────────────────────────────────────────────────────

/**
 * @param {{
 *   summary: Record<string, any>,
 *   editedProducts: Array<{ id: string, name: string, originalName: string, images: string[], tags: string[] }>,
 *   onNameChange: (index: number, name: string) => void,
 *   fileStructure: Record<string, any> | null,
 *   createFolders: boolean,
 * }} props
 */
function CatalogResult({ summary, editedProducts, onNameChange, fileStructure, createFolders }) {
  const fs = fileStructure;
  const foldersOnDisk = Array.isArray(fs?.foldersCreated) && fs.foldersCreated.length > 0;
  const anyEdited = editedProducts.some((p) => p.name !== p.originalName);

  return (
    <div className="catalog-result">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="catalog-result__header">
        <h2 className="catalog-result__heading">Catalog built</h2>
        <div className="catalog-result__summary">
          <span className="catalog-result__stat">
            {summary.totalProducts ?? editedProducts.length} products
          </span>
          <span className="catalog-result__sep">·</span>
          <span className="catalog-result__stat">{summary.totalImages ?? "—"} images</span>
          {foldersOnDisk ? (
            <>
              <span className="catalog-result__sep">·</span>
              <span className="catalog-result__stat">{fs.foldersCreated.length} folders written</span>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Review label ──────────────────────────────────────────────────── */}
      <div className="catalog-result__review-banner">
        <span className="catalog-result__review-icon">✏️</span>
        <span className="catalog-result__review-text">
          Review and edit product names before finalizing
          {anyEdited ? (
            <span className="catalog-result__review-edited"> · {editedProducts.filter((p) => p.name !== p.originalName).length} edited</span>
          ) : null}
        </span>
      </div>

      {/* ── Product list ──────────────────────────────────────────────────── */}
      {editedProducts.length === 0 ? (
        <p className="catalog-result__empty">No products could be grouped from the provided images.</p>
      ) : (
        <ul className="catalog-result__products">
          {editedProducts.map((product, i) => (
            <ProductCard
              key={product.id}
              product={product}
              index={i}
              onNameChange={onNameChange}
            />
          ))}
        </ul>
      )}

      {/* ── Folder output / preview ────────────────────────────────────────── */}
      <div className="catalog-result__fileout">
        <h3 className="catalog-result__fileout-heading">
          {foldersOnDisk ? "Folders written to disk" : createFolders ? "Folder structure" : "Folder preview"}
          {!foldersOnDisk && !createFolders ? (
            <span className="catalog-result__fileout-hint">
              {" "}— enable "Create organized folders" to write these
            </span>
          ) : null}
        </h3>

        {foldersOnDisk ? (
          <>
            {fs.rootPath ? (
              <p className="catalog-result__fileout-path">
                <span className="catalog-result__fileout-label">Root:</span>
                <code className="catalog-result__fileout-code">{fs.rootPath}</code>
              </p>
            ) : null}
            <ul className="catalog-result__folders">
              {fs.foldersCreated.map((f) => (
                <li key={f} className="catalog-result__folder">
                  <code>{f}</code>
                </li>
              ))}
            </ul>
            {anyEdited ? (
              <p className="catalog-result__fileout-note">
                ⓘ Edited names were applied to these folders. Rebuild to rename with new edits.
              </p>
            ) : null}
          </>
        ) : (
          <ul className="catalog-result__folders catalog-result__folders--preview">
            {editedProducts.map((p) => (
              <li key={p.id} className="catalog-result__folder catalog-result__folder--preview">
                <code>
                  products/<strong>{toFolderSlug(p.name)}/</strong>
                </code>
                {p.name !== p.originalName ? (
                  <span className="catalog-result__folder-edited-badge">edited</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

/**
 * @param {{ onBack: () => void, initialResult?: Record<string,any> | null }} props
 */
export default function CatalogBuilderScreen({ onBack, initialResult }) {
  /** @type {import("react").RefObject<HTMLInputElement | null>} */
  const fileInputRef = useRef(null);

  const [fileItems, setFileItems] = useState(
    /** @type {Array<{ file: File, preview: string }>} */ ([]),
  );
  const [urlInput, setUrlInput] = useState("");
  const [useAiGrouping, setUseAiGrouping] = useState(true);
  const [createFolders, setCreateFolders] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  // Raw API response (kept for summary / fileStructure)
  const [rawResult, setRawResult] = useState(/** @type {Record<string, any> | null} */ (null));

  // Editable product list — initialised from rawResult, then kept in local state
  const [editedProducts, setEditedProducts] = useState(
    /** @type {Array<{ id: string, name: string, originalName: string, images: string[], tags: string[] }>} */ ([]),
  );

  const [error, setError] = useState(/** @type {string | null} */ (null));

  // Revoke object URLs on unmount
  useEffect(() => {
    return () => fileItems.forEach((fi) => URL.revokeObjectURL(fi.preview));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If launched from Photo Sorter with a pre-built catalog result, bypass the
  // upload form and populate state directly. Runs once on mount only.
  useEffect(() => {
    if (!initialResult) return;
    setRawResult(initialResult);
    const products = Array.isArray(initialResult.products)
      ? initialResult.products.map(normaliseProduct)
      : [];
    setEditedProducts(products);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback((fileList) => {
    const accepted = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (accepted.length === 0) return;
    setFileItems((prev) => [...prev, ...accepted.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  }, []);

  const removeFile = useCallback((index) => {
    setFileItems((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // ── Drag & drop ─────────────────────────────────────────────────────────────
  const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  // ── Name editing (client-side only, no backend call) ────────────────────────
  const handleNameChange = useCallback((index, newName) => {
    setEditedProducts((prev) =>
      prev.map((p, i) => (i === index ? { ...p, name: newName } : p)),
    );
  }, []);

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const urls = urlInput.split("\n").map((u) => u.trim()).filter(Boolean);

    if (fileItems.length === 0 && urls.length === 0) {
      setError("Add at least one image — drag & drop files or paste image URLs.");
      return;
    }

    setLoading(true);
    setError(null);
    setRawResult(null);
    // Keep editedProducts alive during rebuild so the user's edits are visible
    // in the UI; they are also forwarded to the backend in the request body.

    try {
      const imageFiles = await Promise.all(
        fileItems.map(async ({ file }) => ({
          data: await readFileAsDataUrl(file),
          name: file.name,
        })),
      );

      // Forward any user-edited names so the backend can apply them to folder
      // output. Only send entries where the name actually differs from the
      // original (saves bandwidth; backend ignores unchanged entries anyway).
      const editPayload = editedProducts
        .filter((p) => p.name !== p.originalName && p.name.trim())
        .map(({ id, name }) => ({ id, name }));

      const r = await fetch("/__claira/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "buildProductCatalog",
          images: urls,
          imageFiles,
          useVision: useAiGrouping,
          outputMode: createFolders ? "files" : null,
          ...(editPayload.length > 0 ? { editedProducts: editPayload } : {}),
        }),
      });

      const text = await r.text();

      if (looksLikeHtml(text)) {
        throw new Error("API server unavailable. Run `npm run start:server` and try again.");
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Unexpected response from server (HTTP ${r.status})`);
      }

      if (!r.ok) throw new Error(typeof data?.error === "string" ? data.error : `HTTP ${r.status}`);

      setRawResult(data);
      // Initialise the editable product list from the API response.
      // If the backend already applied edits, those names become the new
      // baseline (originalName = the name returned by the server after edits).
      const initialProducts = Array.isArray(data.products)
        ? data.products.map(normaliseProduct)
        : [];
      setEditedProducts(initialProducts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [fileItems, urlInput, useAiGrouping, createFolders]);

  const hasInput = fileItems.length > 0 || urlInput.trim().length > 0;
  const hasResult = rawResult !== null && editedProducts.length >= 0;

  return (
    <div className="catalog-builder">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="catalog-builder__header">
        <button type="button" className="catalog-builder__back btn btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <div className="catalog-builder__title-group">
          <span className="catalog-builder__icon">🗂</span>
          <h1 className="catalog-builder__title">Build Product Catalog</h1>
        </div>
        <p className="catalog-builder__subtitle">
          Turn product images into structured, store-ready catalog data grouped by product.
        </p>
      </header>

      <div className="catalog-builder__body">
        {/* ── Drop zone ───────────────────────────────────────────────────── */}
        <section className="catalog-section">
          <h2 className="catalog-section__heading">Images</h2>

          <div
            className={`catalog-dropzone ${dragging ? "catalog-dropzone--over" : ""}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
            aria-label="Drop images here or click to browse"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="catalog-dropzone__input"
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
            />
            {fileItems.length === 0 ? (
              <div className="catalog-dropzone__prompt">
                <span className="catalog-dropzone__prompt-icon">📂</span>
                <span className="catalog-dropzone__prompt-text">Drop images here</span>
                <span className="catalog-dropzone__prompt-sub">or click to browse · PNG, JPG, WebP</span>
              </div>
            ) : (
              <div
                className="catalog-dropzone__tiles"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="presentation"
              >
                {fileItems.map(({ preview, file }, i) => (
                  <ImageTile key={preview} src={preview} name={file.name} onRemove={() => removeFile(i)} />
                ))}
                <button
                  type="button"
                  className="catalog-tile catalog-tile--add"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                >
                  <span className="catalog-tile__add-icon">+</span>
                  <span className="catalog-tile__add-label">Add more</span>
                </button>
              </div>
            )}
          </div>

          {/* ── URL input ─────────────────────────────────────────────────── */}
          <div className="catalog-url-block">
            <label className="catalog-label" htmlFor="catalog-urls">
              Image URLs <span className="catalog-label__opt">(optional — one per line)</span>
            </label>
            <textarea
              id="catalog-urls"
              className="catalog-textarea"
              rows={4}
              placeholder={"https://cdn.example.com/product-a-1.jpg\nhttps://cdn.example.com/product-a-2.jpg"}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
            />
          </div>
        </section>

        {/* ── Options ─────────────────────────────────────────────────────── */}
        <section className="catalog-section">
          <h2 className="catalog-section__heading">Options</h2>
          <div className="catalog-options">
            <Toggle
              id="catalog-opt-ai"
              label="Use AI grouping"
              checked={useAiGrouping}
              onChange={setUseAiGrouping}
              hint="Groups similar images using CLIP vision analysis"
            />
            <Toggle
              id="catalog-opt-folders"
              label="Create organized folders"
              checked={createFolders}
              onChange={setCreateFolders}
              hint={
                createFolders
                  ? "Folders will be written to the server output path on Build"
                  : "Enable to write structured product folders to disk"
              }
            />
          </div>
        </section>

        {/* ── Submit ──────────────────────────────────────────────────────── */}
        <div className="catalog-submit">
          <button
            type="button"
            className="btn btn-primary catalog-submit__btn"
            disabled={loading || !hasInput}
            onClick={() => void handleSubmit()}
          >
            {loading ? <span className="catalog-submit__spinner" aria-hidden="true" /> : null}
            {loading ? "Building catalog…" : hasResult ? "Rebuild Catalog" : "Build Catalog"}
          </button>
          {!hasInput ? (
            <p className="catalog-submit__hint">Add images above to get started</p>
          ) : null}
        </div>

        {/* ── Error ───────────────────────────────────────────────────────── */}
        {error ? (
          <div className="catalog-error" role="alert">
            <span className="catalog-error__icon">⚠</span>
            <span className="catalog-error__msg">{error}</span>
          </div>
        ) : null}

        {/* ── Result (editable) ────────────────────────────────────────────── */}
        {hasResult && rawResult ? (
          <CatalogResult
            summary={rawResult.summary ?? {}}
            editedProducts={editedProducts}
            onNameChange={handleNameChange}
            fileStructure={rawResult.fileStructure ?? null}
            createFolders={createFolders}
          />
        ) : null}
      </div>
    </div>
  );
}

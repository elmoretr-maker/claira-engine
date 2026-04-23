import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./PhotoSorterScreen.css";

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

function scoreTier(score) {
  if (score >= 0.65) return "best";
  if (score >= 0.35) return "good";
  return "poor";
}

function fmtResolution(w, h) {
  if (!w || !h) return null;
  const mp = (w * h) / 1_000_000;
  return mp >= 0.1 ? `${mp.toFixed(1)} MP · ${w}×${h}` : `${w}×${h}`;
}

/** Extract the tag array from a photo object (handles both field names). */
function getTags(photo) {
  return Array.isArray(photo.tags) ? photo.tags : (Array.isArray(photo.labels) ? photo.labels : []);
}

// ── Tag state machine ─────────────────────────────────────────────────────────
//
// tagState: Map<string, "include" | "exclude">
//
// Clicking a tag cycles:  neutral → include → exclude → neutral
//   • neutral  — no filter applied for this tag
//   • include  — photo MUST have this tag (respect filterMode for multi-include)
//   • exclude  — photo MUST NOT have this tag (always AND-excluded)

/** @param {Map<string,"include"|"exclude">} tagState */
function cycleTag(tagState, tag) {
  const next = new Map(tagState);
  const cur = next.get(tag);
  if (cur === undefined)  next.set(tag, "include");
  else if (cur === "include") next.set(tag, "exclude");
  else next.delete(tag);
  return next;
}

/** @param {Map<string,"include"|"exclude">} tagState */
function getIncluded(tagState) {
  return new Set([...tagState].filter(([, v]) => v === "include").map(([k]) => k));
}

/** @param {Map<string,"include"|"exclude">} tagState */
function getExcluded(tagState) {
  return new Set([...tagState].filter(([, v]) => v === "exclude").map(([k]) => k));
}

// ── Upload tile ───────────────────────────────────────────────────────────────

function UploadTile({ src, name, onRemove }) {
  return (
    <div className="ps-tile">
      <img className="ps-tile__img" src={src} alt={name} />
      <span className="ps-tile__name" title={name}>{name}</span>
      <button type="button" className="ps-tile__remove" onClick={onRemove} aria-label="Remove">✕</button>
    </div>
  );
}

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score }) {
  const tier = scoreTier(score);
  return (
    <div className="ps-score-bar" title={`Score: ${Math.round(score * 100)}/100`}>
      <div className={`ps-score-fill ps-score-fill--${tier}`} style={{ width: `${Math.round(score * 100)}%` }} />
    </div>
  );
}

// ── Tag chip ──────────────────────────────────────────────────────────────────

const TAG_WARN = new Set(["blurry", "low-res"]);

/**
 * @param {{
 *   tag: string,
 *   tagStateEntry?: "include" | "exclude" | undefined,
 *   count?: number,
 *   onClick?: () => void,
 *   variant?: "filter" | "card",
 * }} props
 */
function TagChip({ tag, tagStateEntry, count, onClick, variant = "card" }) {
  const isWarn = TAG_WARN.has(tag);
  const stateClass = tagStateEntry === "include" ? "ps-tag--include"
    : tagStateEntry === "exclude" ? "ps-tag--exclude"
    : "";
  const baseColour = tagStateEntry === "exclude" ? "ps-tag--warn"
    : isWarn && !tagStateEntry ? "ps-tag--warn"
    : "ps-tag--info";

  return (
    <button
      type="button"
      className={["ps-tag", `ps-tag--${variant}`, baseColour, stateClass, onClick ? "ps-tag--clickable" : ""]
        .filter(Boolean).join(" ")}
      onClick={onClick}
      title={
        tagStateEntry === "include" ? "Click to exclude (−)"
        : tagStateEntry === "exclude" ? "Click to clear"
        : "Click to include (+)"
      }
    >
      {tagStateEntry === "include" ? <span className="ps-tag__prefix">+</span>
       : tagStateEntry === "exclude" ? <span className="ps-tag__prefix">−</span>
       : null}
      {tag}
      {count != null ? <span className="ps-tag__count">{count}</span> : null}
    </button>
  );
}

// ── Mode toggle ───────────────────────────────────────────────────────────────

/**
 * @param {{ mode: "any"|"all", onChange: (m:"any"|"all") => void, disabled?: boolean }} props
 */
function ModeToggle({ mode, onChange, disabled }) {
  return (
    <div className="ps-mode-toggle" title="Controls how multiple included tags are combined">
      <span className="ps-mode-toggle__label">Mode:</span>
      <button
        type="button"
        className={`ps-mode-btn ${mode === "any" ? "ps-mode-btn--active" : ""}`}
        onClick={() => onChange("any")}
        disabled={disabled}
      >
        Match ANY
      </button>
      <button
        type="button"
        className={`ps-mode-btn ${mode === "all" ? "ps-mode-btn--active" : ""}`}
        onClick={() => onChange("all")}
        disabled={disabled}
      >
        Match ALL
      </button>
    </div>
  );
}

// ── Sort bar ──────────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { key: "score",      label: "Score" },
  { key: "sharpness",  label: "Sharpness" },
  { key: "resolution", label: "Resolution" },
];

/**
 * @param {{ sortBy: string, onChange: (k: string) => void }} props
 */
function SortBar({ sortBy, onChange }) {
  return (
    <div className="ps-sort-bar">
      <span className="ps-sort-bar__label">Sort:</span>
      {SORT_OPTIONS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          className={`ps-sort-btn ${sortBy === key ? "ps-sort-btn--active" : ""}`}
          onClick={() => onChange(key)}
        >
          {label}
          {sortBy === key ? <span className="ps-sort-btn__arrow"> ↓</span> : null}
        </button>
      ))}
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   allTags: string[],
 *   tagCounts: Map<string, number>,
 *   tagState: Map<string, "include"|"exclude">,
 *   filterMode: "any"|"all",
 *   onCycleTag: (tag: string) => void,
 *   onSetMode: (m: "any"|"all") => void,
 *   onClearAll: () => void,
 * }} props
 */
function FilterBar({ allTags, tagCounts, tagState, filterMode, onCycleTag, onSetMode, onClearAll }) {
  if (allTags.length === 0) return null;
  const included = getIncluded(tagState);
  const excluded = getExcluded(tagState);
  const hasFilter = tagState.size > 0;

  return (
    <div className="ps-filter-bar">
      <div className="ps-filter-bar__top-row">
        <span className="ps-filter-bar__label">Filter:</span>
        <ModeToggle mode={filterMode} onChange={onSetMode} disabled={included.size < 2} />
        {hasFilter ? (
          <button type="button" className="ps-filter-bar__clear" onClick={onClearAll}>
            Clear ({tagState.size})
          </button>
        ) : null}
      </div>

      <div className="ps-filter-bar__chips">
        <button
          type="button"
          className={`ps-filter-all ${!hasFilter ? "ps-filter-all--active" : ""}`}
          onClick={onClearAll}
        >
          All
        </button>
        {allTags.map((tag) => (
          <TagChip
            key={tag}
            tag={tag}
            tagStateEntry={tagState.get(tag)}
            count={tagCounts.get(tag) ?? 0}
            onClick={() => onCycleTag(tag)}
            variant="filter"
          />
        ))}
      </div>

      {/* Legend (shown whenever any tag is active) */}
      {hasFilter ? (
        <div className="ps-filter-bar__legend">
          {included.size > 0 ? (
            <span className="ps-filter-bar__legend-item ps-filter-bar__legend-item--include">
              <strong>+</strong> include {filterMode === "all" && included.size > 1 ? "(ALL required)" : "(ANY matches)"}
            </span>
          ) : null}
          {excluded.size > 0 ? (
            <span className="ps-filter-bar__legend-item ps-filter-bar__legend-item--exclude">
              <strong>−</strong> exclude (always hidden)
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Summary report ────────────────────────────────────────────────────────────

function SummaryReport({ results, tagCounts, allTags }) {
  const total    = results.length;
  const best     = results.filter((r) => r.score >= 0.65).length;
  const good     = results.filter((r) => r.score >= 0.35 && r.score < 0.65).length;
  const poor     = results.filter((r) => r.score < 0.35).length;
  const avgScore = total > 0
    ? Math.round((results.reduce((s, r) => s + r.score, 0) / total) * 100)
    : 0;

  return (
    <div className="ps-summary">
      <div className="ps-summary__row">
        {[
          { v: total, l: "Total photos" },
          { v: best,  l: "⭐ Best",  cls: "best" },
          { v: good,  l: "👍 Good",  cls: "good" },
          { v: poor,  l: "⚠ Poor",   cls: "poor" },
          { v: avgScore, l: "Avg score" },
        ].map(({ v, l, cls }) => (
          <div key={l} className="ps-summary__kpi">
            <span className={`ps-summary__kpi-value${cls ? ` ps-summary__kpi-value--${cls}` : ""}`}>{v}</span>
            <span className="ps-summary__kpi-label">{l}</span>
          </div>
        ))}
      </div>
      {allTags.length > 0 ? (
        <div className="ps-summary__tags-section">
          <h4 className="ps-summary__sub-heading">Tag distribution</h4>
          <ul className="ps-summary__tag-bars">
            {allTags.map((tag) => {
              const count = tagCounts.get(tag) ?? 0;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <li key={tag} className="ps-summary__tag-bar-row">
                  <span className="ps-summary__tag-bar-name">{tag}</span>
                  <div className="ps-summary__tag-bar-track">
                    <div
                      className={`ps-summary__tag-bar-fill ${TAG_WARN.has(tag) ? "ps-summary__tag-bar-fill--warn" : "ps-summary__tag-bar-fill--info"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="ps-summary__tag-bar-count">{count}/{total}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ── Photo card ────────────────────────────────────────────────────────────────

function PhotoCard({ photo, tagState, onCycleTag }) {
  const tier     = scoreTier(photo.score);
  const scoreInt = Math.round(photo.score * 100);
  const tags     = getTags(photo);
  const res      = fmtResolution(photo.quality?.width, photo.quality?.height);

  return (
    <div className={`ps-card ps-card--${tier}`}>
      <div className="ps-card__img-wrap">
        <img
          className="ps-card__img"
          src={photo.image}
          alt={`Photo ${photo.index + 1}`}
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
        <span className={`ps-card__badge ps-card__badge--${tier}`}>{scoreInt}</span>
      </div>
      <div className="ps-card__body">
        <ScoreBar score={photo.score} />
        <div className="ps-card__meta">
          {res ? <span className="ps-card__meta-item">📐 {res}</span> : null}
          {photo.quality?.sharpness != null ? (
            <span className="ps-card__meta-item">
              {photo.quality.sharpness >= 0.7 ? "🔍 Sharp"
               : photo.quality.sharpness <= 0.2 ? "💧 Blurry"
               : "🔍 Moderate"}
            </span>
          ) : null}
        </div>
        {tags.length > 0 ? (
          <div className="ps-card__tags">
            {tags.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                tagStateEntry={tagState.get(tag)}
                onClick={() => onCycleTag(tag)}
                variant="card"
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Group section ─────────────────────────────────────────────────────────────

const TIER_META = {
  best: { label: "Best", emoji: "⭐", hint: "score ≥ 65" },
  good: { label: "Good", emoji: "👍", hint: "score 35–64" },
  poor: { label: "Poor", emoji: "⚠",  hint: "score < 35" },
};

function PhotoGroup({ tier, photos, tagState, onCycleTag }) {
  const { label, emoji, hint } = TIER_META[tier];
  if (photos.length === 0) return null;
  return (
    <section className={`ps-group ps-group--${tier}`}>
      <div className="ps-group__header">
        <span className="ps-group__emoji">{emoji}</span>
        <h3 className="ps-group__title">{label}</h3>
        <span className="ps-group__count">{photos.length}</span>
        <span className="ps-group__hint">{hint}</span>
      </div>
      <div className="ps-group__grid">
        {photos.map((p) => (
          <PhotoCard key={p.index} photo={p} tagState={tagState} onCycleTag={onCycleTag} />
        ))}
      </div>
    </section>
  );
}

// ── Filter notice ─────────────────────────────────────────────────────────────

function FilterNotice({ filteredCount, totalCount, tagState, filterMode, onCycleTag, onClearAll }) {
  const included = getIncluded(tagState);
  const excluded = getExcluded(tagState);
  if (tagState.size === 0) return null;

  // Build query tokens in order: includes first, then excludes
  const tokens = [
    ...[...included].map((t) => ({ tag: t, state: /** @type {"include"} */ ("include") })),
    ...[...excluded].map((t) => ({ tag: t, state: /** @type {"exclude"} */ ("exclude") })),
  ];

  // Mode badge — only shown when there are 2+ included tags (otherwise mode is irrelevant)
  const showMode = included.size >= 2;

  return (
    <div className="ps-filter-notice">
      <span className="ps-filter-notice__label">Query:</span>
      <span className="ps-filter-notice__query">
        {tokens.map(({ tag, state }) => (
          <button
            key={tag}
            type="button"
            className={`ps-filter-notice__token ps-filter-notice__token--${state}`}
            onClick={() => onCycleTag(tag)}
            title="Click to cycle state"
          >
            <span className="ps-filter-notice__token-prefix">{state === "include" ? "+" : "−"}</span>
            {tag}
          </button>
        ))}
        {showMode && (
          <span className="ps-filter-notice__mode-badge">
            ({filterMode.toUpperCase()})
          </span>
        )}
      </span>
      <span className="ps-filter-notice__count">
        — <strong>{filteredCount}</strong> of {totalCount}
      </span>
      <button type="button" className="ps-filter-notice__clear" onClick={onClearAll}>Clear</button>
    </div>
  );
}

// ── Inline query tokens (reused in CatalogPreview and WorkflowLog) ───────────

/**
 * Render a serialised query snapshot as +include / −exclude tokens.
 * @param {{ entries: [string, string][], filterMode: string }} props
 */
function QueryTokens({ entries, filterMode }) {
  if (!entries || entries.length === 0) {
    return <span className="ps-catalog-preview__query-none">all photos (no filter)</span>;
  }
  const includedCount = entries.filter(([, s]) => s === "include").length;
  return (
    <span className="ps-query-tokens">
      {entries.map(([tag, state]) => (
        <span key={tag} className={`ps-filter-notice__token ps-filter-notice__token--${state}`}>
          <span className="ps-filter-notice__token-prefix">{state === "include" ? "+" : "−"}</span>
          {tag}
        </span>
      ))}
      {includedCount >= 2 && (
        <span className="ps-filter-notice__mode-badge">({filterMode.toUpperCase()})</span>
      )}
    </span>
  );
}

// ── Catalog preview (inline result after "Build Catalog") ─────────────────────

/**
 * Compact read-only display of a buildProductCatalog result.
 * @param {{
 *   data: Record<string,any>,
 *   query: { entries: [string,string][], filterMode: string, matchCount: number } | null,
 *   photoCount: number,
 *   catalogLoading: boolean,
 *   onRebuild: () => void,
 *   onOpenCatalog: (() => void) | null,
 *   onDismiss: () => void,
 * }} props
 */
function CatalogPreview({ data, query, photoCount, catalogLoading, onRebuild, onOpenCatalog, onDismiss }) {
  const products = data.products ?? [];
  const rootPath = data.fileStructure?.rootPath ?? null;
  const folders  = data.fileStructure?.foldersCreated ?? [];

  return (
    <div className="ps-catalog-preview">
      <div className="ps-catalog-preview__header">
        <div className="ps-catalog-preview__title-row">
          <span className="ps-catalog-preview__icon">🗂</span>
          <h3 className="ps-catalog-preview__title">
            Catalog built — {products.length} product{products.length !== 1 ? "s" : ""} from {photoCount} photo{photoCount !== 1 ? "s" : ""}
          </h3>
        </div>
        <button type="button" className="ps-catalog-preview__dismiss" onClick={onDismiss} aria-label="Dismiss">✕</button>
      </div>

      {/* Query traceability line */}
      <div className="ps-catalog-preview__query-line">
        <span className="ps-catalog-preview__query-label">From query:</span>
        <QueryTokens entries={query?.entries ?? []} filterMode={query?.filterMode ?? "any"} />
        {query?.matchCount != null && (
          <span className="ps-catalog-preview__query-count">· {query.matchCount} photo{query.matchCount !== 1 ? "s" : ""}</span>
        )}
      </div>

      {rootPath && (
        <p className="ps-catalog-preview__path">
          <span className="ps-catalog-preview__path-label">📁 Output:</span>
          <code className="ps-catalog-preview__path-value">{rootPath}</code>
          {folders.length > 0 && (
            <span className="ps-catalog-preview__path-count">({folders.length} folder{folders.length !== 1 ? "s" : ""})</span>
          )}
        </p>
      )}

      {products.length > 0 ? (
        <div className="ps-catalog-preview__grid">
          {products.map((p) => {
            const imgs = Array.isArray(p.images) ? p.images : [];
            const tags = p.metadata?.tags ?? [];
            return (
              <div key={p.id} className="ps-catalog-card">
                {imgs[0] ? (
                  <div className="ps-catalog-card__img-wrap">
                    <img
                      className="ps-catalog-card__img"
                      src={imgs[0]}
                      alt={p.name}
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                    {imgs.length > 1 && (
                      <span className="ps-catalog-card__img-count">+{imgs.length - 1}</span>
                    )}
                  </div>
                ) : (
                  <div className="ps-catalog-card__img-wrap ps-catalog-card__img-wrap--empty">
                    <span>🖼</span>
                  </div>
                )}
                <div className="ps-catalog-card__body">
                  <p className="ps-catalog-card__name">{p.name || p.metadata?.suggestedTitle || p.id}</p>
                  {tags.length > 0 && (
                    <div className="ps-catalog-card__tags">
                      {tags.slice(0, 4).map((t) => (
                        <span key={t} className="ps-catalog-card__tag">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="ps-catalog-preview__empty">No products returned. Try with more photos or enable AI grouping.</p>
      )}

      {/* Footer actions */}
      <div className="ps-catalog-preview__footer">
        <button
          type="button"
          className="ps-catalog-preview__footer-btn"
          onClick={onRebuild}
          disabled={catalogLoading}
        >
          {catalogLoading
            ? <><span className="ps-spinner ps-spinner--sm" aria-hidden="true" /> Rebuilding…</>
            : "↺ Rebuild with current filters"}
        </button>
        {onOpenCatalog && (
          <button
            type="button"
            className="ps-catalog-preview__footer-btn ps-catalog-preview__footer-btn--open"
            onClick={onOpenCatalog}
          >
            Open in Catalog Builder →
          </button>
        )}
      </div>
    </div>
  );
}

// ── Workflow log ──────────────────────────────────────────────────────────────

/**
 * @param {{
 *   log: any[],
 *   onReapply: (entry: any) => void,
 *   onRebuild: () => void,
 *   catalogLoading: boolean,
 *   pendingReapply: boolean,
 *   presetName: string,
 *   onPresetNameChange: (v: string) => void,
 * }} props
 */
function WorkflowLog({ log, onReapply, onRebuild, catalogLoading, pendingReapply, presetName, onPresetNameChange }) {
  const [copied, setCopied]     = useState(false);
  const copyTimerRef            = useRef(/** @type {ReturnType<typeof setTimeout>|null} */ (null));

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  function copyPreset() {
    const preset = {
      version: 1,
      name: presetName.trim() || "Untitled Preset",
      createdAt: new Date().toISOString(),
      steps: log,
    };
    navigator.clipboard.writeText(JSON.stringify(preset, null, 2)).catch(() => {});
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  }

  if (log.length === 0) return null;

  return (
    <details className="ps-workflow-log">
      <summary className="ps-workflow-log__summary">
        <span className="ps-workflow-log__title">Workflow</span>
        <span className="ps-workflow-log__count">{log.length} step{log.length !== 1 ? "s" : ""}</span>
      </summary>

      <ol className="ps-workflow-log__steps">
        {log.map((entry, i) => (
          <li key={i} className={`ps-workflow-log__step ps-workflow-log__step--${entry.type}`}>
            <span className="ps-workflow-log__step-text">
              {entry.type === "analyze" && (
                <>Analyzed <strong>{entry.count}</strong> photo{entry.count !== 1 ? "s" : ""}</>
              )}
              {entry.type === "filter" && (
                <>
                  Filtered →{" "}
                  <QueryTokens entries={entry.query.entries} filterMode={entry.query.filterMode} />
                  {" "}— <strong>{entry.matchCount}</strong> photo{entry.matchCount !== 1 ? "s" : ""}
                </>
              )}
              {entry.type === "catalog" && (
                <>
                  Built catalog — <strong>{entry.productCount}</strong> product{entry.productCount !== 1 ? "s" : ""}{" "}
                  from <strong>{entry.photoCount}</strong> photo{entry.photoCount !== 1 ? "s" : ""}
                </>
              )}
            </span>

            {entry.type === "filter" && (
              <button
                type="button"
                className="ps-workflow-log__action"
                onClick={() => onReapply(entry)}
                disabled={catalogLoading || pendingReapply}
              >
                Reapply
              </button>
            )}
            {entry.type === "catalog" && (
              <button
                type="button"
                className="ps-workflow-log__action"
                onClick={onRebuild}
                disabled={catalogLoading}
              >
                Rebuild
              </button>
            )}
          </li>
        ))}
      </ol>

      <div className="ps-workflow-log__preset-footer">
        <input
          type="text"
          className="ps-workflow-log__preset-name"
          placeholder="Preset name (optional)"
          value={presetName}
          onChange={(e) => onPresetNameChange(e.target.value)}
          aria-label="Preset name"
        />
        <button type="button" className="ps-workflow-log__copy-btn" onClick={copyPreset}>
          {copied ? "Copied! ✓" : "Copy preset"}
        </button>
      </div>
    </details>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function PhotoSorterScreen({ onBack, onOpenCatalog }) {
  const fileInputRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  // ── Upload ────────────────────────────────────────────────────────────────
  const [fileItems, setFileItems] = useState(/** @type {Array<{file:File,preview:string}>} */ ([]));
  const [urlInput,  setUrlInput]  = useState("");
  const [dragging,  setDragging]  = useState(false);

  // ── Analysis ──────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(/** @type {Record<string,any>|null} */ (null));
  const [error,   setError]   = useState(/** @type {string|null} */ (null));

  // ── Filter / sort / summary ────────────────────────────────────────────────
  /** @type {[Map<string,"include"|"exclude">, React.Dispatch<any>]} */
  const [tagState,    setTagState]    = useState(() => new Map());
  const [filterMode,  setFilterMode]  = useState(/** @type {"any"|"all"} */ ("any"));
  const [sortBy,      setSortBy]      = useState("score");
  const [showSummary, setShowSummary] = useState(false);

  // ── Catalog workflow state ─────────────────────────────────────────────────
  /**
   * Atomic build result — only written on success so result/query/photoCount
   * are always from the same run. null until first successful build.
   * @type {[{ result: Record<string,any>, query: { entries: [string,string][], filterMode: string, matchCount: number }, photoCount: number }|null, Function]}
   */
  const [catalogBuild,   setCatalogBuild]   = useState(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError,   setCatalogError]   = useState(/** @type {string|null} */ (null));

  // ── Workflow log & preset ──────────────────────────────────────────────────
  const [workflowLog,    setWorkflowLog]    = useState(/** @type {any[]} */ ([]));
  const [pendingReapply, setPendingReapply] = useState(false);
  const [presetName,     setPresetName]     = useState("");

  // Revoke object URLs on unmount
  useEffect(() => {
    return () => fileItems.forEach((fi) => URL.revokeObjectURL(fi.preview));
  }, []);

  // ── Derived tag data ───────────────────────────────────────────────────────

  const { allTags, tagCounts } = useMemo(() => {
    if (!result) return { allTags: [], tagCounts: new Map() };
    const counts = /** @type {Map<string,number>} */ (new Map());
    for (const photo of result.results ?? []) {
      for (const tag of getTags(photo)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    return { allTags: sorted, tagCounts: counts };
  }, [result]);

  // ── Filtering (AND/OR includes + always-AND excludes) ─────────────────────

  const filteredResults = useMemo(() => {
    const all = result?.results ?? [];
    if (tagState.size === 0) return all;

    const included = getIncluded(tagState);
    const excluded = getExcluded(tagState);

    return all.filter((p) => {
      const tags = getTags(p);
      // Exclusions always apply regardless of mode
      if (excluded.size > 0 && tags.some((t) => excluded.has(t))) return false;
      // Inclusions
      if (included.size === 0) return true;
      return filterMode === "all"
        ? [...included].every((t) => tags.includes(t))   // AND
        : tags.some((t) => included.has(t));              // OR
    });
  }, [result, tagState, filterMode]);

  // ── Sorting + grouping ─────────────────────────────────────────────────────

  const filteredGroups = useMemo(() => {
    const sortFn =
      sortBy === "sharpness"  ? (a, b) => (b.quality?.sharpness  ?? 0) - (a.quality?.sharpness  ?? 0) :
      sortBy === "resolution" ? (a, b) => (b.quality?.resolution ?? 0) - (a.quality?.resolution ?? 0) :
                                (a, b) => b.score - a.score;
    const sorted = [...filteredResults].sort(sortFn);
    return {
      best: sorted.filter((r) => r.score >= 0.65),
      good: sorted.filter((r) => r.score >= 0.35 && r.score < 0.65),
      poor: sorted.filter((r) => r.score < 0.35),
    };
  }, [filteredResults, sortBy]);

  // ── Tag cycling ───────────────────────────────────────────────────────────

  const handleCycleTag = useCallback((tag) => {
    setTagState((prev) => cycleTag(prev, tag));
  }, []);

  const handleClearTags = useCallback(() => {
    setTagState(new Map());
  }, []);

  // ── Reapply a filter step from the workflow log ────────────────────────────
  //
  // Sets tagState + filterMode, then flags pendingReapply. The useEffect below
  // fires after React has re-rendered (so filteredResults is up-to-date) and
  // passes the fresh image list explicitly to handleBuildCatalog, eliminating
  // the stale-closure race.

  const reapplyFilterStep = useCallback((entry) => {
    setTagState(new Map(entry.query.entries));
    setFilterMode(entry.query.filterMode);
    setPendingReapply(true);
  }, []);

  // ── Build catalog from filtered photos ────────────────────────────────────
  //
  // Accepts an optional `imagesOverride` so callers that have already resolved
  // the correct image list (e.g. the Reapply pendingEffect) can pass it in
  // explicitly, avoiding the stale-closure risk on `filteredResults`.

  const handleBuildCatalog = useCallback(async (imagesOverride) => {
    const images = imagesOverride ?? filteredResults.map((p) => p.image).filter(Boolean);
    if (!images.length) return;

    // Snapshot query before any async work so it's always in sync with this run
    const querySnapshot = {
      entries: Array.from(tagState.entries()),
      filterMode,
      matchCount: images.length,
    };

    // Record the filter step in the workflow log immediately (intent logging)
    setWorkflowLog((prev) => [
      ...prev,
      { type: "filter", timestamp: Date.now(), query: querySnapshot, matchCount: images.length },
    ]);

    setCatalogLoading(true);
    setCatalogError(null);
    // Do NOT clear catalogBuild here — old result stays visible until new one succeeds

    try {
      const r = await fetch("/__claira/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "buildProductCatalog",
          images,
          useVision: true,
          outputMode: "files",
        }),
      });
      const text = await r.text();
      if (looksLikeHtml(text)) throw new Error("API server unavailable. Run `npm run start:server`.");
      let data;
      try { data = JSON.parse(text); } catch {
        throw new Error(`Unexpected response (HTTP ${r.status})`);
      }
      if (!r.ok) throw new Error(typeof data?.error === "string" ? data.error : `HTTP ${r.status}`);

      // Write atomically on success only — result/query/photoCount always in sync
      setCatalogBuild({ result: data, query: querySnapshot, photoCount: images.length });

      // Record the catalog step
      const productCount = Array.isArray(data.products) ? data.products.length : 0;
      setWorkflowLog((prev) => [
        ...prev,
        { type: "catalog", timestamp: Date.now(), photoCount: images.length, productCount },
      ]);

      setTimeout(() => {
        document.querySelector(".ps-catalog-preview")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : String(e));
    } finally {
      setCatalogLoading(false);
    }
  }, [filteredResults, tagState, filterMode]);

  // Reapply: after tagState/filterMode update, run catalog build with fresh `filteredResults`
  // (must appear *after* `handleBuildCatalog` is defined — not in the TDZ).
  useEffect(() => {
    if (!pendingReapply) return;
    setPendingReapply(false);
    const images = filteredResults.map((p) => p.image).filter(Boolean);
    void handleBuildCatalog(images);
  }, [pendingReapply, filteredResults, handleBuildCatalog]);

  // ── Upload helpers ────────────────────────────────────────────────────────

  const addFiles = useCallback((fileList) => {
    const accepted = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!accepted.length) return;
    setFileItems((prev) => [...prev, ...accepted.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))]);
  }, []);

  const removeFile = useCallback((i) => {
    setFileItems((prev) => {
      URL.revokeObjectURL(prev[i].preview);
      return prev.filter((_, idx) => idx !== i);
    });
  }, []);

  const onDragOver  = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    const urls = urlInput.split("\n").map((u) => u.trim()).filter(Boolean);
    if (!fileItems.length && !urls.length) {
      setError("Add at least one photo — drag & drop files or paste image URLs.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setTagState(new Map());

    try {
      const imageFiles = await Promise.all(
        fileItems.map(async ({ file }) => ({ data: await readFileAsDataUrl(file), name: file.name })),
      );
      const r = await fetch("/__claira/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "analyzePhotos", images: urls, imageFiles }),
      });
      const text = await r.text();
      if (looksLikeHtml(text)) throw new Error("API server unavailable. Run `npm run start:server`.");
      let data;
      try { data = JSON.parse(text); } catch {
        throw new Error(`Unexpected response (HTTP ${r.status})`);
      }
      if (!r.ok) throw new Error(typeof data?.error === "string" ? data.error : `HTTP ${r.status}`);
      setResult(data);
      setShowSummary(true);
      setWorkflowLog((prev) => [
        ...prev,
        { type: "analyze", timestamp: Date.now(), count: (data.results ?? []).length },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [fileItems, urlInput]);

  const hasInput  = fileItems.length > 0 || urlInput.trim().length > 0;
  const hasResult = result !== null;

  return (
    <div className="ps-screen">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="ps-header">
        <button type="button" className="ps-back btn btn-ghost" onClick={onBack}>← Back</button>
        <div className="ps-header__title-row">
          <span className="ps-header__icon">📷</span>
          <h1 className="ps-header__title">Photo Sorter</h1>
        </div>
        <p className="ps-header__subtitle">
          Upload photos and instantly rank them by sharpness, resolution, and content quality.
        </p>
      </header>

      <div className="ps-body">
        {/* ── Drop zone ───────────────────────────────────────────────── */}
        <section className="ps-section">
          <h2 className="ps-section__heading">Photos</h2>
          <div
            className={`ps-dropzone ${dragging ? "ps-dropzone--over" : ""}`}
            onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
            aria-label="Drop photos here or click to browse"
          >
            <input ref={fileInputRef} type="file" multiple accept="image/*"
              className="ps-dropzone__input"
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
            />
            {fileItems.length === 0 ? (
              <div className="ps-dropzone__prompt">
                <span className="ps-dropzone__prompt-icon">📂</span>
                <span className="ps-dropzone__prompt-text">Drop photos here</span>
                <span className="ps-dropzone__prompt-sub">or click to browse · PNG, JPG, WebP</span>
              </div>
            ) : (
              <div className="ps-dropzone__tiles"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()} role="presentation">
                {fileItems.map(({ preview, file }, i) => (
                  <UploadTile key={preview} src={preview} name={file.name} onRemove={() => removeFile(i)} />
                ))}
                <button type="button" className="ps-tile ps-tile--add"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                  <span className="ps-tile__add-icon">+</span>
                  <span className="ps-tile__add-label">Add more</span>
                </button>
              </div>
            )}
          </div>

          <div className="ps-url-block">
            <label className="ps-label" htmlFor="ps-urls">
              Image URLs <span className="ps-label__opt">(optional — one per line)</span>
            </label>
            <textarea id="ps-urls" className="ps-textarea" rows={3}
              placeholder={"https://example.com/photo1.jpg\nhttps://example.com/photo2.jpg"}
              value={urlInput} onChange={(e) => setUrlInput(e.target.value)} />
          </div>
        </section>

        {/* ── Submit ──────────────────────────────────────────────────── */}
        <div className="ps-submit">
          <button type="button" className="btn btn-primary ps-submit__btn"
            disabled={loading || !hasInput} onClick={() => void handleAnalyze()}>
            {loading ? <span className="ps-spinner" aria-hidden="true" /> : null}
            {loading ? "Analyzing…" : hasResult ? "Re-analyze" : "Analyze Photos"}
          </button>
          {!hasInput ? <p className="ps-submit__hint">Add photos above to get started</p> : null}
        </div>

        {/* ── Error ───────────────────────────────────────────────────── */}
        {error ? (
          <div className="ps-error" role="alert">
            <span className="ps-error__icon">⚠</span><span>{error}</span>
          </div>
        ) : null}

        {/* ── Results ─────────────────────────────────────────────────── */}
        {hasResult && result ? (
          <div className="ps-results">

            {/* Top bar */}
            <div className="ps-results__top-bar">
              <div className="ps-results__stats">
                <h2 className="ps-results__heading">Results</h2>
                <span className="ps-results__stat">{result.summary?.total ?? 0} analyzed</span>
                {result.summary?.best > 0 &&
                  <span className="ps-results__stat ps-results__stat--best">⭐ {result.summary.best} best</span>}
                {result.summary?.good > 0 &&
                  <span className="ps-results__stat ps-results__stat--good">👍 {result.summary.good} good</span>}
                {result.summary?.poor > 0 &&
                  <span className="ps-results__stat ps-results__stat--poor">⚠ {result.summary.poor} poor</span>}
              </div>
              <button type="button"
                className={`ps-summary-toggle ${showSummary ? "ps-summary-toggle--open" : ""}`}
                onClick={() => setShowSummary((s) => !s)}>
                {showSummary ? "Hide report ↑" : "Summary report ↓"}
              </button>
            </div>

            {/* Summary report */}
            {showSummary &&
              <SummaryReport results={result.results ?? []} tagCounts={tagCounts} allTags={allTags} />}

            {/* Sort bar */}
            <SortBar sortBy={sortBy} onChange={setSortBy} />

            {/* Filter bar */}
            <FilterBar
              allTags={allTags}
              tagCounts={tagCounts}
              tagState={tagState}
              filterMode={filterMode}
              onCycleTag={handleCycleTag}
              onSetMode={setFilterMode}
              onClearAll={handleClearTags}
            />

            {/* Active filter notice */}
            <FilterNotice
              filteredCount={filteredResults.length}
              totalCount={result.results?.length ?? 0}
              tagState={tagState}
              filterMode={filterMode}
              onCycleTag={handleCycleTag}
              onClearAll={handleClearTags}
            />

            {/* ── Build catalog action bar ─────────────────────────────── */}
            {filteredResults.length > 0 && (
              <div className="ps-catalog-action">
                <div className="ps-catalog-action__info">
                  <span className="ps-catalog-action__icon">🗂</span>
                  <span className="ps-catalog-action__label">
                    {tagState.size > 0
                      ? `Use these ${filteredResults.length} filtered photo${filteredResults.length !== 1 ? "s" : ""}`
                      : `Use all ${filteredResults.length} photo${filteredResults.length !== 1 ? "s" : ""}`}
                  </span>
                </div>
                <button
                  type="button"
                  className="ps-catalog-action__btn"
                  disabled={catalogLoading || loading || filteredResults.length === 0}
                  onClick={() => void handleBuildCatalog()}
                >
                  {catalogLoading
                    ? <><span className="ps-spinner ps-spinner--sm" aria-hidden="true" /> Building catalog…</>
                    : <>→ Build Product Catalog</>}
                </button>
              </div>
            )}

            {/* Catalog error */}
            {catalogError && (
              <div className="ps-error" role="alert">
                <span className="ps-error__icon">⚠</span>
                <span>Catalog build failed: {catalogError}</span>
                <button type="button" className="ps-error__dismiss" onClick={() => setCatalogError(null)}>✕</button>
              </div>
            )}

            {/* Photo groups */}
            <PhotoGroup tier="best" photos={filteredGroups.best} tagState={tagState} onCycleTag={handleCycleTag} />
            <PhotoGroup tier="good" photos={filteredGroups.good} tagState={tagState} onCycleTag={handleCycleTag} />
            <PhotoGroup tier="poor" photos={filteredGroups.poor} tagState={tagState} onCycleTag={handleCycleTag} />

            {filteredResults.length === 0 && (
              <div className="ps-no-match">
                <span className="ps-no-match__icon">🔍</span>
                <p className="ps-no-match__text">
                  No photos match the current filters.
                  <button type="button" className="ps-no-match__clear" onClick={handleClearTags}>
                    Clear filters
                  </button>
                </p>
              </div>
            )}

            {/* ── Catalog preview ─────────────────────────────────────── */}
            {catalogBuild && (
              <CatalogPreview
                data={catalogBuild.result}
                query={catalogBuild.query}
                photoCount={catalogBuild.photoCount}
                catalogLoading={catalogLoading}
                onRebuild={() => void handleBuildCatalog()}
                onOpenCatalog={onOpenCatalog ? () => onOpenCatalog(catalogBuild.result) : null}
                onDismiss={() => { setCatalogBuild(null); setCatalogError(null); }}
              />
            )}

            {/* ── Workflow log ─────────────────────────────────────────── */}
            <WorkflowLog
              log={workflowLog}
              onReapply={reapplyFilterStep}
              onRebuild={() => void handleBuildCatalog()}
              catalogLoading={catalogLoading}
              pendingReapply={pendingReapply}
              presetName={presetName}
              onPresetNameChange={setPresetName}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { categoryTrackingSupport, getActiveReferenceAssets } from "../../interfaces/api.js";
import "./CategoryReferencePanel.css";

/**
 * @param {{
 *   categoryKey: string,
 *   categoryLabel: string,
 *   industrySlug?: string,
 *   progressTrackingEnabled?: boolean,
 *   onOpenProgressTracker?: (categoryKey: string) => void,
 * }} props
 */
export default function CategoryReferencePanel({
  categoryKey,
  categoryLabel,
  industrySlug = "",
  progressTrackingEnabled = false,
  onOpenProgressTracker,
}) {
  const [assets, setAssets] = useState(
    /** @type {null | { industry: string, images: string[], documents: string[] }} */ (null),
  );
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [catSupportsTrack, setCatSupportsTrack] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const key = String(categoryKey ?? "").trim();
    if (!key) {
      setAssets(null);
      setError(null);
      return;
    }
    void (async () => {
      setError(null);
      try {
        const a = await getActiveReferenceAssets(key, industrySlug || undefined);
        if (cancelled) return;
        const ind = typeof a?.industry === "string" ? a.industry : "";
        const images = Array.isArray(a?.images) ? a.images : [];
        const documents = Array.isArray(a?.documents) ? a.documents : [];
        setAssets({ industry: ind, images, documents });
      } catch (e) {
        if (!cancelled) {
          setAssets(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [categoryKey, industrySlug]);

  useEffect(() => {
    const slug = String(industrySlug ?? "").trim().toLowerCase();
    const ck = String(categoryKey ?? "").trim();
    if (!slug || !ck || !progressTrackingEnabled) {
      setCatSupportsTrack(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await categoryTrackingSupport({ industry: slug, categoryKey: ck });
        if (cancelled) return;
        setCatSupportsTrack(r?.supports === true);
      } catch {
        if (!cancelled) setCatSupportsTrack(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [categoryKey, industrySlug, progressTrackingEnabled]);

  const key = String(categoryKey ?? "").trim();
  if (!key) return null;

  const ind = assets?.industry ?? String(industrySlug ?? "").trim();
  const imgs = assets?.images ?? [];
  const docs = assets?.documents ?? [];
  const hasAny = imgs.length > 0 || docs.length > 0;

  /**
   * @param {"images" | "documents"} kind
   * @param {string} file
   */
  function assetUrl(kind, file) {
    const q = new URLSearchParams({
      industry: ind,
      category: key,
      kind,
      file,
    });
    return `/__claira/pack-asset?${q.toString()}`;
  }

  return (
    <section className="category-ref-panel" aria-labelledby={`ref-panel-${key}`}>
      <h3 id={`ref-panel-${key}`} className="category-ref-panel-title">
        Pack references — {categoryLabel}
      </h3>
      {progressTrackingEnabled && catSupportsTrack && typeof onOpenProgressTracker === "function" ? (
        <p className="category-ref-panel-track">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenProgressTracker(key)}>
            Track progress
          </button>
          <span className="category-ref-panel-track-hint"> Opens workspace progress tracking for this category.</span>
        </p>
      ) : null}
      {error ? (
        <p className="category-ref-panel-error" role="alert">
          {error}
        </p>
      ) : null}
      {!error && !hasAny ? (
        <p className="category-ref-panel-placeholder">
          No reference images or documents ship with this category in the pack yet. You can still add user references
          during setup.
        </p>
      ) : null}
      {!error && imgs.length > 0 ? (
        <div className="category-ref-panel-block">
          <p className="category-ref-panel-sub">Images ({imgs.length})</p>
          <ul className="category-ref-panel-thumbs">
            {imgs.slice(0, 12).map((name) => (
              <li key={name}>
                <a href={assetUrl("images", name)} target="_blank" rel="noreferrer" className="category-ref-thumb-link">
                  <img src={assetUrl("images", name)} alt="" className="category-ref-thumb" loading="lazy" />
                </a>
                <span className="category-ref-filename mono">{name}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!error && docs.length > 0 ? (
        <div className="category-ref-panel-block">
          <p className="category-ref-panel-sub">Documents ({docs.length})</p>
          <ul className="category-ref-panel-docs">
            {docs.slice(0, 8).map((name) => (
              <li key={name}>
                <a href={assetUrl("documents", name)} target="_blank" rel="noreferrer">
                  {name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

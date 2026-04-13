import { useCallback, useEffect, useState } from "react";
import { getIndustryFeatures } from "../clairaApiClient.js";
import { getIndustryFeatureState, setIndustryFeatureState } from "../userPrefs.js";
import "./IndustryFeaturePrompt.css";

/**
 * @param {{ industrySlug: string, industryDisplayLabel: string }} props
 */
export default function IndustryFeaturePrompt({ industrySlug, industryDisplayLabel }) {
  const [features, setFeatures] = useState(/** @type {Array<{ featureKey: string, title: string, description: string }>} */ ([]));
  const [pending, setPending] = useState(/** @type {{ featureKey: string, title: string, description: string } | null} */ (null));

  const resolveNext = useCallback(
    (list, slug) => {
      return list.find((f) => f?.featureKey && getIndustryFeatureState(slug, f.featureKey) == null) ?? null;
    },
    [],
  );

  useEffect(() => {
    const slug = String(industrySlug ?? "").trim();
    if (!slug) {
      setFeatures([]);
      setPending(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await getIndustryFeatures({ industry: slug });
        const list = Array.isArray(r?.features) ? r.features : [];
        if (cancelled) return;
        setFeatures(list);
        setPending(resolveNext(list, slug));
      } catch {
        if (!cancelled) {
          setFeatures([]);
          setPending(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [industrySlug, resolveNext]);

  const onEnable = () => {
    if (!pending || !industrySlug) return;
    setIndustryFeatureState(industrySlug, pending.featureKey, "enabled");
    setPending(resolveNext(features, industrySlug));
  };

  const onDismiss = () => {
    if (!pending || !industrySlug) return;
    setIndustryFeatureState(industrySlug, pending.featureKey, "dismissed");
    setPending(resolveNext(features, industrySlug));
  };

  if (!pending) return null;

  const label = industryDisplayLabel.trim() || industrySlug;

  return (
    <div className="industry-feature-prompt card" role="region" aria-label="Suggested feature">
      <p className="ifp-lead">
        I see you are in <strong>{label}</strong>. Would you like to use our <strong>{pending.title}</strong> feature?
      </p>
      <p className="ifp-desc">It will allow you to {pending.description}</p>
      <p className="ifp-privacy">
        Tracking and measurements stay in your workspace only — nothing is shared automatically.
      </p>
      <div className="ifp-actions">
        <button type="button" className="btn btn-primary" onClick={onEnable}>
          Enable feature
        </button>
        <button type="button" className="btn btn-secondary" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

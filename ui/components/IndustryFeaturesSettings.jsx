import { useEffect, useState } from "react";
import { getIndustryFeatures } from "../clairaApiClient.js";
import { getIndustryFeatureState, setIndustryFeatureState } from "../userPrefs.js";
import "./IndustryFeaturesSettings.css";

/**
 * @param {{ industrySlug: string }} props
 */
export default function IndustryFeaturesSettings({ industrySlug }) {
  const [features, setFeatures] = useState(/** @type {Array<{ featureKey: string, title: string, description: string }>} */ ([]));

  useEffect(() => {
    const slug = String(industrySlug ?? "").trim();
    if (!slug) {
      setFeatures([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await getIndustryFeatures({ industry: slug });
        if (cancelled) return;
        setFeatures(Array.isArray(r?.features) ? r.features : []);
      } catch {
        if (!cancelled) setFeatures([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [industrySlug]);

  if (!industrySlug || features.length === 0) return null;

  return (
    <details className="industry-features-settings">
      <summary>Industry features (this device)</summary>
      <ul className="ifs-list">
        {features.map((f) => {
          const st = getIndustryFeatureState(industrySlug, f.featureKey);
          return (
            <li key={f.featureKey} className="ifs-item">
              <div className="ifs-head">
                <strong>{f.title}</strong>
                <span className="ifs-state mono">{st ?? "off"}</span>
              </div>
              <p className="ifs-desc">{f.description}</p>
              <div className="ifs-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIndustryFeatureState(industrySlug, f.featureKey, "enabled")}
                >
                  Enable
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIndustryFeatureState(industrySlug, f.featureKey, "dismissed")}
                >
                  Hide suggestions
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

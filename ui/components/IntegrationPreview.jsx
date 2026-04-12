import { useMemo, useState } from "react";
import {
  analyzeIntegrationData,
  simulateIntegration,
  suggestionsToExpectedItems,
} from "../../core/integrationEngine.js";
import { SYSTEM_MODE } from "../../core/systemMode.js";
import { REAL_MODE_INTEGRATION_REQUIRED_MESSAGE } from "../formatPipelineError.js";
import "./IntegrationPreview.css";

const SYSTEM_OPTIONS = [
  { value: "shopify", label: "Shopify" },
  { value: "wix", label: "Wix" },
  { value: "generic", label: "Generic" },
];

/**
 * @param {{
 *   onApplyFix?: (expectedItems: string[]) => void,
 * }} props
 */
export default function IntegrationPreview({ onApplyFix }) {
  const [systemType, setSystemType] = useState("shopify");

  const preview = useMemo(() => {
    if (SYSTEM_MODE === "real") {
      return { mode: "real" };
    }
    const data = simulateIntegration(systemType);
    const analysis = analyzeIntegrationData(data);
    return { mode: "simulation", data, analysis };
  }, [systemType]);

  const handleApplyFix = () => {
    if (preview.mode !== "simulation") return;
    const lines = suggestionsToExpectedItems(preview.analysis.suggestions);
    onApplyFix?.(lines);
  };

  if (preview.mode === "real") {
    return (
      <div className="integration-preview">
        <p className="integration-preview-real-blocked" role="alert">
          {REAL_MODE_INTEGRATION_REQUIRED_MESSAGE}
        </p>
        <p className="integration-preview-muted">
          Simulated integration preview is disabled while the engine is in real mode.
        </p>
      </div>
    );
  }

  const { data, analysis } = preview;

  return (
    <div className="integration-preview">
      {data != null && typeof data === "object" && /** @type {{ __simulated?: unknown }} */ (data).__simulated === true ? (
        <p className="integration-preview-simulated-banner" role="status">
          Simulated Data (Preview Only)
        </p>
      ) : null}
      <p className="integration-preview-title">Integration preview (simulated)</p>
      <p className="integration-preview-muted">No live APIs — mock data only.</p>

      <label className="integration-preview-label" htmlFor="integration-system-select">
        Preview system
      </label>
      <select
        id="integration-system-select"
        className="integration-preview-select"
        value={systemType}
        onChange={(e) => setSystemType(e.target.value)}
      >
        {SYSTEM_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <p className="integration-preview-detected">
        <span className="integration-preview-k">Detected system:</span> {data.system}
      </p>

      <p className="integration-preview-k section-gap">Issues</p>
      <ul className="integration-preview-list">
        {analysis.issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>

      <p className="integration-preview-k">Suggested actions</p>
      <ul className="integration-preview-list">
        {analysis.suggestions.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>

      <button
        type="button"
        className="integration-preview-apply"
        onClick={handleApplyFix}
        disabled={typeof onApplyFix !== "function"}
      >
        Apply Fix (Simulated)
      </button>
    </div>
  );
}

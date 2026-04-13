import { useCallback, useRef, useState } from "react";
import { registerSimulation } from "../core/simulationRegistry.js";
import ExpectationInput from "./components/ExpectationInput.jsx";
import IntegrationPreview from "./components/IntegrationPreview.jsx";
import "./Entrance.css";

registerSimulation({
  name: "connect_system_placeholder",
  location: "ui/Entrance.jsx",
  description: "UI placeholder for system connection",
  replaceWith: "OAuth / API connection flow",
});

/**
 * @param {File[]} list
 * @returns {File[]}
 */
function filterSupportedImageFiles(list) {
  return list.filter((f) => {
    const name = f.name?.toLowerCase() ?? "";
    const type = f.type?.toLowerCase() ?? "";
    return (
      name.endsWith(".png") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".webp") ||
      name.endsWith(".pdf") ||
      type === "image/png" ||
      type === "image/jpeg" ||
      type === "image/webp" ||
      type === "application/pdf"
    );
  });
}

/**
 * @param {{
 *   appMode?: "setup" | "runtime",
 *   oversightLevel?: "light" | "medium" | "strict",
 *   industrySlug?: string,
 *   packDisplayLabel?: string,
 *   intentOptions?: Array<{ value: string, label: string }>,
 *   inputButtonLabel?: string,
 *   onOversightLevelChange?: (level: "light" | "medium" | "strict") => void,
 *   onStartProcessing?: (payload: {
 *     inputKind: "file" | "external_placeholder",
 *     files: File[],
 *     fileSummaries: { name: string, size: number, type: string }[],
 *     intent: string,
 *     intentLabel: string,
 *     settings: { autoMove: boolean, strictValidation: boolean, reviewThreshold: number },
 *   }) => void,
 *   expectedItems?: string[],
 *   onExpectedItemsChange?: (items: string[]) => void,
 *   onApplyIntegrationFix?: (expectedItems: string[]) => void,
 *   tunnelIncomplete?: boolean,
 *   onResumeTunnel?: () => void,
 *   onEnterLearningMode?: () => void,
 *   onOpenCapabilities?: () => void,
 * }} props
 */
export default function Entrance({
  appMode = "setup",
  oversightLevel = "medium",
  industrySlug = "",
  packDisplayLabel = "",
  intentOptions: intentOptionsProp,
  inputButtonLabel = "Input",
  onOversightLevelChange,
  onStartProcessing,
  expectedItems = [],
  onExpectedItemsChange,
  onApplyIntegrationFix,
  tunnelIncomplete = false,
  onResumeTunnel,
  onEnterLearningMode,
  onOpenCapabilities,
}) {
  const intentOptions =
    Array.isArray(intentOptionsProp) && intentOptionsProp.length > 0
      ? intentOptionsProp
      : [
          { value: "workflow", label: "Sort & route with Claira" },
          { value: "custom", label: "Custom" },
        ];

  const [files, setFiles] = useState(/** @type {File[]} */ ([]));
  const [intent, setIntent] = useState(() => intentOptions[0]?.value ?? "workflow");
  const [settings, setSettings] = useState({
    autoMove: true,
    strictValidation: false,
    reviewThreshold: 0.5,
  });
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

  const intentLabel = intentOptions.find((o) => o.value === intent)?.label ?? intent;

  const mergeFiles = useCallback((incoming) => {
    const png = filterSupportedImageFiles(incoming);
    setFiles((prev) => {
      const byKey = new Map();
      for (const f of prev) byKey.set(`${f.name}-${f.size}`, f);
      for (const f of png) byKey.set(`${f.name}-${f.size}`, f);
      return [...byKey.values()];
    });
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      const dt = e.dataTransfer;
      if (!dt?.files?.length) return;
      mergeFiles([...dt.files]);
    },
    [mergeFiles],
  );

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const onPickFiles = useCallback(
    (e) => {
      const input = e.target;
      if (!input.files?.length) return;
      mergeFiles([...input.files]);
      input.value = "";
    },
    [mergeFiles],
  );

  const connectSystemPlaceholder = useCallback(() => {
    console.log("[Entrance] Connect System (placeholder — no functionality yet)");
  }, []);

  const handleStart = useCallback(() => {
    if (tunnelIncomplete && typeof onResumeTunnel === "function") {
      onResumeTunnel();
      return;
    }

    const fileSummaries = files.map((f) => ({ name: f.name, size: f.size, type: f.type }));
    const inputKind = files.length > 0 ? "file" : "external_placeholder";

    const payload = {
      inputKind,
      files,
      fileSummaries,
      intent,
      intentLabel,
      settings: { ...settings },
    };

    console.log("[Entrance] Start processing — selected input + intent", payload);
    console.log(
      "[Entrance] API: ingestData / processData are not invoked with browser File objects here (needs path or multipart). Payload above is what would inform the next step.",
    );

    onStartProcessing?.(payload);
  }, [files, intent, intentLabel, settings, onStartProcessing, onResumeTunnel, tunnelIncomplete]);

  const setupSubtitle =
    appMode === "setup"
      ? "First time setting up? Upload sample items so Claira can learn your categories."
      : "Have new files? Run them through your workflow.";

  return (
    <div className="entrance">
      <header className="entrance-header">
        <h1>Claira</h1>
        <p className="subtitle">{setupSubtitle}</p>
        {industrySlug ? (
          <p className="entrance-industry" style={{ fontSize: "0.85rem", color: "#a0a8b8" }}>
            Pack: {packDisplayLabel || industrySlug}
            {packDisplayLabel && packDisplayLabel !== industrySlug ? (
              <span className="mono" style={{ marginLeft: "0.35rem", opacity: 0.85 }}>
                ({industrySlug})
              </span>
            ) : null}
          </p>
        ) : null}
      </header>

      <section className="entrance-section" aria-labelledby="oversight-heading">
        <h2 id="oversight-heading">Review sensitivity</h2>
        <p className="entrance-oversight-help" style={{ fontSize: "0.9rem", color: "#c4cad4", marginBottom: "0.75rem" }}>
          How closely should Claira review your items?
        </p>
        <div className="entrance-intent" role="radiogroup" aria-label="Oversight level">
          {(
            [
              { value: "light", label: "Light — minimal interruptions" },
              { value: "medium", label: "Medium — balanced" },
              { value: "strict", label: "Strict — more prompts; prioritize learning" },
            ]
          ).map((opt) => (
            <label key={opt.value}>
              <input
                type="radio"
                name="oversight"
                value={opt.value}
                checked={oversightLevel === opt.value}
                onChange={() =>
                  onOversightLevelChange?.(/** @type {"light"|"medium"|"strict"} */ (opt.value))
                }
              />
              {opt.label}
            </label>
          ))}
        </div>
      </section>

      <section className="entrance-section" aria-labelledby="input-heading">
        <h2 id="input-heading">{inputButtonLabel}</h2>

        <ExpectationInput items={expectedItems} onItemsChange={onExpectedItemsChange} />

        <IntegrationPreview onApplyFix={onApplyIntegrationFix} />

        <div
          className={`entrance-dropzone ${dragActive ? "entrance-dropzone--active" : ""}`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          role="presentation"
        >
          Drag and drop images or PDFs here (.png, .jpg, .jpeg, .webp, .pdf)
        </div>

        <div className="entrance-file-actions">
          <button type="button" className="entrance-btn" onClick={() => fileInputRef.current?.click()}>
            Choose files…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
            multiple
            onChange={onPickFiles}
          />
          <span style={{ fontSize: "0.85rem", color: "#666" }}>PNG, JPEG, WebP, or PDF</span>
        </div>

        {files.length > 0 ? (
          <ul className="entrance-file-list">
            {files.map((f) => (
              <li key={`${f.name}-${f.size}`}>
                {f.name} ({Math.round(f.size / 1024)} KB)
              </li>
            ))}
          </ul>
        ) : null}

        <div className="entrance-external">
          <button type="button" className="entrance-btn" onClick={connectSystemPlaceholder}>
            Connect System
          </button>
        </div>
      </section>

      <section className="entrance-section" aria-labelledby="intent-heading">
        <h2 id="intent-heading">Intent</h2>
        <div className="entrance-intent" role="radiogroup" aria-label="Processing intent">
          {intentOptions.map((opt) => (
            <label key={opt.value}>
              <input
                type="radio"
                name="intent"
                value={opt.value}
                checked={intent === opt.value}
                onChange={() => setIntent(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </section>

      <section className="entrance-section">
        <details className="entrance-details">
          <summary>Settings (optional)</summary>
          <div className="entrance-settings">
            <label>
              <input
                type="checkbox"
                checked={settings.autoMove}
                onChange={(e) => setSettings((s) => ({ ...s, autoMove: e.target.checked }))}
              />
              Auto-move
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.strictValidation}
                onChange={(e) => setSettings((s) => ({ ...s, strictValidation: e.target.checked }))}
              />
              Strict validation
            </label>
            <div className="slider-row">
              <label htmlFor="review-threshold">Review threshold: {settings.reviewThreshold.toFixed(2)}</label>
              <input
                id="review-threshold"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={settings.reviewThreshold}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, reviewThreshold: Number(e.target.value) }))
                }
              />
            </div>
          </div>
        </details>
      </section>

      <button type="button" className="entrance-btn entrance-btn-primary" onClick={handleStart}>
        {inputButtonLabel}
      </button>

      <div className="entrance-learning-actions">
        {appMode === "runtime" && typeof onEnterLearningMode === "function" ? (
          <button type="button" className="entrance-btn" onClick={onEnterLearningMode}>
            Enter Learning Mode
          </button>
        ) : null}
        {typeof onOpenCapabilities === "function" ? (
          <button type="button" className="entrance-btn" onClick={onOpenCapabilities}>
            Manage categories
          </button>
        ) : null}
      </div>

      <p className="entrance-hint">
        After starting, you&apos;ll continue to the processing view. Intake choices are logged in the console for now.
      </p>
    </div>
  );
}

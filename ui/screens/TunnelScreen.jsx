import { useCallback, useEffect, useMemo, useState } from "react";
import { processFolder, tunnelUploadStaged } from "../../interfaces/api.js";
import { isSuccessfullyProcessedRow } from "../pipelineRowUtils.js";
import { buildTunnelSteps } from "../tunnelSteps.js";
import {
  MIN_TUNNEL_EXAMPLES,
  addTunnelExampleCount,
  getTunnelExampleCounts,
  getTunnelSkippedMap,
  markTunnelCategorySkipped,
  maybeCompleteSetupAfterAllTunnelStepsSkipped,
  setAppMode,
  setTunnelStepIndex,
  getSelectedCapabilities,
  getTunnelStepIndex,
  setTunnelManifest,
  setTunnelGranular,
  getTunnelGranular,
  setTunnelSkippedMap,
} from "../userPrefs.js";
import CategoryReferencePanel from "../components/CategoryReferencePanel.jsx";
import ProcessIntel from "../components/ProcessIntel.jsx";
import GuidedStepChrome from "../onboarding/GuidedStepChrome.jsx";
import "../voice/ClairaVoiceChrome.css";
import "./TunnelScreen.css";

/**
 * @param {string} key
 */
function labelForCategoryKey(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param {File} file
 * @returns {Promise<{ name: string, base64: string }>}
 */
function fileToBase64Entry(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const i = dataUrl.indexOf("base64,");
      const b64 = i >= 0 ? dataUrl.slice(i + 7) : "";
      resolve({ name: file.name, base64: b64 });
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * @param {Record<string, { categories?: string[] }>} groups
 * @param {string[]} groupOrder
 */
function packDefinesGroups(groups, groupOrder) {
  return groupOrder.some((gid) => (groups[gid]?.categories?.length ?? 0) > 0);
}

/**
 * @param {{
 *   steps: Array<{
 *     skipKey: string,
 *     stagingKey: string,
 *     kind: string,
 *     groupId: string | null,
 *     label: string,
 *     description: string,
 *     categoryKeys: string[],
 *   }>,
 *   categoryUi?: Record<string, { label: string, description?: string }>,
 *   packProcesses?: Record<string, unknown>,
 *   groupingMeta?: { groups: Record<string, { categories?: string[] }>, groupOrder: string[] },
 *   onTunnelPlanChange?: () => void,
 *   appMode: "setup" | "runtime",
 *   oversightLevel: "light" | "medium" | "strict",
 *   onExitToEntrance: () => void,
 *   onProcessingResults?: (results: unknown[]) => void,
 *   industrySlug?: string,
 *   onStepCategoryKeys?: (keys: string[] | null) => void,
 *   progressTrackingEnabled?: boolean,
 *   onOpenProgressTracker?: (categoryKey: string) => void,
 *   guidedStep?: number,
 * }} props
 */
export default function TunnelScreen({
  steps,
  categoryUi = {},
  packProcesses = {},
  groupingMeta = { groups: {}, groupOrder: [] },
  onTunnelPlanChange,
  appMode,
  oversightLevel,
  onExitToEntrance,
  onProcessingResults,
  industrySlug = "",
  onStepCategoryKeys,
  progressTrackingEnabled = false,
  onOpenProgressTracker,
  guidedStep,
}) {
  const [stepIndex, setStepIndex] = useState(0);
  /** @type {"reference" | "live"} */
  const [uploadKind, setUploadKind] = useState("live");
  /** @type {string} */
  const [refTargetCategory, setRefTargetCategory] = useState("");

  const canToggleGranular = useMemo(
    () => packDefinesGroups(groupingMeta.groups, groupingMeta.groupOrder),
    [groupingMeta.groups, groupingMeta.groupOrder],
  );
  const tunnelGranular = getTunnelGranular();

  useEffect(() => {
    if (!steps.length) return;
    const saved = getTunnelStepIndex();
    const clamped = Math.min(Math.max(0, saved), Math.max(0, steps.length - 1));
    setStepIndex(clamped);
  }, [steps]);

  const safeIndex = steps.length > 0 ? Math.min(Math.max(0, stepIndex), steps.length - 1) : 0;
  const step = steps.length > 0 ? steps[safeIndex] : null;

  const displayLabel = step?.label ?? "";
  const displayDescription = step?.description ?? "";
  const stagingKey = step?.stagingKey ?? "";
  const categoryKeys = step?.categoryKeys ?? [];

  useEffect(() => {
    if (!step?.categoryKeys?.length) {
      setRefTargetCategory("");
      return;
    }
    setRefTargetCategory((prev) => (step.categoryKeys.includes(prev) ? prev : step.categoryKeys[0]));
  }, [step?.skipKey, step?.categoryKeys]);

  useEffect(() => {
    if (!onStepCategoryKeys) return;
    const keys = step?.categoryKeys ?? [];
    onStepCategoryKeys(keys.length ? keys : null);
  }, [step?.skipKey, step?.categoryKeys, onStepCategoryKeys]);

  const refPanelCategory = useMemo(() => {
    const keys = categoryKeys;
    if (keys.length === 1) return keys[0];
    if (uploadKind === "reference" && refTargetCategory) return refTargetCategory;
    return keys[0] ?? "";
  }, [categoryKeys, uploadKind, refTargetCategory]);

  const refPanelLabel = useMemo(() => {
    const k = refPanelCategory;
    if (!k) return "";
    return categoryUi[k]?.label ?? labelForCategoryKey(k);
  }, [refPanelCategory, categoryUi]);

  const uploadTargetLabel = useMemo(() => {
    if (categoryKeys.length === 1) {
      const k = categoryKeys[0];
      return categoryUi[k]?.label ?? labelForCategoryKey(k);
    }
    return displayLabel;
  }, [categoryKeys, categoryUi, displayLabel]);

  const counts = getTunnelExampleCounts();
  const exampleKey = step?.skipKey ?? "";
  const exampleCount = exampleKey ? counts[exampleKey] ?? 0 : 0;

  const [files, setFiles] = useState(/** @type {File[]} */ ([]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [lastRunSummary, setLastRunSummary] = useState(/** @type {string | null} */ (null));

  const onPick = useCallback((e) => {
    const input = e.target;
    if (!input.files?.length) return;
    setFiles([...input.files]);
    input.value = "";
  }, []);

  const onGranularChange = useCallback(
    (nextGranular) => {
      const sel = getSelectedCapabilities();
      const { groups, groupOrder } = groupingMeta;
      setTunnelGranular(nextGranular);
      const newSteps = buildTunnelSteps(sel, groups, groupOrder, nextGranular, categoryUi);
      setTunnelManifest(sel, newSteps, nextGranular);
      setTunnelStepIndex(0);
      setTunnelSkippedMap({});
      setStepIndex(0);
      setFiles([]);
      setLastRunSummary(null);
      setError(null);
      onTunnelPlanChange?.();
    },
    [groupingMeta, categoryUi, onTunnelPlanChange],
  );

  const runUploadAndProcess = useCallback(async () => {
    if (!step || !stagingKey) return;
    setError(null);
    setLastRunSummary(null);
    setBusy(true);
    try {
      if (!files.length) {
        throw new Error("I need at least one image before we can continue.");
      }
      if (uploadKind === "reference" && categoryKeys.length > 1 && !refTargetCategory) {
        throw new Error("Which category should these references live under? I’m seeing more than one option.");
      }
      const refCat =
        uploadKind === "reference"
          ? categoryKeys.length === 1
            ? categoryKeys[0]
            : refTargetCategory
          : "";

      const entries = [];
      for (const f of files) {
        entries.push(await fileToBase64Entry(f));
      }

      if (uploadKind === "reference") {
        const up = await tunnelUploadStaged(refCat, entries, {
          uploadTag: { type: "reference", category: refCat },
        });
        const added = typeof up?.added === "number" ? up.added : 0;
        if (added > 0) {
          addTunnelExampleCount(exampleKey, added);
        }
        setLastRunSummary(
          added > 0
            ? `Added ${added} reference training file(s) to references/user/${refCat}/ (type: reference).`
            : "No reference files were added (check image format: png, jpg, webp).",
        );
        setFiles([]);
        return;
      }

      const up = await tunnelUploadStaged(stagingKey, entries, {
        uploadTag: { type: "live", category: stagingKey },
      });
      const folderPath = typeof up?.folderPath === "string" ? up.folderPath : "";
      if (!folderPath) throw new Error("Upload did not return folderPath");

      const expectedCategory = categoryKeys.length === 1 ? categoryKeys[0] : undefined;
      const out = await processFolder(folderPath, {
        runtimeContext: {
          appMode,
          oversightLevel,
          ...(expectedCategory ? { expectedCategory } : {}),
        },
      });
      const results = Array.isArray(out?.results) ? out.results : [];
      onProcessingResults?.(results);

      let ok = 0;
      for (const row of results) {
        if (isSuccessfullyProcessedRow(row)) ok += 1;
      }
      if (ok > 0) {
        addTunnelExampleCount(exampleKey, ok);
      }
      setLastRunSummary(
        `Live (type: live): processed ${results.length} file(s). ${ok} counted toward examples (successfully processed, no review).`,
      );
      setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [
    appMode,
    oversightLevel,
    step,
    stagingKey,
    categoryKeys,
    refTargetCategory,
    uploadKind,
    files,
    onProcessingResults,
    exampleKey,
  ]);

  const finishTunnel = useCallback(() => {
    setTunnelStepIndex(steps.length);
    if (maybeCompleteSetupAfterAllTunnelStepsSkipped(steps, getTunnelSkippedMap())) {
      setAppMode("runtime");
    }
    onExitToEntrance();
  }, [steps, onExitToEntrance]);

  const goSkip = useCallback(() => {
    if (!step) return;
    markTunnelCategorySkipped(step.skipKey);
    const next = safeIndex + 1;
    if (next >= steps.length) {
      finishTunnel();
      return;
    }
    setTunnelStepIndex(next);
    setStepIndex(next);
    setFiles([]);
    setLastRunSummary(null);
    setError(null);
  }, [step, steps.length, finishTunnel, safeIndex]);

  const goNext = useCallback(() => {
    const next = safeIndex + 1;
    if (next >= steps.length) {
      finishTunnel();
      return;
    }
    setTunnelStepIndex(next);
    setStepIndex(next);
    setFiles([]);
    setLastRunSummary(null);
    setError(null);
  }, [steps.length, finishTunnel, safeIndex]);

  if (!steps.length) {
    return (
      <>
        {typeof guidedStep === "number" ? (
          <GuidedStepChrome step={guidedStep} phaseLabel="Reference learning" />
        ) : null}
        <div className="tunnel-screen card">
          <p>No categories selected.</p>
          <button type="button" className="btn btn-primary" onClick={onExitToEntrance}>
            Back
          </button>
        </div>
      </>
    );
  }

  const stepNum = safeIndex + 1;
  const total = steps.length;

  return (
    <>
      {typeof guidedStep === "number" ? (
        <GuidedStepChrome step={guidedStep} phaseLabel="Reference learning" />
      ) : null}
      <div className="tunnel-screen card">
      <header className="tunnel-header">
        <p className="tunnel-step-label">
          Reference round {stepNum} of {total}
        </p>
        <div className="claira-screen-heading-row">
          <h1>Upload — {uploadTargetLabel}</h1>
        </div>
        {displayDescription ? <p className="tunnel-category-desc">{displayDescription}</p> : null}
        {categoryKeys.length > 1 ? (
          <details className="tunnel-includes">
            <summary>Includes {categoryKeys.length} categories</summary>
            <ul className="tunnel-includes-list">
              {categoryKeys.map((k) => (
                <li key={k}>
                  <span className="tunnel-includes-label">{categoryUi[k]?.label ?? labelForCategoryKey(k)}</span>
                  <span className="mono tunnel-includes-key">{k}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="tunnel-process-block">
          <h2 className="tunnel-process-heading">Handling (workflow)</h2>
          {categoryKeys.map((k) => (
            <div key={k} className="tunnel-process-row">
              {categoryKeys.length > 1 ? (
                <p className="tunnel-process-cat mono">
                  {categoryUi[k]?.label ?? labelForCategoryKey(k)} · {k}
                </p>
              ) : null}
              <ProcessIntel
                categoryKey={k}
                entry={
                  packProcesses[k] && typeof packProcesses[k] === "object"
                    ? /** @type {{ purpose?: string, actions?: string[], priority?: string, review_required?: boolean }} */ (
                        packProcesses[k]
                      )
                    : null
                }
              />
            </div>
          ))}
        </div>
        {refPanelCategory ? (
          <CategoryReferencePanel
            categoryKey={refPanelCategory}
            categoryLabel={refPanelLabel}
            industrySlug={industrySlug}
            progressTrackingEnabled={progressTrackingEnabled}
            onOpenProgressTracker={onOpenProgressTracker}
          />
        ) : null}
        <p className="tunnel-expected mono">
          Staging: {stagingKey} · tag: {uploadKind}
        </p>
      </header>

      {canToggleGranular ? (
        <label className="tunnel-granular-toggle">
          <input
            type="checkbox"
            checked={tunnelGranular}
            onChange={(e) => onGranularChange(e.target.checked)}
          />
          <span>Step through each category (advanced)</span>
        </label>
      ) : null}

      <section className="tunnel-upload-kind" aria-labelledby="upload-kind-heading">
        <h2 id="upload-kind-heading" className="tunnel-upload-kind-title">
          What are you uploading?
        </h2>
        <div className="tunnel-upload-kind-options" role="radiogroup">
          <label className="tunnel-radio">
            <input
              type="radio"
              name="uploadKind"
              checked={uploadKind === "reference"}
              onChange={() => setUploadKind("reference")}
            />
            <span>
              <strong>Reference material</strong> — training examples; saved under{" "}
              <code className="mono">references/user/&lt;category&gt;/</code>
            </span>
          </label>
          <label className="tunnel-radio">
            <input
              type="radio"
              name="uploadKind"
              checked={uploadKind === "live"}
              onChange={() => setUploadKind("live")}
            />
            <span>
              <strong>Live data</strong> — run through normal classification and routing
            </span>
          </label>
        </div>
      </section>

      {uploadKind === "reference" && categoryKeys.length > 1 ? (
        <div className="tunnel-ref-target">
          <label htmlFor="tunnel-ref-cat">Reference category</label>
          <select
            id="tunnel-ref-cat"
            className="tunnel-ref-select"
            value={refTargetCategory}
            onChange={(e) => setRefTargetCategory(e.target.value)}
          >
            {categoryKeys.map((k) => (
              <option key={k} value={k}>
                {categoryUi[k]?.label ?? labelForCategoryKey(k)} ({k})
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className={`tunnel-examples ${exampleCount < MIN_TUNNEL_EXAMPLES ? "tunnel-examples--low" : ""}`}>
        <p>
          Upload at least <strong>{MIN_TUNNEL_EXAMPLES}</strong> successful items for this step (reference adds count
          per file saved; live counts non-review pipeline rows).
          Current count: <strong>{exampleCount}</strong> / {MIN_TUNNEL_EXAMPLES}
        </p>
        <p className="tunnel-soft">
          Mismatching live items may go to the Waiting Room — nothing is hard-blocked.
        </p>
      </div>

      <div className="tunnel-file-row">
        <input type="file" accept="image/*,.png,.jpg,.jpeg,.webp" multiple onChange={onPick} />
      </div>
      {files.length > 0 ? (
        <ul className="tunnel-file-list">
          {files.map((f) => (
            <li key={`${f.name}-${f.size}`}>
              {f.name} ({Math.round(f.size / 1024)} KB)
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <div className="tunnel-error" role="alert">
          {error}
        </div>
      ) : null}
      {lastRunSummary ? <p className="tunnel-summary">{lastRunSummary}</p> : null}

      <div className="tunnel-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !files.length}
          onClick={() => void runUploadAndProcess()}
        >
          {busy
            ? "Running…"
            : uploadKind === "reference"
              ? `Upload reference — ${uploadTargetLabel}`
              : `Upload & process — ${uploadTargetLabel}`}
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={goSkip}>
          Skip this step
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={goNext}>
          Next step
        </button>
      </div>
    </div>
    </>
  );
}

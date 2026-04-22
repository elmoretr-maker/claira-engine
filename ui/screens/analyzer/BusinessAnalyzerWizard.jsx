/**
 * BusinessAnalyzerWizard.jsx
 *
 * Multi-step intake form for creating or editing a Business Analyzer dataset.
 * Renders one step at a time with progress indicator and back/next navigation.
 *
 * CONSTRAINT: No engine logic here. All transformation is in datasetTransformer.js.
 * runPipeline.js calls the existing engine handlers unchanged.
 */

import { useState, useMemo } from "react";
import { getLabels }         from "../../utils/intentLabels.js";
import { parseEntityNames, buildSnapshots, buildEvents } from "../../utils/datasetTransformer.js";
import { saveDataset, generateDatasetId } from "../../utils/datasetStore.js";
import { runPipeline }       from "../../utils/runPipeline.js";
import IntentStep            from "../../components/analyzer/IntentStep.jsx";
import EntitiesStep          from "../../components/analyzer/EntitiesStep.jsx";
import StateStep             from "../../components/analyzer/StateStep.jsx";
import ActivityStep          from "../../components/analyzer/ActivityStep.jsx";
import ReviewStep            from "../../components/analyzer/ReviewStep.jsx";
import "../../components/analyzer/BusinessAnalyzer.css";

const STEPS = ["Intent", "Items", "Current State", "Activity", "Review"];

/** @returns {string} Today as YYYY-MM-DD */
function isoToday() {
  return new Date().toISOString().split("T")[0];
}
/** @returns {string} N days ago as YYYY-MM-DD */
function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

/** Build a default dataset name: "[Intent Label] — [Mon D]" e.g. "Inventory — Apr 22" */
function buildDefaultName(intent) {
  const labels = getLabels(intent);
  const d      = new Date();
  const month  = d.toLocaleString("default", { month: "short" });
  const day    = d.getDate();
  // Use short intent label (first word capitalized only)
  const shortLabel = labels.intentLabel.split(" ").slice(0, 2).map((w, i) =>
    i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toLowerCase()
  ).join(" ");
  return `${shortLabel} — ${month} ${day}`;
}

/**
 * @param {{
 *   mode?:             "create" | "edit",
 *   existingDataset?:  import("../../utils/datasetStore.js").Dataset | null,
 *   onSaved:           (dataset: import("../../utils/datasetStore.js").Dataset) => void,
 *   onCancel:          () => void,
 *   onAnalysisReady:   (merged: any[]) => void,
 * }} props
 */
export default function BusinessAnalyzerWizard({
  mode            = "create",
  existingDataset = null,
  onSaved,
  onCancel,
  onAnalysisReady,
}) {
  const init = existingDataset ?? {};

  const [step,     setStep]     = useState(0);
  const [running,  setRunning]  = useState(false);
  const [runError, setRunError] = useState(/** @type {string|null} */ (null));

  const [formData, setFormData] = useState({
    // Step 0 — intent
    intent: init.intent ?? null,

    // Step 1 — entities (raw textarea)
    entityNamesRaw: (init.entities ?? []).map((e) => e.label).join("\n"),

    // Step 2 — current state
    stateValues: /** @type {{ [id: string]: string|number }} */ ({}),
    stateDate:   isoToday(),

    // Step 3 — activity
    salesValues:    /** @type {{ [id: string]: string|number }} */ ({}),
    deliveryValues: /** @type {{ [id: string]: string|number }} */ ({}),
    periodStart:    isoDaysAgo(30),
    periodEnd:      isoToday(),

    // Step 4 — name
    datasetName: init.name ?? "",
  });

  /** @param {object} updates */
  function handleChange(updates) {
    setFormData((prev) => ({ ...prev, ...updates }));
  }

  const labels = useMemo(() => getLabels(formData.intent ?? "custom"), [formData.intent]);

  /** Parsed entity list — derived from textarea, not stored separately. */
  const entities = useMemo(
    () =>
      formData.entityNamesRaw
        ? parseEntityNames(formData.entityNamesRaw)
        : (init.entities ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formData.entityNamesRaw],
  );

  /** Form data enriched with computed fields child steps need. */
  const enriched = useMemo(
    () => ({
      ...formData,
      entities,
      // Auto-suggest name only if user hasn't typed one yet
      datasetName: formData.datasetName || buildDefaultName(formData.intent ?? "custom"),
    }),
    [formData, entities],
  );

  // ── Per-step validation ───────────────────────────────────────────────────

  /** @param {number} s */
  function isStepValid(s) {
    if (s === 0) return !!formData.intent;
    if (s === 1) return entities.length > 0;
    if (s === 2) {
      return entities.some((e) => {
        const v = formData.stateValues[e.entityId];
        return v !== "" && v !== undefined && v !== null && Number.isFinite(Number(v)) && Number(v) >= 0;
      });
    }
    return true; // Steps 3 and 4 are always valid (activity optional; name auto-suggested)
  }

  // ── Dataset assembly ──────────────────────────────────────────────────────

  function assembleDataset() {
    const { saleEvents, deliveryEvents } = buildEvents(entities, {
      periodEnd:  formData.periodEnd,
      sales:      formData.salesValues,
      deliveries: formData.deliveryValues,
    });
    const snapshots = buildSnapshots(
      entities,
      Object.fromEntries(
        entities.map((e) => [
          e.entityId,
          { value: formData.stateValues[e.entityId] ?? 0, timestamp: formData.stateDate },
        ]),
      ),
    );
    return {
      datasetId:   init.datasetId ?? generateDatasetId(),
      name:        enriched.datasetName,
      intent:      formData.intent ?? "custom",
      intentLabel: labels.intentLabel,
      entities,
      snapshots,
      saleEvents,
      deliveryEvents,
    };
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  function handleSave() {
    const dataset = assembleDataset();
    saveDataset(dataset);
    onSaved(dataset);
  }

  async function handleSaveAndRun() {
    setRunError(null);
    setRunning(true);
    try {
      const dataset = assembleDataset();
      saveDataset(dataset);
      const merged = await runPipeline(dataset);
      onAnalysisReady(merged);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Analysis failed. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  const canAdvance = isStepValid(step);
  const isLastStep = step === STEPS.length - 1;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="ba-flow">
      {/* Header */}
      <div className="ba-flow__header">
        <img
          src="/assets/tool-thumbnails/business-analyzer.png"
          alt=""
          className="ba-flow__icon"
        />
        <h2 className="ba-flow__title">Business Analyzer</h2>
        <button
          type="button"
          className="ba-btn ba-btn--ghost ba-flow__close"
          onClick={onCancel}
          disabled={running}
        >
          Cancel
        </button>
      </div>

      {/* Progress indicator */}
      <div className="ba-progress" role="list" aria-label="Setup steps">
        {STEPS.map((name, i) => (
          <div
            key={name}
            role="listitem"
            className={[
              "ba-progress__step",
              i === step ? "ba-progress__step--active" : "",
              i  <  step ? "ba-progress__step--done"   : "",
            ].join(" ").trim()}
          >
            <span className="ba-progress__num" aria-hidden="true">{i + 1}</span>
            <span className="ba-progress__label">{name}</span>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="ba-flow__body">
        {step === 0 && <IntentStep   value={formData.intent} onChange={handleChange} />}
        {step === 1 && <EntitiesStep formData={enriched} onChange={handleChange} labels={labels} />}
        {step === 2 && <StateStep    formData={enriched} onChange={handleChange} labels={labels} mode={mode} />}
        {step === 3 && <ActivityStep formData={enriched} onChange={handleChange} labels={labels} />}
        {step === 4 && <ReviewStep   formData={enriched} onChange={handleChange} labels={labels} />}
      </div>

      {runError && <div className="ba-error" role="alert">{runError}</div>}

      {/* Navigation */}
      <div className="ba-flow__nav">
        {step > 0 ? (
          <button
            type="button"
            className="ba-btn ba-btn--ghost"
            onClick={() => setStep((s) => s - 1)}
            disabled={running}
          >
            Back
          </button>
        ) : (
          <div />
        )}

        <div className="ba-flow__nav-right">
          {!isLastStep ? (
            <button
              type="button"
              className="ba-btn ba-btn--primary"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance}
            >
              Next
            </button>
          ) : (
            <>
              <button
                type="button"
                className="ba-btn ba-btn--ghost"
                onClick={handleSave}
                disabled={running}
              >
                Save Dataset
              </button>
              <button
                type="button"
                className="ba-btn ba-btn--primary"
                onClick={handleSaveAndRun}
                disabled={running}
              >
                {running ? "Running analysis…" : "Save and Run Analysis"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

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
import {
  parseEntityNames,
  buildSnapshots,
  buildSnapshotsWithBaseline,
  buildEvents,
} from "../../utils/datasetTransformer.js";
import { saveDataset, generateDatasetId } from "../../utils/datasetStore.js";
import {
  initWellnessMetricsFromDataset,
  entitiesFromWellnessMetrics,
  resolveWellnessStateValues,
  serializeWellnessMetricsForStore,
  createDefaultMetricRow,
} from "../../utils/wellnessMetrics.js";
import {
  transformLogsToWellnessInputs,
  createDefaultBaselineIntake,
} from "../../utils/wellnessLogs.js";
import { runPipeline }        from "../../utils/runPipeline.js";
import IntentStep                from "../../components/analyzer/IntentStep.jsx";
import EntitiesStep              from "../../components/analyzer/EntitiesStep.jsx";
import StateStep                 from "../../components/analyzer/StateStep.jsx";
import ActivityStep              from "../../components/analyzer/ActivityStep.jsx";
import WellnessIntakeStep        from "../../components/analyzer/WellnessIntakeStep.jsx";
import WellnessModeSelectionStep from "../../components/analyzer/WellnessModeSelectionStep.jsx";
import ReviewStep                from "../../components/analyzer/ReviewStep.jsx";
import "../../components/analyzer/BusinessAnalyzer.css";

// Wellness flow skips "Items" (MetricBuilder) and "Current State" — replaced by
// intake mode selection + structured habit intake.
const STEPS_DEFAULT  = ["Intent", "Items", "Current State", "Activity", "Review"];
const STEPS_WELLNESS = ["Intent", "Start",  "Daily Habits", "Review"];

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
  const init         = existingDataset ?? {};
  const initWellness = init.wellness ?? {};

  const [step,     setStep]     = useState(0);
  const [running,  setRunning]  = useState(false);
  const [runError, setRunError] = useState(/** @type {string|null} */ (null));

  const [formData, setFormData] = useState({
    // Step 0 — intent
    intent: init.intent ?? null,

    // Step 1 — entities (textarea) or structured metrics (weightloss)
    entityNamesRaw: (init.entities ?? []).map((e) => e.label).join("\n"),
    metrics: init.intent === "weightloss" ? initWellnessMetricsFromDataset(init) : [],

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

    // Weight & wellness (weightloss intent)
    baselineStateValues: init.baselineStateValues ?? /** @type {{ [id: string]: string|number }} */ ({}),
    wellnessGoalWeight:
      initWellness.goalWeightLb != null && initWellness.goalWeightLb !== ""
        ? String(initWellness.goalWeightLb)
        : "",
    wellnessSleepBed:   initWellness.sleepBed ?? "",
    wellnessSleepWake:  initWellness.sleepWake ?? "",
    wellnessSleepHours:
      initWellness.sleepHours != null && initWellness.sleepHours !== ""
        ? String(initWellness.sleepHours)
        : "",
    wellnessMealsNote:  initWellness.mealsNote ?? "",
    wellnessSnacksNote: initWellness.snacksNote ?? "",

    // Structured intake (new — replaces free-text notes)
    intakeMode:     initWellness.intakeMode    ?? "baseline",
    baselineIntake: initWellness.baselineIntake ?? createDefaultBaselineIntake(),
    dailyLogs:      initWellness.dailyLogs     ?? [],
  });

  /** @param {object} updates */
  function handleChange(updates) {
    setFormData((prev) => {
      let next = { ...prev, ...updates };

      if (updates.metrics) {
        const sv = { ...prev.stateValues };
        for (const m of updates.metrics) {
          if (m.entityId && m.value !== "" && m.value != null && Number.isFinite(Number(m.value))) {
            sv[m.entityId] = m.value;
          }
        }
        next.stateValues = sv;
      }

      if (updates.stateValues && prev.intent === "weightloss" && next.metrics?.length) {
        next.metrics = next.metrics.map((m) => {
          const v = updates.stateValues[m.entityId];
          if (v !== undefined) {
            return { ...m, value: v === "" ? "" : String(v) };
          }
          return m;
        });
      }

      if (updates.intent === "weightloss" && (!next.metrics || next.metrics.length === 0)) {
        next.metrics = [createDefaultMetricRow()];
      }

      return next;
    });
  }

  const labels = useMemo(() => getLabels(formData.intent ?? "custom"), [formData.intent]);

  const STEPS = formData.intent === "weightloss" ? STEPS_WELLNESS : STEPS_DEFAULT;

  /** Parsed entity list — from structured metrics (weightloss) or textarea / edit init. */
  const entities = useMemo(() => {
    if (formData.intent === "weightloss") {
      return entitiesFromWellnessMetrics(formData.metrics ?? []);
    }
    if (formData.entityNamesRaw) {
      return parseEntityNames(formData.entityNamesRaw);
    }
    return init.entities ?? [];
  }, [formData.intent, formData.metrics, formData.entityNamesRaw, init.entities]);

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

    // ── Wellness 4-step flow ─────────────────────────────────────────────────
    if (formData.intent === "weightloss") {
      if (s === 1) return !!formData.intakeMode; // mode must be selected before advancing
      return true;                               // steps 2 (habits) and 3 (review) always passable
    }

    // ── Default 5-step flow ──────────────────────────────────────────────────
    if (s === 1) return entities.length > 0;
    if (s === 2) {
      return entities.some((e) => {
        const v = formData.stateValues[e.entityId];
        return v !== "" && v !== undefined && v !== null && Number.isFinite(Number(v)) && Number(v) >= 0;
      });
    }
    return true; // steps 3 and 4 always valid (activity optional; name auto-suggested)
  }

  // ── Dataset assembly ──────────────────────────────────────────────────────

  function assembleDataset() {
    const intent = formData.intent ?? "custom";
    let resolvedState =
      intent === "weightloss"
        ? resolveWellnessStateValues(formData.metrics ?? [], formData.stateValues)
        : formData.stateValues;

    // Wellness new flow: no "Current State" step, so sync weight from intake form.
    // Uses intake value only when no manual state entry was set by an older edit flow.
    if (intent === "weightloss") {
      const firstMetric = (formData.metrics ?? [])[0];
      if (firstMetric?.entityId && !(Number(resolvedState[firstMetric.entityId]) > 0)) {
        const intakeW = Number(formData.baselineIntake?.weightValue ?? "");
        if (Number.isFinite(intakeW) && intakeW > 0) {
          resolvedState = { ...resolvedState, [firstMetric.entityId]: intakeW };
        }
      }
    }

    const { saleEvents, deliveryEvents } = buildEvents(entities, {
      periodEnd:  formData.periodEnd,
      sales:      formData.salesValues,
      deliveries: formData.deliveryValues,
    });
    const stateData = Object.fromEntries(
      entities.map((e) => [
        e.entityId,
        { value: resolvedState[e.entityId] ?? 0, timestamp: formData.stateDate },
      ]),
    );
    const snapshots =
      intent === "weightloss"
        ? buildSnapshotsWithBaseline(
            entities,
            resolvedState,
            formData.stateDate,
            formData.baselineStateValues ?? {},
            formData.periodStart,
          )
        : buildSnapshots(entities, stateData);

    const goalN   = Number(formData.wellnessGoalWeight);
    const sleepHN = Number(formData.wellnessSleepHours);

    // Build structured-intake override — spread last so structured values win.
    const intakeTransform =
      intent === "weightloss"
        ? transformLogsToWellnessInputs(
            formData.dailyLogs      ?? [],
            formData.baselineIntake ?? {},
            formData.intakeMode     ?? "baseline",
          )
        : null;

    return {
      datasetId:   init.datasetId ?? generateDatasetId(),
      name:        enriched.datasetName,
      intent,
      intentLabel: labels.intentLabel,
      entities,
      snapshots,
      saleEvents,
      deliveryEvents,
      ...(intent === "weightloss"
        ? {
            metrics: serializeWellnessMetricsForStore(formData.metrics ?? [], resolvedState),
            baselineStateValues: formData.baselineStateValues ?? {},
            wellness: {
              // Legacy / StateStep values (used as fallback when intake step was skipped)
              goalWeightLb:    Number.isFinite(goalN)   ? goalN   : null,
              sleepBed:        formData.wellnessSleepBed  ?? "",
              sleepWake:       formData.wellnessSleepWake ?? "",
              sleepHours:      Number.isFinite(sleepHN) ? sleepHN : null,
              mealsNote:       formData.wellnessMealsNote  ?? "",
              snacksNote:      formData.wellnessSnacksNote ?? "",
              primaryEntityId: formData.metrics?.[0]?.entityId ?? entities[0]?.entityId ?? "",
              // Structured intake overrides legacy values when present
              ...(intakeTransform ?? {}),
              // Persist raw intake data for re-edit and future use
              dailyLogs:      formData.dailyLogs      ?? [],
              baselineIntake: formData.baselineIntake ?? {},
              intakeMode:     formData.intakeMode     ?? "baseline",
            },
          }
        : {}),
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
        {/* Step 0 — intent selection (all flows) */}
        {step === 0 && <IntentStep value={formData.intent} onChange={handleChange} />}

        {/* Step 1 — wellness: intake mode card selection; default: entity list */}
        {step === 1 && formData.intent === "weightloss" && (
          <WellnessModeSelectionStep formData={enriched} onChange={handleChange} />
        )}
        {step === 1 && formData.intent !== "weightloss" && (
          <EntitiesStep formData={enriched} onChange={handleChange} labels={labels} intent={formData.intent} />
        )}

        {/* Step 2 — wellness: structured habit intake; default: current state */}
        {step === 2 && formData.intent === "weightloss" && (
          <WellnessIntakeStep formData={enriched} onChange={handleChange} />
        )}
        {step === 2 && formData.intent !== "weightloss" && (
          <StateStep
            formData={enriched}
            onChange={handleChange}
            labels={labels}
            mode={mode}
            intent={formData.intent}
          />
        )}

        {/* Step 3 — wellness: review; default: activity */}
        {step === 3 && formData.intent === "weightloss" && (
          <ReviewStep formData={enriched} onChange={handleChange} labels={labels} intent={formData.intent} />
        )}
        {step === 3 && formData.intent !== "weightloss" && (
          <ActivityStep formData={enriched} onChange={handleChange} labels={labels} intent={formData.intent} />
        )}

        {/* Step 4 — default flow only: review */}
        {step === 4 && formData.intent !== "weightloss" && (
          <ReviewStep formData={enriched} onChange={handleChange} labels={labels} intent={formData.intent} />
        )}
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

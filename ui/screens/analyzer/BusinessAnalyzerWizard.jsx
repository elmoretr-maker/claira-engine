/**
 * BusinessAnalyzerWizard.jsx
 *
 * Multi-step intake form for creating or editing a Business Analyzer dataset.
 * Step sequence and labels are driven by intentConfig.js — no hardcoded step arrays.
 *
 * CONSTRAINT: No engine logic here. All transformation is in datasetTransformer.js.
 * runPipeline.js calls the existing engine handlers unchanged.
 */

import { useState, useMemo, useEffect } from "react";
import { getLabels }                    from "../../utils/intentLabels.js";
import { getIntentConfig, getActiveSteps } from "../../utils/intentConfig.js";
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
import { runPipeline }               from "../../utils/runPipeline.js";
import IntentStep                    from "../../components/analyzer/IntentStep.jsx";
import EntitiesStep                  from "../../components/analyzer/EntitiesStep.jsx";
import StateStep                     from "../../components/analyzer/StateStep.jsx";
import ActivityStep                  from "../../components/analyzer/ActivityStep.jsx";
import ModeSelectionStep             from "../../components/analyzer/ModeSelectionStep.jsx";
import OutputTypeStep                from "../../components/analyzer/OutputTypeStep.jsx";
import WellnessIntakeStep            from "../../components/analyzer/WellnessIntakeStep.jsx";
import WellnessModeSelectionStep     from "../../components/analyzer/WellnessModeSelectionStep.jsx";
import GoalStep                      from "../../components/analyzer/GoalStep.jsx";
import ReviewStep                    from "../../components/analyzer/ReviewStep.jsx";
import "../../components/analyzer/BusinessAnalyzer.css";

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

    // Review — name
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

    // Wellness structured intake
    // intakeMode defaults to null so the mode-selection step correctly gates on a choice.
    intakeMode:     initWellness.intakeMode    ?? null,
    baselineIntake: initWellness.baselineIntake ?? createDefaultBaselineIntake(),
    dailyLogs:      initWellness.dailyLogs     ?? [],

    // Phase 2 — non-wellness mode selection and workforce output type
    intentMode:          init.intentMode          ?? null,
    workforceOutputType: init.workforceOutputType ?? null,

    // Phase 4 — goal-based analysis
    goal: init.goal ?? /** @type {{ targetValue: string, targetDate: string }} */ ({}),
  });

  /** @param {object} updates */
  function handleChange(updates) {
    setFormData((prev) => {
      let next = { ...prev, ...updates };

      // Sync metric values ↔ stateValues for wellness
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
          if (v !== undefined) return { ...m, value: v === "" ? "" : String(v) };
          return m;
        });
      }

      // Auto-create default wellness metric row when switching to weightloss
      if (updates.intent === "weightloss" && (!next.metrics || next.metrics.length === 0)) {
        next.metrics = [createDefaultMetricRow()];
      }

      // Reset intent-specific mode fields when intent changes
      if (updates.intent !== undefined && updates.intent !== prev.intent) {
        next.intentMode          = null;
        next.workforceOutputType = null;
        // intakeMode is wellness-specific; reset it too when leaving wellness
        if (updates.intent !== "weightloss") next.intakeMode = null;
      }

      return next;
    });
  }

  // ── Config-driven step system ─────────────────────────────────────────────

  /** Base intent labels. ActivityStep applies output-type overrides internally via getActivityLabels. */
  const labels = useMemo(
    () => getLabels(formData.intent ?? "custom"),
    [formData.intent],
  );

  /** Full intent config for the current intent. */
  const intentConfig = useMemo(
    () => getIntentConfig(formData.intent ?? "custom"),
    [formData.intent],
  );

  /**
   * Active step array — may be a subset of intentConfig.steps when a mode has been
   * selected that removes optional steps (e.g. inventory "quick" skips ActivityStep).
   */
  const STEPS = useMemo(
    () => getActiveSteps(intentConfig, formData),
    // Only recompute when the config or the two mode fields change, not on every keystroke.
    [intentConfig, formData.intakeMode, formData.intentMode],
  );

  // Guard: if the active step array shrinks (e.g. mode switched after advancing),
  // pull the current step back within bounds.
  useEffect(() => {
    if (step > 0 && step >= STEPS.length) {
      setStep(STEPS.length - 1);
    }
  }, [STEPS.length]);

  // ── Parsed entity list ────────────────────────────────────────────────────

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
      datasetName: formData.datasetName || buildDefaultName(formData.intent ?? "custom"),
    }),
    [formData, entities],
  );

  // ── Per-step validation ───────────────────────────────────────────────────

  /** @param {number} s */
  function isStepValid(s) {
    const stepType = STEPS[s];
    if (!stepType) return false;

    switch (stepType) {
      case "intent":
        return !!formData.intent;

      case "modeSelection":
        // Wellness uses intakeMode; all other intents use intentMode
        return formData.intent === "weightloss"
          ? !!formData.intakeMode
          : !!formData.intentMode;

      case "outputType":
        return !!formData.workforceOutputType;

      case "entities":
        return entities.length > 0;

      case "state":
        return entities.some((e) => {
          const v = formData.stateValues[e.entityId];
          return v !== "" && v !== undefined && v !== null &&
                 Number.isFinite(Number(v)) && Number(v) >= 0;
        });

      // goal — always passable (completely optional step)
      case "goal":
        return true;

      // activity, intake, review — always passable (data is optional or auto-suggested)
      default:
        return true;
    }
  }

  // ── Dataset assembly ──────────────────────────────────────────────────────

  function assembleDataset() {
    const intent = formData.intent ?? "custom";
    let resolvedState =
      intent === "weightloss"
        ? resolveWellnessStateValues(formData.metrics ?? [], formData.stateValues)
        : formData.stateValues;

    // Wellness new flow: sync weight from intake form when no manual state entry exists
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

    // For wellness: prefer goal step value; fall back to legacy wellnessGoalWeight field
    const goalN   = Number(formData.goal?.targetValue ?? formData.wellnessGoalWeight);
    const sleepHN = Number(formData.wellnessSleepHours);

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
      // Phase 2 fields — persisted for future use by config-driven output layer
      intentMode:          formData.intentMode          ?? null,
      workforceOutputType: formData.workforceOutputType ?? null,
      // Phase 4 — period dates (for throughput rate in workforce/sales) + goal
      periodStart: formData.periodStart,
      periodEnd:   formData.periodEnd,
      goal: (formData.goal?.targetValue ?? "") !== "" ? formData.goal : null,
      entities,
      snapshots,
      saleEvents,
      deliveryEvents,
      ...(intent === "weightloss"
        ? {
            metrics: serializeWellnessMetricsForStore(formData.metrics ?? [], resolvedState),
            baselineStateValues: formData.baselineStateValues ?? {},
            wellness: {
              goalWeightLb:    Number.isFinite(goalN)   ? goalN   : null,
              sleepBed:        formData.wellnessSleepBed  ?? "",
              sleepWake:       formData.wellnessSleepWake ?? "",
              sleepHours:      Number.isFinite(sleepHN) ? sleepHN : null,
              mealsNote:       formData.wellnessMealsNote  ?? "",
              snacksNote:      formData.wellnessSnacksNote ?? "",
              primaryEntityId: formData.metrics?.[0]?.entityId ?? entities[0]?.entityId ?? "",
              ...(intakeTransform ?? {}),
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
  const stepType   = STEPS[step] ?? "intent";

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

      {/* Progress indicator — step labels come from intentConfig.stepLabels */}
      <div className="ba-progress" role="list" aria-label="Setup steps">
        {STEPS.map((sType, i) => (
          <div
            key={`${sType}-${i}`}
            role="listitem"
            className={[
              "ba-progress__step",
              i === step ? "ba-progress__step--active" : "",
              i  <  step ? "ba-progress__step--done"   : "",
            ].join(" ").trim()}
          >
            <span className="ba-progress__num" aria-hidden="true">{i + 1}</span>
            <span className="ba-progress__label">
              {intentConfig.stepLabels[sType] ?? sType}
            </span>
          </div>
        ))}
      </div>

      {/* Step content — rendered by step type, not by index */}
      <div className="ba-flow__body">

        {stepType === "intent" && (
          <IntentStep value={formData.intent} onChange={handleChange} />
        )}

        {/* Mode selection — wellness uses its own wrapper; others use the generic component */}
        {stepType === "modeSelection" && formData.intent === "weightloss" && (
          <WellnessModeSelectionStep formData={enriched} onChange={handleChange} />
        )}
        {stepType === "modeSelection" && formData.intent !== "weightloss" && (
          <ModeSelectionStep
            prompt="How would you like to get started?"
            helpers={["Choosing a mode helps us show you the right inputs."]}
            cards={intentConfig.modes ?? []}
            value={formData.intentMode ?? null}
            onChange={(selected) => handleChange({ intentMode: selected })}
          />
        )}

        {stepType === "outputType" && (
          <OutputTypeStep formData={enriched} onChange={handleChange} />
        )}

        {stepType === "entities" && (
          <EntitiesStep
            formData={enriched}
            onChange={handleChange}
            labels={labels}
            intent={formData.intent}
          />
        )}

        {stepType === "state" && (
          <StateStep
            formData={enriched}
            onChange={handleChange}
            labels={labels}
            mode={mode}
            intent={formData.intent}
          />
        )}

        {stepType === "activity" && (
          <ActivityStep
            formData={enriched}
            onChange={handleChange}
            labels={labels}
            intent={formData.intent}
          />
        )}

        {stepType === "intake" && (
          <WellnessIntakeStep formData={enriched} onChange={handleChange} />
        )}

        {stepType === "goal" && (
          <GoalStep formData={enriched} onChange={handleChange} />
        )}

        {stepType === "review" && (
          <ReviewStep
            formData={enriched}
            onChange={handleChange}
            labels={labels}
            intent={formData.intent}
          />
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

/**
 * BusinessAnalyzerHome.jsx
 *
 * Home screen for Business Analyzer.
 * Lists saved datasets and provides entry to the wizard (create / edit).
 *
 * FIXES applied (Phase 1 refinements):
 *   Fix 1 — Stale confirmation: datasets older than 7 days show a confirm before running.
 *   Fix 3 — First-time empty state with "Try Sample Dataset" CTA.
 *   Fix 4 — Sample dataset: createSampleDataset() prefills 5 entities with inventory data.
 *   Fix 7 — Renamed: import BusinessAnalyzerWizard (was BusinessAnalyzerFlow).
 *
 * CONSTRAINT: No engine logic here.
 * runPipeline.js feeds data to the EXISTING handlers unchanged.
 * EntityPerformanceScreen is not modified.
 */

import { useState }                        from "react";
import { listDatasets, deleteDataset, saveDataset, daysSince } from "../../utils/datasetStore.js";
import { runPipeline }                     from "../../utils/runPipeline.js";
import { createSampleDataset }             from "../../utils/sampleDataset.js";
import DatasetCard                         from "../../components/analyzer/DatasetCard.jsx";
import BusinessAnalyzerWizard              from "./BusinessAnalyzerWizard.jsx";
import "../../components/analyzer/BusinessAnalyzer.css";

/** Days threshold beyond which a confirmation is required before running analysis. */
const STALE_RUN_THRESHOLD_DAYS = 7;

/**
 * @param {{
 *   onBack:          () => void,
 *   onAnalysisReady: (merged: any[]) => void,
 * }} props
 */
export default function BusinessAnalyzerHome({ onBack, onAnalysisReady }) {
  const [datasets,  setDatasets]  = useState(listDatasets);
  const [wizardMode, setWizardMode] = useState(/** @type {"create"|"edit"|null} */ (null));
  const [editing,   setEditing]   = useState(/** @type {import("../../utils/datasetStore.js").Dataset|null} */ (null));
  const [runningId, setRunningId] = useState(/** @type {string|null} */ (null));
  const [runError,  setRunError]  = useState(/** @type {string|null} */ (null));

  function reload() { setDatasets(listDatasets()); }

  function handleCreate() {
    setEditing(null);
    setWizardMode("create");
  }

  /** Load and save the sample dataset then immediately run analysis on it. */
  async function handleTrySample() {
    setRunError(null);
    const sample = createSampleDataset();
    saveDataset(sample);
    reload();
    setRunningId(sample.datasetId);
    try {
      const merged = await runPipeline(sample);
      onAnalysisReady(merged);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Something went wrong while analyzing the sample dataset. Please try again.");
    } finally {
      setRunningId(null);
    }
  }

  /** @param {import("../../utils/datasetStore.js").Dataset} dataset */
  function handleEdit(dataset) {
    setEditing(dataset);
    setWizardMode("edit");
  }

  /** @param {string} datasetId */
  function handleDelete(datasetId) {
    if (!window.confirm("Delete this dataset? This cannot be undone.")) return;
    deleteDataset(datasetId);
    reload();
  }

  /**
   * Run pipeline on an existing dataset.
   * Fix 1: If the dataset is older than STALE_RUN_THRESHOLD_DAYS, confirm before running.
   *
   * @param {import("../../utils/datasetStore.js").Dataset} dataset
   */
  async function handleRunDirect(dataset) {
    const days = daysSince(dataset.updatedAt);

    // Fix 1 — Stale data confirmation
    if (days !== null && days > STALE_RUN_THRESHOLD_DAYS) {
      const ok = window.confirm(
        `This dataset was last updated ${days} day${days === 1 ? "" : "s"} ago.\n\nResults may not reflect your current situation.\n\nRun analysis anyway?`,
      );
      if (!ok) return;
    }

    setRunError(null);
    setRunningId(dataset.datasetId);
    try {
      const merged = await runPipeline(dataset);
      onAnalysisReady(merged);
    } catch (err) {
      setRunError(
        err instanceof Error
          ? err.message
          : "Something went wrong while analyzing your data. Please try again.",
      );
    } finally {
      setRunningId(null);
    }
  }

  function handleWizardSaved() {
    reload();
    setWizardMode(null);
    setEditing(null);
  }

  function handleWizardAnalysisReady(merged) {
    setWizardMode(null);
    setEditing(null);
    onAnalysisReady(merged);
  }

  // ── Show wizard when active ───────────────────────────────────────────────

  if (wizardMode) {
    return (
      <BusinessAnalyzerWizard
        mode={wizardMode}
        existingDataset={editing}
        onSaved={handleWizardSaved}
        onCancel={() => { setWizardMode(null); setEditing(null); }}
        onAnalysisReady={handleWizardAnalysisReady}
      />
    );
  }

  // ── Home screen ───────────────────────────────────────────────────────────

  const hasSampleRunning = runningId !== null && datasets.every((d) => d.datasetId !== runningId);

  return (
    <div className="ba-home">
      {/* Header */}
      <div className="ba-home__header">
        <button type="button" className="ba-btn ba-btn--ghost ba-home__back" onClick={onBack}>
          ← Back
        </button>

        <div className="ba-home__brand">
          <img
            src="/assets/tool-thumbnails/business-analyzer.png"
            alt="Insight Engine"
            className="ba-home__icon"
          />
          <div>
            <h1 className="ba-home__title">Insight Engine</h1>
            <p className="ba-home__subtitle">
              See what will happen—and how to get where you want
            </p>
          </div>
        </div>

        <button type="button" className="ba-btn ba-btn--primary" onClick={handleCreate}>
          + Create New Dataset
        </button>
      </div>

      {/* Error display */}
      {runError && (
        <div className="ba-error" role="alert">
          {runError}
          <button
            type="button"
            className="ba-btn ba-btn--ghost ba-btn--sm"
            style={{ marginLeft: 12 }}
            onClick={() => setRunError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Dataset list or empty state */}
      <div className="ba-home__body">
        {datasets.length === 0 ? (
          /* Fix 3 — First-time empty state */
          <div className="ba-home__empty">
            <div className="ba-home__empty-title">Get started by creating your first dataset</div>
            <p className="ba-home__empty-text">
              Describe your business and provide your data step by step.
              We'll guide you through it and show you what's working and what needs attention.
            </p>
            <div className="ba-home__empty-actions">
              <button type="button" className="ba-btn ba-btn--primary" onClick={handleCreate}>
                Create Dataset
              </button>
              {/* Fix 4 — Sample dataset */}
              <button
                type="button"
                className="ba-btn ba-btn--ghost"
                onClick={handleTrySample}
                disabled={hasSampleRunning}
              >
                {hasSampleRunning ? "Loading sample…" : "Try Sample Dataset"}
              </button>
            </div>
          </div>
        ) : (
          <div className="ba-dataset-list">
            {datasets.map((dataset) => (
              <DatasetCard
                key={dataset.datasetId}
                dataset={dataset}
                runningId={runningId}
                onRun={handleRunDirect}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

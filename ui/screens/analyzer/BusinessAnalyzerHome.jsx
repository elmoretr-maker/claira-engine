/**
 * BusinessAnalyzerHome.jsx
 *
 * Home screen for Business Analyzer.
 * Lists saved datasets and provides entry to the flow (create / edit).
 * Running analysis from here calls runPipeline → navigates to EntityPerformanceScreen.
 *
 * CONSTRAINT: No engine logic here.
 * runPipeline.js feeds data to the EXISTING handlers unchanged.
 * EntityPerformanceScreen is not modified.
 */

import { useState } from "react";
import { listDatasets, deleteDataset } from "../../utils/datasetStore.js";
import { runPipeline }                 from "../../utils/runPipeline.js";
import DatasetCard                     from "../../components/analyzer/DatasetCard.jsx";
import BusinessAnalyzerFlow            from "./BusinessAnalyzerFlow.jsx";
import "../../components/analyzer/BusinessAnalyzer.css";

/**
 * @param {{
 *   onBack:           () => void,
 *   onAnalysisReady:  (merged: any[]) => void,
 * }} props
 */
export default function BusinessAnalyzerHome({ onBack, onAnalysisReady }) {
  const [datasets,  setDatasets]  = useState(listDatasets);
  const [flowMode,  setFlowMode]  = useState(/** @type {"create"|"edit"|null} */ (null));
  const [editing,   setEditing]   = useState(/** @type {import("../../utils/datasetStore.js").Dataset|null} */ (null));
  const [runningId, setRunningId] = useState(/** @type {string|null} */ (null));
  const [runError,  setRunError]  = useState(/** @type {string|null} */ (null));

  function reload() {
    setDatasets(listDatasets());
  }

  function handleCreate() {
    setEditing(null);
    setFlowMode("create");
  }

  /** @param {import("../../utils/datasetStore.js").Dataset} dataset */
  function handleEdit(dataset) {
    setEditing(dataset);
    setFlowMode("edit");
  }

  /** @param {string} datasetId */
  function handleDelete(datasetId) {
    if (!window.confirm("Delete this dataset? This cannot be undone.")) return;
    deleteDataset(datasetId);
    reload();
  }

  /** Run pipeline on an existing dataset directly from the home screen. */
  async function handleRunDirect(dataset) {
    setRunError(null);
    setRunningId(dataset.datasetId);
    try {
      const merged = await runPipeline(dataset);
      onAnalysisReady(merged);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Analysis failed. Please check your data and try again.");
    } finally {
      setRunningId(null);
    }
  }

  /** Called by flow when dataset is saved (without running analysis). */
  function handleFlowSaved() {
    reload();
    setFlowMode(null);
    setEditing(null);
  }

  /** Called by flow when "Save and Run Analysis" completes successfully. */
  function handleFlowAnalysisReady(merged) {
    setFlowMode(null);
    setEditing(null);
    onAnalysisReady(merged);
  }

  // ── Show the flow screen when active ─────────────────────────────────────

  if (flowMode) {
    return (
      <BusinessAnalyzerFlow
        mode={flowMode}
        existingDataset={editing}
        onSaved={handleFlowSaved}
        onCancel={() => { setFlowMode(null); setEditing(null); }}
        onAnalysisReady={handleFlowAnalysisReady}
      />
    );
  }

  // ── Home screen ───────────────────────────────────────────────────────────

  return (
    <div className="ba-home">
      {/* Header */}
      <div className="ba-home__header">
        <button
          type="button"
          className="ba-btn ba-btn--ghost ba-home__back"
          onClick={onBack}
        >
          ← Back
        </button>

        <div className="ba-home__brand">
          <img
            src="/assets/tool-thumbnails/business-analyzer.png"
            alt="Business Analyzer"
            className="ba-home__icon"
          />
          <div>
            <h1 className="ba-home__title">Business Analyzer</h1>
            <p className="ba-home__subtitle">
              Describe your business and what you want help with.
              We'll guide you to provide the right data, analyze it, and show you what actions to take.
            </p>
          </div>
        </div>

        <button type="button" className="ba-btn ba-btn--primary" onClick={handleCreate}>
          + Create New Dataset
        </button>
      </div>

      {/* Run error */}
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
          <div className="ba-home__empty">
            <div className="ba-home__empty-title">No datasets yet</div>
            <p className="ba-home__empty-text">
              Create your first dataset to start tracking your business and generating insights.
            </p>
            <button type="button" className="ba-btn ba-btn--primary" onClick={handleCreate}>
              Create New Dataset
            </button>
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

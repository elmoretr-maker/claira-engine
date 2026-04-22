/**
 * DatasetCard.jsx
 * Shows a saved dataset with its metadata and action buttons.
 */

import { daysSince, STALE_THRESHOLD_DAYS } from "../../utils/datasetStore.js";
import "./BusinessAnalyzer.css";

/**
 * @param {{
 *   dataset:    import("../../utils/datasetStore.js").Dataset,
 *   runningId:  string | null,
 *   onRun:      (dataset: import("../../utils/datasetStore.js").Dataset) => void,
 *   onEdit:     (dataset: import("../../utils/datasetStore.js").Dataset) => void,
 *   onDelete:   (datasetId: string) => void,
 * }} props
 */
export default function DatasetCard({ dataset, runningId, onRun, onEdit, onDelete }) {
  const { datasetId, name, intentLabel, entities, updatedAt } = dataset;
  const days    = daysSince(updatedAt);
  const isStale = days !== null && days > STALE_THRESHOLD_DAYS;
  const isRunning = runningId === datasetId;

  const entityCount = entities?.length ?? 0;
  const updatedText = days === null  ? "—"
    : days === 0   ? "Updated today"
    : days === 1   ? "Updated 1 day ago"
    : `Updated ${days} days ago`;

  return (
    <div className="ba-dataset-card">
      <div className="ba-dataset-card__info">
        <div className="ba-dataset-card__name">{name}</div>
        <div className="ba-dataset-card__meta">
          <span>{intentLabel}</span>
          <span className="ba-dataset-card__sep">·</span>
          <span>{entityCount} {entityCount === 1 ? "item" : "items"}</span>
          <span className="ba-dataset-card__sep">·</span>
          <span>{updatedText}</span>
          {isStale && (
            <span className="ba-dataset-card__stale">Data may be outdated</span>
          )}
        </div>
      </div>

      <div className="ba-dataset-card__actions">
        <button
          type="button"
          className="ba-btn ba-btn--primary ba-btn--sm"
          onClick={() => onRun(dataset)}
          disabled={!!runningId}
        >
          {isRunning ? "Running…" : "Run Analysis"}
        </button>
        <button
          type="button"
          className="ba-btn ba-btn--ghost ba-btn--sm"
          onClick={() => onEdit(dataset)}
          disabled={!!runningId}
        >
          Edit
        </button>
        <button
          type="button"
          className="ba-btn ba-btn--ghost ba-btn--sm ba-btn--danger"
          onClick={() => onDelete(datasetId)}
          disabled={!!runningId}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

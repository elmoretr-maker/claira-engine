/**
 * datasetStore.js
 *
 * localStorage CRUD for Business Analyzer datasets.
 * Storage key: "claira:datasets"
 *
 * @typedef {{
 *   datasetId:      string,
 *   name:           string,
 *   intent:         string,
 *   intentLabel:    string,
 *   createdAt:      string,
 *   updatedAt:      string,
 *   entities:       Array<{ entityId: string, label: string }>,
 *   snapshots:      Array<{ entityId: string, value: number, timestamp: string }>,
 *   saleEvents:     Array<{ entityId: string, quantity: number, timestamp: string, eventType: "sale" }>,
 *   deliveryEvents: Array<{ entityId: string, quantity: number, timestamp: string, eventType: "delivery" }>,
 * }} Dataset
 */

const STORAGE_KEY = "claira:datasets";

/** @returns {Dataset[]} */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** @param {Dataset[]} datasets */
function persist(datasets) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(datasets));
  } catch {
    // Storage full or unavailable — fail silently
  }
}

/** @returns {Dataset[]} Newest first. */
export function listDatasets() {
  return load();
}

/**
 * @param {string} datasetId
 * @returns {Dataset | null}
 */
export function getDataset(datasetId) {
  return load().find((d) => d.datasetId === datasetId) ?? null;
}

/**
 * Save (create or update) a dataset.
 * Always updates `updatedAt`. Prepends new datasets (newest first).
 *
 * @param {Omit<Dataset, "createdAt" | "updatedAt"> & Partial<Pick<Dataset, "createdAt" | "updatedAt">>} dataset
 * @returns {string} datasetId
 */
export function saveDataset(dataset) {
  const datasets = load();
  const now      = new Date().toISOString();
  const idx      = datasets.findIndex((d) => d.datasetId === dataset.datasetId);

  if (idx >= 0) {
    datasets[idx] = { ...datasets[idx], ...dataset, updatedAt: now };
  } else {
    datasets.unshift({
      ...dataset,
      createdAt: dataset.createdAt ?? now,
      updatedAt: now,
    });
  }

  persist(datasets);
  return dataset.datasetId;
}

/**
 * @param {string} datasetId
 */
export function deleteDataset(datasetId) {
  persist(load().filter((d) => d.datasetId !== datasetId));
}

/** @returns {string} A unique dataset ID. */
export function generateDatasetId() {
  return `ds_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Return the number of whole days since a given ISO timestamp.
 * Returns null if the timestamp is invalid.
 *
 * @param {string} isoTimestamp
 * @returns {number | null}
 */
export function daysSince(isoTimestamp) {
  if (!isoTimestamp) return null;
  const ms = Date.now() - new Date(isoTimestamp).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

/** Datasets older than this many days are considered stale. */
export const STALE_THRESHOLD_DAYS = 30;

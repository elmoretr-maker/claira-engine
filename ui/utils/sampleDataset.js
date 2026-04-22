/**
 * sampleDataset.js
 *
 * Creates a pre-filled sample dataset for first-time Business Analyzer users.
 * Intent: "inventory" — shoe store scenario matching the system's Shoe Store Workflow.
 *
 * Data rules (same as user-created datasets):
 *   - No fabricated data — all values are plausible and pre-chosen
 *   - Event timestamp = periodEnd
 *   - One snapshot per entity (current state)
 */

import { generateDatasetId } from "./datasetStore.js";

/** @returns {string} ISO timestamp for N days ago */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

/**
 * Build and return a sample dataset object ready for saveDataset().
 * Does NOT save to localStorage — caller decides whether to save.
 *
 * @returns {import("./datasetStore.js").Dataset}
 */
export function createSampleDataset() {
  const now      = new Date().toISOString();
  const today    = daysAgo(0);
  const monthEnd = daysAgo(0);

  /** @type {Array<{ entityId: string, label: string }>} */
  const entities = [
    { entityId: "oxford-classic",   label: "Oxford Classic"   },
    { entityId: "running-sneaker",  label: "Running Sneaker"  },
    { entityId: "chelsea-boot",     label: "Chelsea Boot"     },
    { entityId: "loafer-lite",      label: "Loafer Lite"      },
    { entityId: "canvas-high-top",  label: "Canvas High Top"  },
  ];

  /** @type {Array<{ entityId: string, value: number, timestamp: string }>} */
  const snapshots = [
    { entityId: "oxford-classic",  value: 42, timestamp: today },
    { entityId: "running-sneaker", value: 18, timestamp: today },
    { entityId: "chelsea-boot",    value: 76, timestamp: today },
    { entityId: "loafer-lite",     value: 9,  timestamp: today },
    { entityId: "canvas-high-top", value: 55, timestamp: today },
  ];

  /** @type {Array<{ entityId: string, quantity: number, timestamp: string, eventType: "sale" }>} */
  const saleEvents = [
    { entityId: "oxford-classic",  quantity: 22, timestamp: monthEnd, eventType: "sale" },
    { entityId: "running-sneaker", quantity: 38, timestamp: monthEnd, eventType: "sale" },
    { entityId: "chelsea-boot",    quantity: 9,  timestamp: monthEnd, eventType: "sale" },
    { entityId: "loafer-lite",     quantity: 27, timestamp: monthEnd, eventType: "sale" },
    { entityId: "canvas-high-top", quantity: 14, timestamp: monthEnd, eventType: "sale" },
  ];

  /** @type {Array<{ entityId: string, quantity: number, timestamp: string, eventType: "delivery" }>} */
  const deliveryEvents = [
    { entityId: "oxford-classic",  quantity: 12, timestamp: monthEnd, eventType: "delivery" },
    { entityId: "running-sneaker", quantity: 0,  timestamp: monthEnd, eventType: "delivery" },
    { entityId: "chelsea-boot",    quantity: 24, timestamp: monthEnd, eventType: "delivery" },
    { entityId: "loafer-lite",     quantity: 0,  timestamp: monthEnd, eventType: "delivery" },
    { entityId: "canvas-high-top", quantity: 18, timestamp: monthEnd, eventType: "delivery" },
  ].filter((e) => e.quantity > 0); // Exclude zero-quantity events (matches buildEvents rule)

  const d    = new Date();
  const name = `Sample — Shoe Store Inventory ${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`;

  return {
    datasetId:     generateDatasetId(),
    name,
    intent:        "inventory",
    intentLabel:   "Track my inventory",
    createdAt:     now,
    updatedAt:     now,
    entities,
    snapshots,
    saleEvents,
    deliveryEvents,
  };
}

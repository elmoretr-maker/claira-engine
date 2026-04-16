/**
 * Passive in-memory correction log for session UX (e.g. place-card learning_hint).
 * Not classifier / embedding state — durable label learning is references/user via persistReferenceLearning.
 */

/** @type {Map<string, { count: number, sumConfidence: number }>} */
const buckets = new Map();
let globalCorrectionTotal = 0;

function norm(s) {
  return String(s ?? "").trim();
}

function keyFor(pred, sel) {
  return `${norm(pred)}→${norm(sel)}`;
}

/**
 * Record a human correction when the chosen label differs from the model prediction.
 * @param {string|null|undefined} predicted_label
 * @param {string|null|undefined} selected_label
 * @param {{ confidence?: number }} [opts] — optional model confidence at decision time (0–1)
 */
export function recordCorrection(predicted_label, selected_label, opts = {}) {
  const pred = norm(predicted_label);
  const sel = norm(selected_label);
  if (!pred || !sel || pred === sel) return;

  globalCorrectionTotal += 1;
  const k = keyFor(pred, sel);
  const cur = buckets.get(k) ?? { count: 0, sumConfidence: 0 };
  cur.count += 1;
  const c =
    opts.confidence != null && Number.isFinite(Number(opts.confidence))
      ? Number(opts.confidence)
      : 0;
  cur.sumConfidence += c;
  buckets.set(k, cur);
}

/**
 * @param {string|null|undefined} predicted_label
 * @param {string|null|undefined} selected_label — user/chosen label; when equal to predicted (typical when routing resolves), aggregates all past corrections *from* that prediction
 * @returns {{ count: number, total: number, confidence: number } | null}
 */
export function getLearningStats(predicted_label, selected_label) {
  const pred = norm(predicted_label);
  const sel = norm(selected_label);
  if (!pred) return null;

  if (!sel || pred === sel) {
    let count = 0;
    let sumConfidence = 0;
    const prefix = `${pred}→`;
    for (const [k, cur] of buckets) {
      if (k.startsWith(prefix)) {
        count += cur.count;
        sumConfidence += cur.sumConfidence;
      }
    }
    if (count < 1) return null;
    return {
      count,
      total: globalCorrectionTotal,
      confidence: Number(Number(sumConfidence / count).toFixed(6)),
    };
  }

  const cur = buckets.get(keyFor(pred, sel));
  if (!cur || cur.count < 1) return null;
  const confidence = cur.sumConfidence / cur.count;
  return {
    count: cur.count,
    total: globalCorrectionTotal,
    confidence: Number(Number(confidence).toFixed(6)),
  };
}

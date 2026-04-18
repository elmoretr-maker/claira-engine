/**
 * Deterministic trend / anomaly helpers for multi-year tax value series (no I/O).
 */

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function asFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * @param {(number | null | undefined)[]} values
 * @returns {{ trend: string, avgGrowth: number | null }}
 */
export function computeTrendAndAvgGrowth(values) {
  const nums = values.map((v) => asFiniteNumber(v));
  const numeric = nums.filter((v) => v != null);
  if (numeric.length < 2) {
    return { trend: "insufficient", avgGrowth: null };
  }

  /** @type {number[]} */
  const pctSteps = [];
  for (let i = 0; i < nums.length - 1; i++) {
    const a = nums[i];
    const b = nums[i + 1];
    if (a == null || b == null) continue;
    if (a === 0) continue;
    pctSteps.push(((b - a) / Math.abs(a)) * 100);
  }

  const avgGrowth =
    pctSteps.length > 0 ? Number((pctSteps.reduce((s, x) => s + x, 0) / pctSteps.length).toFixed(4)) : null;

  const epsRatio = 0.0005;
  let sawPair = false;
  let allUp = true;
  let allDown = true;
  let allFlat = true;

  for (let i = 0; i < nums.length - 1; i++) {
    const a = nums[i];
    const b = nums[i + 1];
    if (a == null || b == null) continue;
    sawPair = true;
    const d = b - a;
    const threshold = Math.max(1e-9, Math.abs(a) * epsRatio);
    if (d > threshold) allDown = false;
    if (d < -threshold) allUp = false;
    if (Math.abs(d) > threshold) allFlat = false;
  }

  if (!sawPair) {
    return { trend: "insufficient", avgGrowth };
  }
  if (allFlat) {
    return { trend: "flat", avgGrowth };
  }
  if (allUp && !allDown) {
    return { trend: "increasing", avgGrowth };
  }
  if (allDown && !allUp) {
    return { trend: "decreasing", avgGrowth };
  }
  return { trend: "mixed", avgGrowth };
}

/**
 * Flags the largest consecutive relative move when it exceeds thresholdPct.
 * @param {(number | null | undefined)[]} values
 * @param {number} [thresholdPct]
 * @returns {{ anomaly: boolean, message: string }}
 */
export function detectSeriesAnomaly(values, thresholdPct = 50) {
  const nums = values.map((v) => asFiniteNumber(v));
  const thr =
    typeof thresholdPct === "number" && Number.isFinite(thresholdPct) && thresholdPct > 0 ? thresholdPct : 50;

  let worstPct = 0;
  /** @type {string} */
  let worstMsg = "";

  for (let i = 0; i < nums.length - 1; i++) {
    const a = nums[i];
    const b = nums[i + 1];
    if (a == null || b == null) continue;

    let pct = 0;
    if (a === 0) {
      if (b !== 0) pct = Infinity;
    } else {
      pct = Math.abs(((b - a) / a) * 100);
    }

    if (pct > worstPct) {
      worstPct = pct;
      const dir = b > a ? "increased" : "decreased";
      worstMsg =
        !Number.isFinite(pct) || a === 0
          ? `Large change from ${a} to ${b} between period ${i + 1} and ${i + 2}`
          : `Value ${dir} by ${Number(pct.toFixed(1))}% from period ${i + 1} to ${i + 2}`;
    }
  }

  if (worstPct > thr || worstPct === Infinity) {
    return { anomaly: true, message: worstMsg || `Change exceeds ${thr}% threshold` };
  }
  return { anomaly: false, message: "" };
}

/**
 * First vs last non-null numeric values (by index order).
 * @param {(number | null | undefined)[]} values
 * @returns {{ delta: number | null, percentChange: number | null }}
 */
export function firstLastDelta(values) {
  const nums = values.map((v) => asFiniteNumber(v));
  const fi = nums.findIndex((v) => v != null);
  const li = nums.length - 1 - [...nums].reverse().findIndex((v) => v != null);
  if (fi === -1 || li === -1 || fi === li) {
    return { delta: null, percentChange: null };
  }
  const a = nums[fi];
  const b = nums[li];
  if (a == null || b == null) {
    return { delta: null, percentChange: null };
  }
  const delta = Number((b - a).toFixed(4));
  const percentChange = a === 0 ? null : Number((((b - a) / a) * 100).toFixed(4));
  return { delta, percentChange };
}

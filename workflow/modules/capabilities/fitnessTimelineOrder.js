/**
 * Deterministic ordering for fitness timeline stage folder names (no I/O).
 * Priority: before-like → numeric (week_1 < week_10) → middle alphabetical → after/final-like.
 */

/**
 * @param {string} name
 * @returns {{ bucket: number, num: number, label: string }}
 */
function stageSortMeta(name) {
  const label = String(name ?? "").trim();
  const lower = label.toLowerCase();

  const isBefore =
    lower === "before" ||
    lower.startsWith("before_") ||
    /^before[^a-z0-9]/i.test(label) ||
    lower === "baseline" ||
    lower.startsWith("baseline_");
  if (isBefore) {
    return { bucket: 0, num: -1, label };
  }

  const isLast =
    lower === "after" ||
    lower.startsWith("after_") ||
    lower === "final" ||
    lower.startsWith("final_") ||
    lower.endsWith("_final") ||
    lower.endsWith("_after") ||
    /\b(final|after)\b/.test(lower);
  if (isLast) {
    return { bucket: 2, num: Number.MAX_SAFE_INTEGER, label };
  }

  const weekM = lower.match(/(?:^|[^a-z0-9])week[^a-z0-9]*(\d+)/);
  if (weekM) {
    const n = Number.parseInt(weekM[1], 10);
    return { bucket: 1, num: Number.isFinite(n) ? n : 1e9, label };
  }

  const anyM = lower.match(/(\d+)/);
  if (anyM) {
    const n = Number.parseInt(anyM[1], 10);
    if (Number.isFinite(n)) {
      return { bucket: 1, num: n, label };
    }
  }

  return { bucket: 1, num: 1e9, label };
}

/**
 * @param {{ name: string }} a
 * @param {{ name: string }} b
 * @returns {number}
 */
export function compareFitnessStageNames(a, b) {
  const ma = stageSortMeta(a.name);
  const mb = stageSortMeta(b.name);
  if (ma.bucket !== mb.bucket) return ma.bucket - mb.bucket;
  if (ma.num !== mb.num) return ma.num - mb.num;
  return ma.label.localeCompare(mb.label);
}

/**
 * @template T
 * @param {Array<T & { name: string }>} stages
 * @returns {T[]}
 */
export function orderFitnessStages(stages) {
  return [...stages].sort(compareFitnessStageNames);
}

/**
 * @param {string[]} names
 * @returns {string[]}
 */
export function orderedFitnessStageNames(names) {
  return orderFitnessStages(names.map((name) => ({ name }))).map((s) => s.name);
}

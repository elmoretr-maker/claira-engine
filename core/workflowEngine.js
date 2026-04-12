/**
 * Workflow comparison: expected vs actual lists (string or lightweight structured items).
 * No ML — normalization, overlap, and keyword contradiction checks only.
 */

/** @type {ReadonlyArray<readonly [string, string]>} */
const CONTRADICTION_WORD_PAIRS = [
  ["left", "right"],
  ["north", "south"],
  ["east", "west"],
  ["increase", "decrease"],
  ["accept", "reject"],
  ["yes", "no"],
  ["up", "down"],
  ["on", "off"],
];

const MATCH_JACCARD = 0.42;
const MIN_JACCARD = 0.12;
const UNCERTAIN_HIGH = 0.42;
const UNCERTAIN_LOW = 0.18;
const AMBIGUITY_DELTA = 0.08;

/**
 * @param {unknown} item
 * @returns {string}
 */
export function workflowItemToString(item) {
  if (item == null) return "";
  if (typeof item === "string") return item;
  if (typeof item === "number" && Number.isFinite(item)) return String(item);
  if (typeof item === "object" && !Array.isArray(item)) {
    const o = /** @type {Record<string, unknown>} */ (item);
    for (const key of ["id", "name", "path", "label", "rel", "file", "key"]) {
      const v = o[key];
      if (typeof v === "string" && v.length) return v;
    }
    try {
      return JSON.stringify(o);
    } catch {
      return String(item);
    }
  }
  return String(item);
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeWorkflowText(raw) {
  return String(raw)
    .toLowerCase()
    .trim()
    .replace(/[.,;:!?'"()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} normalized
 * @returns {Set<string>}
 */
function wordSet(normalized) {
  return new Set(normalized.split(" ").filter(Boolean));
}

/**
 * @param {string} aNorm
 * @param {string} bNorm
 * @returns {number}
 */
function jaccardWords(aNorm, bNorm) {
  const A = wordSet(aNorm);
  const B = wordSet(bNorm);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) {
    if (B.has(w)) inter += 1;
  }
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * @param {string} aNorm
 * @param {string} bNorm
 * @returns {boolean}
 */
function includesEitherWay(aNorm, bNorm) {
  if (!aNorm || !bNorm) return aNorm === bNorm;
  return aNorm === bNorm || aNorm.includes(bNorm) || bNorm.includes(aNorm);
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} aNorm
 * @param {string} bNorm
 * @returns {boolean}
 */
function hasContradiction(aNorm, bNorm) {
  for (const [w1, w2] of CONTRADICTION_WORD_PAIRS) {
    const re1 = new RegExp(`\\b${escapeRe(w1)}\\b`, "i");
    const re2 = new RegExp(`\\b${escapeRe(w2)}\\b`, "i");
    const aHas1 = re1.test(aNorm);
    const aHas2 = re2.test(aNorm);
    const bHas1 = re1.test(bNorm);
    const bHas2 = re2.test(bNorm);
    if ((aHas1 && bHas2) || (aHas2 && bHas1)) return true;
  }
  return false;
}

/**
 * @param {string} eNorm
 * @param {string} aNorm
 * @returns {number}
 */
function similarityScore(eNorm, aNorm) {
  const j = jaccardWords(eNorm, aNorm);
  if (includesEitherWay(eNorm, aNorm)) return Math.max(j, 0.85);
  return j;
}

/**
 * Compare expected vs actual workflow items.
 * @param {unknown[]} expected
 * @param {unknown[]} actual
 * @returns {{
 *   matched: Array<{ expected: unknown, actual: unknown }>,
 *   missing: Array<{ expected: unknown }>,
 *   conflicting: Array<{ expected: unknown, actual: unknown }>,
 *   uncertain: Array<{ expected: unknown, actual?: unknown }>,
 * }}
 */
export function compareWorkflow(expected, actual) {
  const expArr = Array.isArray(expected) ? expected : [];
  const actArr = Array.isArray(actual) ? actual : [];

  /** @type {Array<{ raw: unknown, norm: string }>} */
  const expNorm = expArr.map((raw) => ({
    raw,
    norm: normalizeWorkflowText(workflowItemToString(raw)),
  }));
  /** @type {Array<{ raw: unknown, norm: string }>} */
  const actNorm = actArr.map((raw) => ({
    raw,
    norm: normalizeWorkflowText(workflowItemToString(raw)),
  }));

  /** @type {Array<{ expected: unknown, actual: unknown }>} */
  const matched = [];
  /** @type {Array<{ expected: unknown }>} */
  const missing = [];
  /** @type {Array<{ expected: unknown, actual: unknown }>} */
  const conflicting = [];
  /** @type {Array<{ expected: unknown, actual?: unknown }>} */
  const uncertain = [];

  for (const e of expNorm) {
    /** @type {Array<{ raw: unknown, norm: string, score: number, j: number }>} */
    const scored = actNorm.map((a) => {
      const j = jaccardWords(e.norm, a.norm);
      const score = similarityScore(e.norm, a.norm);
      return { raw: a.raw, norm: a.norm, score, j };
    });
    scored.sort((x, y) => y.score - x.score);

    const best = scored[0];
    const second = scored[1];

    let conflictPair = null;
    for (const row of scored) {
      if (row.j < MIN_JACCARD && row.score < UNCERTAIN_LOW) continue;
      if (hasContradiction(e.norm, row.norm)) {
        conflictPair = { expected: e.raw, actual: row.raw };
        break;
      }
    }
    if (conflictPair) {
      conflicting.push(conflictPair);
      continue;
    }

    if (!best || best.score < MIN_JACCARD) {
      missing.push({ expected: e.raw });
      continue;
    }

    const strongMatch = best.score >= MATCH_JACCARD || includesEitherWay(e.norm, best.norm);

    const ambiguousTopTwo =
      second != null &&
      best.score >= UNCERTAIN_LOW &&
      second.score >= UNCERTAIN_LOW &&
      best.score - second.score <= AMBIGUITY_DELTA &&
      !strongMatch;

    if (ambiguousTopTwo) {
      uncertain.push({ expected: e.raw, actual: best.raw });
      continue;
    }

    if (strongMatch) {
      matched.push({ expected: e.raw, actual: best.raw });
      continue;
    }

    if (best.score >= UNCERTAIN_LOW && best.score < UNCERTAIN_HIGH) {
      uncertain.push({ expected: e.raw, actual: best.raw });
      continue;
    }

    missing.push({ expected: e.raw });
  }

  return { matched, missing, conflicting, uncertain };
}

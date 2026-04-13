/**
 * Reference-embedding classification (cosine vs label pools + softmax ranking).
 * Pure math — no I/O. Mirrors tools/smart_catalog.mjs unified-ingest scoring only.
 */

/** Same as smart_catalog VISUAL_SOFTMAX_TEMPERATURE — used for softmax over cosine map (reporting / ordering). */
export const DEFAULT_SOFTMAX_TEMPERATURE = 12;

/**
 * @typedef {{ v: Float32Array, source: string, meta?: string }} TaggedRef
 */

/**
 * @param {string} s
 */
function sourceTieRank(s) {
  if (s === "user") return 3;
  if (s === "base" || s === "base_asset") return 2;
  if (s === "text") return 1;
  return 0;
}

/**
 * Normalize legacy `Map<label, Float32Array[]>` into tagged refs (source "base").
 * @param {Map<string, Float32Array[] | TaggedRef[]>} map
 * @returns {Map<string, TaggedRef[]>}
 */
export function normalizeReferenceEmbeddingMap(map) {
  /** @type {Map<string, TaggedRef[]>} */
  const out = new Map();
  for (const [label, arr] of map) {
    if (!arr?.length) continue;
    const first = arr[0];
    if (first instanceof Float32Array) {
      /** @type {Float32Array[]} */
      const vecs = /** @type {Float32Array[]} */ (arr);
      out.set(
        label,
        vecs.map((v) => ({ v, source: "base" })),
      );
    } else {
      out.set(label, /** @type {TaggedRef[]} */ (arr.slice()));
    }
  }
  return out;
}

/**
 * @param {Float32Array | number[]} vec
 * @returns {Float32Array}
 */
export function l2NormalizeFloat32(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / n;
  return out;
}

/**
 * @param {{ data: Float32Array | number[] }} tensor
 * @returns {Float32Array|null}
 */
export function embeddingFromRawTensor(tensor) {
  const data = tensor?.data;
  if (!data || !data.length) return null;
  const copy = new Float32Array(data.length);
  copy.set(data);
  return l2NormalizeFloat32(copy);
}

/**
 * Per label: max cosine (dot product on L2-normalized vectors).
 * @param {Float32Array} inputNorm
 * @param {Map<string, Float32Array[]>} byLabel
 * @returns {Map<string, number>}
 */
export function maxCosineByLabel(inputNorm, byLabel) {
  const tagged = normalizeReferenceEmbeddingMap(
    /** @type {Map<string, Float32Array[] | TaggedRef[]>} */ (byLabel),
  );
  const { scores } = maxCosineByLabelTagged(inputNorm, tagged);
  return scores;
}

/**
 * Per label: max cosine over tagged refs; tie-break prefers user > base > text.
 * @param {Float32Array} inputNorm
 * @param {Map<string, TaggedRef[]>} byLabel
 * @returns {{ scores: Map<string, number>, sourceByLabel: Map<string, string> }}
 */
export function maxCosineByLabelTagged(inputNorm, byLabel) {
  /** @type {Map<string, number>} */
  const scores = new Map();
  /** @type {Map<string, string>} */
  const sourceByLabel = new Map();
  for (const [label, refs] of byLabel) {
    let maxS = -Infinity;
    let bestSource = "text";
    for (const ref of refs) {
      const v = ref.v;
      let dot = 0;
      for (let i = 0; i < inputNorm.length; i++) dot += inputNorm[i] * v[i];
      const rnk = sourceTieRank(ref.source);
      if (
        dot > maxS ||
        (dot === maxS && rnk > sourceTieRank(bestSource))
      ) {
        maxS = dot;
        bestSource = ref.source;
      }
    }
    scores.set(label, maxS);
    sourceByLabel.set(label, bestSource);
  }
  return { scores, sourceByLabel };
}

/**
 * @param {Map<string, number>} cosineMap
 * @param {number} temperature
 * @returns {Map<string, number>}
 */
export function cosineMapToSoftmaxProbs(cosineMap, temperature) {
  const labels = [...cosineMap.keys()].sort();
  if (!labels.length) return new Map();
  const logits = labels.map((l) => (cosineMap.get(l) ?? 0) * temperature);
  const maxL = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - maxL));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const probs = new Map();
  labels.forEach((l, i) => probs.set(l, exps[i] / sum));
  return probs;
}

/**
 * @param {Map<string, number>} visualProbs
 * @returns {Array<{ id: string, confidence: number }>}
 */
export function softmaxMapToRankedArray(visualProbs) {
  return [...visualProbs.entries()]
    .map(([id, confidence]) => ({ id, confidence }))
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * @param {Array<{ id: string, confidence: number }>} ranked
 * @returns {Array<{ id: string, confidence: number }>}
 */
export function takeTop3(ranked) {
  return ranked.slice(0, 3).map((r) => ({
    id: r.id,
    confidence: r.confidence,
  }));
}

/**
 * Build standardized classification from L2 input embedding and reference pools.
 *
 * @param {{
 *   inputEmbedding: Float32Array,
 *   referenceEmbeddingsByLabel: Map<string, Float32Array[] | TaggedRef[]>,
 *   softmaxTemperature?: number
 * }} params
 * @returns {{
 *   predicted_label: string | null,
 *   second_label: string | null,
 *   alternatives: Array<{ label: string, score: number }>,
 *   confidence: number,
 *   margin: number,
 *   match_source: string,
 *   visualCosineTop3: Array<{ id: string, cosine: number }>,
 *   softmaxTop3: Array<{ id: string, confidence: number }>
 * }}
 */
export function classifyFromReferenceEmbeddings({
  inputEmbedding,
  referenceEmbeddingsByLabel,
  softmaxTemperature = DEFAULT_SOFTMAX_TEMPERATURE,
}) {
  const inputNorm = l2NormalizeFloat32(inputEmbedding);
  const tagged = normalizeReferenceEmbeddingMap(
    /** @type {Map<string, Float32Array[] | TaggedRef[]>} */ (referenceEmbeddingsByLabel),
  );
  const { scores: cosByLabel, sourceByLabel } = maxCosineByLabelTagged(inputNorm, tagged);

  const sortedCos = [...cosByLabel.entries()].sort((a, b) => b[1] - a[1]);
  const bestC = sortedCos[0]?.[1] ?? 0;
  const secondC = sortedCos[1]?.[1] ?? null;
  const marginCos = secondC != null ? bestC - secondC : bestC;
  const chosenLabel = sortedCos[0]?.[0] ?? null;
  const secondLabel = sortedCos[1]?.[0] ?? null;
  const match_source =
    chosenLabel != null ? (sourceByLabel.get(chosenLabel) ?? "unknown") : "none";

  const visProbs = cosineMapToSoftmaxProbs(cosByLabel, softmaxTemperature);
  const ranked = softmaxMapToRankedArray(visProbs);
  const softmaxTop3 = takeTop3(ranked);

  const visualCosineTop3 = sortedCos.slice(0, 3).map(([id, cosine]) => ({
    id,
    cosine,
  }));

  const alternatives = visualCosineTop3.map(({ id, cosine }) => ({
    label: id,
    score: cosine,
  }));

  return {
    predicted_label: chosenLabel,
    second_label: secondLabel ?? null,
    alternatives,
    confidence: bestC,
    margin: marginCos,
    match_source,
    visualCosineTop3,
    softmaxTop3,
  };
}

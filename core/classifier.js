/**
 * Reference-embedding classification (cosine vs label pools + softmax ranking).
 * Pure math — no I/O. Mirrors tools/smart_catalog.mjs unified-ingest scoring only.
 */

/** Same as smart_catalog VISUAL_SOFTMAX_TEMPERATURE — used for softmax over cosine map (reporting / ordering). */
export const DEFAULT_SOFTMAX_TEMPERATURE = 12;

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
  const scores = new Map();
  for (const [label, vecs] of byLabel) {
    let maxS = -Infinity;
    for (const v of vecs) {
      let dot = 0;
      for (let i = 0; i < inputNorm.length; i++) dot += inputNorm[i] * v[i];
      if (dot > maxS) maxS = dot;
    }
    scores.set(label, maxS);
  }
  return scores;
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
 *   referenceEmbeddingsByLabel: Map<string, Float32Array[]>,
 *   softmaxTemperature?: number
 * }} params
 * @returns {{
 *   predicted_label: string | null,
 *   alternatives: Array<{ label: string, score: number }>,
 *   confidence: number,
 *   margin: number,
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
  const cosByLabel = maxCosineByLabel(inputNorm, referenceEmbeddingsByLabel);

  const sortedCos = [...cosByLabel.entries()].sort((a, b) => b[1] - a[1]);
  const bestC = sortedCos[0]?.[1] ?? 0;
  const secondC = sortedCos[1]?.[1] ?? null;
  const marginCos = secondC != null ? bestC - secondC : bestC;
  const chosenLabel = sortedCos[0]?.[0] ?? null;
  const secondLabel = sortedCos[1]?.[0] ?? null;

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
    visualCosineTop3,
    softmaxTop3,
  };
}

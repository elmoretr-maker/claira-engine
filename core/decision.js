/**
 * Review vs auto decision from raw cosine confidence and margin (unified-ingest style).
 * Pure — no file I/O. Optional routing gate mirrors smart_catalog when `hasRoutingDestination` is false.
 */

/** Pairs where low margin is flagged as high_conflict (same as smart_catalog UNIFIED_HIGH_CONFLICT_COSINE_PAIRS). */
export const DEFAULT_HIGH_CONFLICT_PAIRS = new Set([
  ["debris", "prop"].sort().join("|"),
  ["obstacle", "prop"].sort().join("|"),
  ["debris", "terrain"].sort().join("|"),
  ["road", "terrain"].sort().join("|"),
]);

/**
 * @param {string|null|undefined} top1
 * @param {string|null|undefined} top2
 * @param {Set<string>} [pairSet]
 */
export function isHighConflictCosineTop2(top1, top2, pairSet = DEFAULT_HIGH_CONFLICT_PAIRS) {
  if (top1 == null || top2 == null) return false;
  const k = [String(top1).toLowerCase(), String(top2).toLowerCase()].sort().join("|");
  return pairSet.has(k);
}

/**
 * @param {{
 *   predicted_label: string | null,
 *   second_label?: string | null,
 *   confidence: number,
 *   margin: number,
 *   thresholds: { confidence: number, margin: number },
 *   hasRoutingDestination?: boolean
 * }} input
 * @returns {{ decision: 'auto' | 'review' | 'error', reason: string }}
 */
export function decide(input) {
  const {
    predicted_label: chosenLabel,
    second_label: secondLabel,
    confidence: bestC,
    margin: marginCos,
    thresholds,
    hasRoutingDestination = true,
  } = input;

  const minConf = thresholds.confidence;
  const minMargin = thresholds.margin;

  if (!chosenLabel) {
    return { decision: "error", reason: "no_labels" };
  }

  if (hasRoutingDestination === false) {
    return { decision: "review", reason: "unknown_label_destination" };
  }

  if (bestC < minConf || marginCos < minMargin) {
    const marginFail = marginCos < minMargin;
    const cosFail = bestC < minConf;
    if (
      !cosFail &&
      marginFail &&
      isHighConflictCosineTop2(chosenLabel, secondLabel)
    ) {
      return { decision: "review", reason: "high_conflict_low_margin" };
    }
    return { decision: "review", reason: "unified_low_confidence_or_ambiguous" };
  }

  return { decision: "auto", reason: "unified_reference_confident" };
}

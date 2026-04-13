/**
 * Review vs auto decision from raw cosine confidence and margin (unified-ingest style).
 * Pure — no I/O. No label-pair tables; only thresholds + routing gate.
 */

/**
 * @param {{
 *   predicted_label: string | null,
 *   second_label?: string | null,
 *   confidence: number,
 *   margin: number,
 *   thresholds: { confidence: number, margin: number },
 *   hasRoutingDestination?: boolean,
 *   potential_conflict?: boolean
 * }} input
 * @returns {{ decision: 'auto' | 'review' | 'error', reason: string }}
 */
export function decide(input) {
  const {
    predicted_label: chosenLabel,
    confidence: bestC,
    margin: marginCos,
    thresholds,
    hasRoutingDestination = true,
    potential_conflict = false,
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
    return { decision: "review", reason: "unified_low_confidence_or_ambiguous" };
  }

  if (potential_conflict === true) {
    return { decision: "review", reason: "reference_potential_conflict" };
  }

  return { decision: "auto", reason: "unified_reference_confident" };
}

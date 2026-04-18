/**
 * Merge visual comparison insight with contractor cost signals (no tax/fitness imports).
 */

/**
 * @param {{ roomLabel?: string, insightLabel?: string, overBudget?: boolean, budgetDelta?: number, percentChange?: number | null }} p
 * @returns {string}
 */
export function buildContractorCombinedInsight(p) {
  const room = String(p.roomLabel ?? "This room").trim() || "This room";
  const insight = String(p.insightLabel ?? "").trim();
  let progressPhrase = "progress recorded";
  if (insight === "Significant transformation") progressPhrase = "significant visual progress";
  else if (insight === "Moderate progress") progressPhrase = "moderate visual progress";
  else if (insight === "Minimal change") progressPhrase = "minimal progress detected";

  const delta = typeof p.budgetDelta === "number" && Number.isFinite(p.budgetDelta) ? p.budgetDelta : 0;
  const over = Boolean(p.overBudget);
  const fmt = (n) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
      Math.abs(n),
    );

  let out = `${room}: ${progressPhrase}`;
  if (over && delta > 0) {
    out += `, but exceeded budget by ${fmt(delta)}`;
    if (p.percentChange != null && Number.isFinite(p.percentChange)) {
      out += ` (${p.percentChange > 0 ? "+" : ""}${p.percentChange}% vs initial)`;
    }
  } else if (!over && delta < 0) {
    out += `, under budget by ${fmt(delta)}`;
  } else {
    out += ", on track with budget";
  }
  return out;
}

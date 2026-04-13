import "./RiskInsightsBanner.css";

/**
 * @param {{
 *   insights: {
 *     categories?: Array<{
 *       label: string,
 *       riskLevel: string,
 *       maxPenalty?: number,
 *       recentExamples?: string[],
 *       fingerprints?: unknown[],
 *     }>,
 *     confusionPairs?: Array<{ predicted: string, selected: string, count: number }>,
 *   } | null,
 *   categoryFilter?: string[] | null,
 * }} props
 */
export default function RiskInsightsBanner({ insights, categoryFilter = null }) {
  if (!insights || typeof insights !== "object") return null;

  let categories = Array.isArray(insights.categories) ? insights.categories : [];
  let pairs = Array.isArray(insights.confusionPairs) ? insights.confusionPairs : [];

  if (Array.isArray(categoryFilter) && categoryFilter.length > 0) {
    const allow = new Set(categoryFilter.map((x) => String(x).trim()).filter(Boolean));
    categories = categories.filter((c) => allow.has(String(c.label ?? "").trim()));
    pairs = pairs.filter((p) => allow.has(String(p.predicted ?? "").trim()) || allow.has(String(p.selected ?? "").trim()));
  }

  if (categories.length === 0 && pairs.length === 0) return null;

  const high = categories.filter((c) => c.riskLevel === "high");
  const medium = categories.filter((c) => c.riskLevel === "medium");

  let headline = "";
  if (high.length > 0) {
    headline = `High-risk categor${high.length === 1 ? "y" : "ies"} — recent misclassifications detected (${high.map((c) => c.label).join(", ")}).`;
  } else if (medium.length > 0) {
    headline = `Elevated risk signals: ${medium.map((c) => c.label).join(", ")}.`;
  } else if (categories.length > 0) {
    headline = `Risk memory active for: ${categories.map((c) => `${c.label} (${c.riskLevel})`).join(", ")}.`;
  }

  const topExamples = categories
    .flatMap((c) => (Array.isArray(c.recentExamples) ? c.recentExamples.slice(0, 2).map((ex) => ({ label: c.label, ex })) : []))
    .slice(0, 4);

  const topPairs = pairs.filter((p) => p.count >= 2).slice(0, 4);

  return (
    <div className="risk-insights-banner" role="status">
      <span className="risk-insights-icon" aria-hidden="true">
        {"\u26A0\uFE0F"}
      </span>
      <div className="risk-insights-body">
        {headline ? <p className="risk-insights-headline">{headline}</p> : null}
        {topExamples.length > 0 ? (
          <ul className="risk-insights-list">
            {topExamples.map((row, i) => (
              <li key={`ex-${i}`}>
                <strong>{row.label}:</strong> <span className="risk-insights-excerpt">{row.ex}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {topPairs.length > 0 ? (
          <p className="risk-insights-confusion">
            Frequent confusion pairs:{" "}
            {topPairs.map((p) => `${p.predicted} → ${p.selected} (×${p.count})`).join("; ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

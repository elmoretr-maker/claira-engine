/**
 * Optional industry-specific framing for progress narratives (API only).
 * Core tracking math stays domain-agnostic; this layer is for integrations and prompts.
 */

/**
 * @param {string} slug
 */
export function interpretationForIndustry(slug) {
  const s = String(slug ?? "").trim().toLowerCase();
  if (/fit|gym|yoga|physique|wellness|training|coach/.test(s)) {
    return { domainKey: "fitness", progressSummaryHint: "Physical change over time" };
  }
  if (/med|clinic|health|patient|hospital|dental|vet/.test(s)) {
    return { domainKey: "medical", progressSummaryHint: "Recovery and visit comparisons over time" };
  }
  if (/construct|build|contract|site|trades/.test(s)) {
    return { domainKey: "construction", progressSummaryHint: "Project and site progress over time" };
  }
  return { domainKey: "general", progressSummaryHint: null };
}

/**
 * Flag low-confidence rows for review (threshold from inputData).
 */

import { assertCapabilityModule } from "./capabilityContract.js";

export const reviewModule = {
  id: "review",
  name: "Review gate",
  description: "requiresReview when reasoning confidence is below threshold.",
  supportedIntents: ["review", "low confidence", "quality gate", "needs review", "qc"],

  /**
   * @param {Record<string, unknown>} input
   * @param {import("./capabilityContract.js").CapabilityRunContext} context
   */
  run(input, context) {
    const threshold =
      typeof input.reviewThreshold === "number" && Number.isFinite(input.reviewThreshold)
        ? Math.min(1, Math.max(0, input.reviewThreshold))
        : 0.65;
    const conf =
      typeof input.reasoningConfidence === "number" && Number.isFinite(input.reasoningConfidence)
        ? input.reasoningConfidence
        : typeof context.inputData?.reasoningConfidence === "number"
          ? context.inputData.reasoningConfidence
          : null;
    if (conf == null) {
      return {
        requiresReview: true,
        reasoningConfidence: null,
        threshold,
        summary: "No confidence score; recommend review.",
      };
    }
    const requiresReview = conf < threshold;
    return {
      requiresReview,
      reasoningConfidence: conf,
      threshold,
      summary: requiresReview ? `Below threshold ${threshold}` : `Meets threshold ${threshold}`,
    };
  },
};

assertCapabilityModule(reviewModule, "reviewModule");

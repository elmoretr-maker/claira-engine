/**
 * Phase 12 — Claira reasoning slot: refines classification input for routing (provider-only; no fs).
 */

import { tryClairaReasoning, finalizeGroupClairaResults } from "../../integrations/clairaReasoningProvider.js";

function orchestrationLogEnabled() {
  const v = process.env.ASSET_ORCHESTRATION_LOG;
  return v === "1" || v === "true" || v === "yes";
}

export const clairaReasoningModule = {
  id: "claira_reasoning",
  label: "Claira reasoning",
  description:
    "Refine categories, confidence, and filenames using the Claira reasoning provider (highest priority before router).",
  capabilities: ["reason", "refine_classification"],
  modulePipelineType: "processing",
  consumes: ["asset", "analysis", "aggregate"],
  produces: [{ kind: "aggregate", mode: "extend" }],
  expectedContextVersion: 2,

  state: {
    /** @returns {{ items: unknown[] }} */
    initialize: () => ({ items: [] }),
    selectors: {
      /** @param {{ items?: unknown }} s */
      listItems: (s) => (Array.isArray(s?.items) ? s.items : []),
    },
    reducers: {
      /**
       * @param {{ items?: unknown[] }} s
       * @param {unknown[]} payload
       */
      setItems: (s, payload) => {
        if (!Array.isArray(payload)) return { ...s, items: [] };
        return { ...s, items: payload.map((x) => (x != null && typeof x === "object" ? { .../** @type {object} */ (x) } : x)) };
      },
    },
  },

  health: {
    check: (s) =>
      Array.isArray(s?.items) && s.items.length > 0
        ? { status: "healthy", issues: [] }
        : { status: "warning", issues: ["No Claira reasoning rows"] },
  },

  ui: { components: [] },

  /**
   * @param {{ getModule: (id: string) => unknown, moduleState: unknown, getState: () => unknown, dispatch: Function }} context
   */
  execute: async (context) => {
    const st = /** @type {{ moduleRuntimeState?: Record<string, unknown>, runtimePipelineConfig?: unknown }} */ (
      context.getState()
    );
    const inputSlice = st.moduleRuntimeState?.image_input;
    const assetsRaw = /** @type {{ assets?: unknown }} */ (inputSlice)?.assets;
    const assets = Array.isArray(assetsRaw) ? assetsRaw : [];

    const rtp =
      st != null && typeof st === "object" && "runtimePipelineConfig" in st
        ? /** @type {{ runtimePipelineConfig?: { asset_mover?: { destinationRoot?: unknown, cwd?: unknown } } } } */ (st)
            .runtimePipelineConfig
        : null;
    const am = rtp != null && typeof rtp === "object" && rtp !== null ? rtp.asset_mover : null;
    const destinationRoot =
      am != null && typeof am === "object" && typeof /** @type {{ destinationRoot?: unknown }} */ (am).destinationRoot === "string"
        ? String(/** @type {{ destinationRoot?: string }} */ (am).destinationRoot).trim()
        : undefined;
    const cwd =
      am != null && typeof am === "object" && typeof /** @type {{ cwd?: unknown }} */ (am).cwd === "string"
        ? String(/** @type {{ cwd?: string }} */ (am).cwd).trim()
        : undefined;

    const classifier = st.moduleRuntimeState?.basic_classifier;
    const analysesRaw = /** @type {{ analyses?: unknown }} */ (classifier)?.analyses;
    const analyses = Array.isArray(analysesRaw) ? analysesRaw : [];

    const valSlice = st.moduleRuntimeState?.asset_validation;
    const valItemsRaw = /** @type {{ items?: unknown }} */ (valSlice)?.items;
    const valItems = Array.isArray(valItemsRaw) ? valItemsRaw : [];
    /** @type {Map<string, Record<string, unknown>>} */
    const valByAsset = new Map();
    for (const v of valItems) {
      if (v == null || typeof v !== "object" || Array.isArray(v)) continue;
      const id = String(/** @type {{ assetId?: unknown }} */ (v).assetId ?? "");
      if (id) valByAsset.set(id, /** @type {Record<string, unknown>} */ (v));
    }

    /** @type {Map<string, Record<string, unknown>>} */
    const byAssetId = new Map();
    for (const a of analyses) {
      if (a == null || typeof a !== "object" || Array.isArray(a)) continue;
      const aid = String(/** @type {{ assetId?: unknown }} */ (a).assetId ?? "");
      if (aid) byAssetId.set(aid, /** @type {Record<string, unknown>} */ (a));
    }

    /** @type {unknown[]} */
    const items = [];

    for (const row of assets) {
      if (row == null || typeof row !== "object" || Array.isArray(row)) continue;
      const asset = /** @type {{ id?: unknown, ref?: unknown }} */ (row);
      const assetId = String(asset.id ?? "");
      const sourceRef = String(asset.ref ?? "");
      if (!assetId) continue;

      const an = byAssetId.get(assetId) ?? null;
      const val = valByAsset.get(assetId) ?? null;

      /** @type {{ batchAssetCount: number, peers: Array<{ assetId: string, sourceRef: string, analysis: Record<string, unknown> | null }>, destinationRoot?: string, cwd?: string }} */
      const batchContext = {
        batchAssetCount: assets.length,
        peers: [],
        ...(destinationRoot ? { destinationRoot } : {}),
        ...(cwd ? { cwd } : {}),
      };
      for (const other of assets) {
        if (other == null || typeof other !== "object" || Array.isArray(other)) continue;
        const oid = String(/** @type {{ id?: unknown }} */ (other).id ?? "");
        if (!oid || oid === assetId) continue;
        batchContext.peers.push({
          assetId: oid,
          sourceRef: String(/** @type {{ ref?: unknown }} */ (other).ref ?? ""),
          analysis: byAssetId.get(oid) ?? null,
        });
      }

      const result = await tryClairaReasoning({
        assetId,
        sourceRef,
        analysis: an,
        validation: val,
        batchContext,
      });

      const rowOut = {
        assetId,
        sourceRef,
        refinedCategory: result.refinedCategory,
        reasoningConfidence: result.reasoningConfidence,
        confidenceAdjustment: result.confidenceAdjustment,
        reasoningNotes: result.reasoningNotes,
        reviewRecommended: result.reviewRecommended,
        suggestedName: result.suggestedName,
        clairaReasoning: result.clairaReasoning,
        active: result.active !== false,
        ...(result.semanticSimilarityScore != null ? { semanticSimilarityScore: result.semanticSimilarityScore } : {}),
        ...(result.groupId != null ? { groupId: result.groupId } : {}),
        ...(result.groupType != null ? { groupType: result.groupType } : {}),
        ...(Array.isArray(result.alternativeCategories) && result.alternativeCategories.length > 0
          ? { alternativeCategories: result.alternativeCategories }
          : {}),
        ...(typeof result.reasoningExplanation === "string" && result.reasoningExplanation.trim()
          ? { reasoningExplanation: result.reasoningExplanation }
          : {}),
        ...(typeof result.inferredIntent === "string" ? { inferredIntent: result.inferredIntent } : {}),
        ...(typeof result.intentConfidence === "number" ? { intentConfidence: result.intentConfidence } : {}),
        ...(Array.isArray(result.intentCandidates) && result.intentCandidates.length > 0
          ? { intentCandidates: [...result.intentCandidates] }
          : {}),
        ...(typeof result.intentSource === "string" ? { intentSource: result.intentSource } : {}),
        ...(result.groupPrior != null && typeof result.groupPrior === "object"
          ? { groupPrior: { .../** @type {object} */ (result.groupPrior) } }
          : {}),
        ...(result.effectiveThresholds != null && typeof result.effectiveThresholds === "object"
          ? { effectiveThresholds: { .../** @type {object} */ (result.effectiveThresholds) } }
          : {}),
        ...(result.adaptiveWeights != null && typeof result.adaptiveWeights === "object"
          ? { adaptiveWeights: { .../** @type {object} */ (result.adaptiveWeights) } }
          : {}),
        ...(result.groupDecisionApplied === true ? { groupDecisionApplied: true } : {}),
        ...(result.confidenceBreakdown != null && typeof result.confidenceBreakdown === "object"
          ? { confidenceBreakdown: { .../** @type {object} */ (result.confidenceBreakdown) } }
          : {}),
        ...(result.semanticMatchScore != null ? { semanticMatchScore: result.semanticMatchScore } : {}),
      };
      items.push(rowOut);

      if (orchestrationLogEnabled()) {
        console.log(
          `[claira_reasoning] asset=${assetId} refined=${result.refinedCategory} review=${result.reviewRecommended} conf=${result.reasoningConfidence} name=${result.suggestedName}`,
        );
      }
    }

    finalizeGroupClairaResults(items);

    context.dispatch("claira_reasoning", "setItems", items);
    const mod = /** @type {{ state: { selectors: { listItems: (s: unknown) => unknown[] } } }} */ (
      context.getModule("claira_reasoning")
    );
    return {
      kind: "claira_reasoning",
      items: mod.state.selectors.listItems(context.moduleState),
      count: items.length,
    };
  },
};

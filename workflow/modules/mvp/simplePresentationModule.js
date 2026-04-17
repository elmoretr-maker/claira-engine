/**
 * MVP — Presentation: exposes a serializable ui_model for hosts (data only; no React here).
 * Phase 7: presentationHints for richer display without binding to a UI framework.
 */

/** @typedef {{
 *   schema: string,
 *   interactionCapabilities: string[],
 *   deliverable: Record<string, unknown> | null,
 *   presentationHints?: {
 *     headline: string,
 *     assetSummaries: Array<{ sourceRef: string, category: string, labels: string[] }>,
 *     routingPlan?: Record<string, unknown> | null,
 *     assetMoves?: Record<string, unknown> | null,
 *     reviewQueue?: Array<{ assetId: string, decisionSource: string, preFeedbackRouteCategory: string, userCorrected: boolean, learnedApplied: boolean }>,
 *   },
 * }} UiModelDoc */
/** @typedef {{ uiModel: UiModelDoc | null }} PresentationSlice */

export const simplePresentationModule = {
  id: "simple_presentation",
  label: "Simple presentation",
  description: "Surface deliverable data as a ui_model for rendering or acknowledgement flows.",
  capabilities: ["present"],
  modulePipelineType: "presentation",
  consumes: ["deliverable"],
  produces: [{ kind: "ui_model", mode: "create" }],
  interactionCapabilities: ["view", "ack"],
  expectedContextVersion: 2,

  state: {
    /** @returns {PresentationSlice} */
    initialize: () => ({ uiModel: null }),
    selectors: {
      /** @param {PresentationSlice} s */
      getUiModel: (s) => (s?.uiModel != null && typeof s.uiModel === "object" ? s.uiModel : null),
    },
    reducers: {
      /**
       * @param {PresentationSlice} s
       * @param {UiModelDoc | null} payload
       */
      setUiModel: (s, payload) => {
        if (payload == null || typeof payload !== "object") return { ...s, uiModel: null };
        const p = /** @type {UiModelDoc} */ (payload);
        const hints = p.presentationHints;
        return {
          ...s,
          uiModel: {
            schema: p.schema,
            interactionCapabilities: Array.isArray(p.interactionCapabilities)
              ? [...p.interactionCapabilities]
              : [],
            deliverable: p.deliverable,
            ...(hints != null && typeof hints === "object"
              ? {
                  presentationHints: {
                    headline: String(hints.headline ?? ""),
                    assetSummaries: Array.isArray(hints.assetSummaries)
                      ? hints.assetSummaries.map((x) =>
                          x && typeof x === "object" && !Array.isArray(x)
                            ? {
                                sourceRef: String(/** @type {{ sourceRef?: unknown }} */ (x).sourceRef ?? ""),
                                category: String(/** @type {{ category?: unknown }} */ (x).category ?? ""),
                                labels: Array.isArray(/** @type {{ labels?: unknown }} */ (x).labels)
                                  ? /** @type {unknown[]} */ (x.labels).map((l) => String(l))
                                  : [],
                              }
                            : { sourceRef: "", category: "", labels: [] },
                        )
                      : [],
                    ...(hints.routingPlan != null && typeof hints.routingPlan === "object"
                      ? { routingPlan: /** @type {Record<string, unknown>} */ (hints.routingPlan) }
                      : {}),
                    ...(Array.isArray(hints.assetValidation)
                      ? { assetValidation: [...hints.assetValidation] }
                      : {}),
                    ...(Array.isArray(hints.clairaReasoning)
                      ? { clairaReasoning: [...hints.clairaReasoning] }
                      : {}),
                    ...(hints.assetMoves != null && typeof hints.assetMoves === "object"
                      ? { assetMoves: /** @type {Record<string, unknown>} */ (hints.assetMoves) }
                      : {}),
                    ...(Array.isArray(hints.reviewQueue) ? { reviewQueue: [...hints.reviewQueue] } : {}),
                  },
                }
              : {}),
          },
        };
      },
    },
  },

  health: {
    check: (s) =>
      s?.uiModel != null ? { status: "healthy", issues: [] } : { status: "warning", issues: ["No ui_model yet"] },
  },

  ui: { components: [] },

  /**
   * @param {{ getModule: (id: string) => unknown, moduleState: unknown, getState: () => unknown, dispatch: Function }} context
   */
  execute: (context) => {
    const st = /** @type {{ moduleRuntimeState?: Record<string, unknown> }} */ (context.getState());
    const out = st.moduleRuntimeState?.structured_output;
    const deliverable = /** @type {{ deliverable?: unknown } | null } */ (out)?.deliverable;
    const d =
      deliverable != null && typeof deliverable === "object" && !Array.isArray(deliverable)
        ? /** @type {Record<string, unknown>} */ (deliverable)
        : null;

    const rawItems = d != null && Array.isArray(d.items) ? d.items : [];
    /** @type {Array<{ sourceRef: string, category: string, labels: string[] }>} */
    const assetSummaries = [];
    for (const row of rawItems) {
      if (row == null || typeof row !== "object" || Array.isArray(row)) continue;
      const o = /** @type {Record<string, unknown>} */ (row);
      assetSummaries.push({
        sourceRef: String(o.sourceRef ?? ""),
        category: String(o.category ?? ""),
        labels: Array.isArray(o.labels) ? o.labels.map((x) => String(x)) : [],
      });
    }

    const headline =
      d != null && typeof d.summary === "string" && d.summary.trim() ? d.summary : "Results";

    const ar = st.moduleRuntimeState?.asset_router;
    const routingPlan =
      ar != null &&
      typeof ar === "object" &&
      !Array.isArray(ar) &&
      "routing" in ar &&
      /** @type {{ routing?: unknown }} */ (ar).routing != null &&
      typeof /** @type {{ routing?: unknown }} */ (ar).routing === "object"
        ? /** @type {{ routing: Record<string, unknown> }} */ (ar).routing
        : null;

    const av = st.moduleRuntimeState?.asset_validation;
    const validationSnap =
      av != null && typeof av === "object" && !Array.isArray(av) && Array.isArray(/** @type {{ items?: unknown }} */ (av).items)
        ? /** @type {{ items: unknown[] }} */ (av).items.map((row) =>
            row != null && typeof row === "object" && !Array.isArray(row)
              ? {
                  assetId: String(/** @type {{ assetId?: unknown }} */ (row).assetId ?? ""),
                  validationStatus: String(/** @type {{ validationStatus?: unknown }} */ (row).validationStatus ?? ""),
                  suggestedName: String(/** @type {{ suggestedName?: unknown }} */ (row).suggestedName ?? ""),
                  adjustedConfidence:
                    typeof /** @type {{ adjustedConfidence?: unknown }} */ (row).adjustedConfidence === "number"
                      ? /** @type {{ adjustedConfidence?: number }} */ (row).adjustedConfidence
                      : null,
                  finalCategory: String(/** @type {{ finalCategory?: unknown }} */ (row).finalCategory ?? ""),
                  reviewOverride: /** @type {{ reviewOverride?: unknown }} */ (row).reviewOverride === true,
                }
              : null,
          ).filter(Boolean)
        : [];

    const cr = st.moduleRuntimeState?.claira_reasoning;
    const clairaSnap =
      cr != null && typeof cr === "object" && !Array.isArray(cr) && Array.isArray(/** @type {{ items?: unknown }} */ (cr).items)
        ? /** @type {{ items: unknown[] }} */ (cr).items.map((row) =>
            row != null && typeof row === "object" && !Array.isArray(row)
              ? {
                  assetId: String(/** @type {{ assetId?: unknown }} */ (row).assetId ?? ""),
                  refinedCategory: String(/** @type {{ refinedCategory?: unknown }} */ (row).refinedCategory ?? ""),
                  reasoningConfidence:
                    typeof /** @type {{ reasoningConfidence?: unknown }} */ (row).reasoningConfidence === "number"
                      ? /** @type {{ reasoningConfidence?: number }} */ (row).reasoningConfidence
                      : null,
                  reasoningNotes: String(/** @type {{ reasoningNotes?: unknown }} */ (row).reasoningNotes ?? ""),
                  reviewRecommended: /** @type {{ reviewRecommended?: unknown }} */ (row).reviewRecommended === true,
                  suggestedName: String(/** @type {{ suggestedName?: unknown }} */ (row).suggestedName ?? ""),
                  active: /** @type {{ active?: unknown }} */ (row).active !== false,
                }
              : null,
          ).filter(Boolean)
        : [];

    const mv = st.moduleRuntimeState?.asset_mover;
    const moverSnap =
      mv != null && typeof mv === "object" && !Array.isArray(mv)
        ? /** @type {{ config?: unknown, moveLog?: unknown, eventsEmitted?: unknown, simulatedAssetRefs?: unknown }} */ (mv)
        : null;
    const assetMoves =
      moverSnap != null
        ? {
            config: moverSnap.config,
            moveLog: moverSnap.moveLog,
            eventsEmitted: moverSnap.eventsEmitted,
            simulatedAssetRefs: moverSnap.simulatedAssetRefs,
          }
        : null;

    const rItems =
      routingPlan != null &&
      typeof routingPlan === "object" &&
      !Array.isArray(routingPlan) &&
      Array.isArray(/** @type {{ items?: unknown }} */ (routingPlan).items)
        ? /** @type {{ items: unknown[] }} */ (routingPlan).items
        : [];
    /** @type {Array<{ assetId: string, decisionSource: string, preFeedbackRouteCategory: string, userCorrected: boolean, learnedApplied: boolean }>} */
    const reviewQueue = [];
    for (const row of rItems) {
      if (row == null || typeof row !== "object" || Array.isArray(row)) continue;
      const o = /** @type {Record<string, unknown>} */ (row);
      if (String(o.destinationRelPath ?? "").trim() !== "Review") continue;
      reviewQueue.push({
        assetId: String(o.assetId ?? ""),
        decisionSource: String(o.decisionSource ?? "ai"),
        preFeedbackRouteCategory: String(o.preFeedbackRouteCategory ?? ""),
        userCorrected: o.userCorrected === true,
        learnedApplied: o.learnedApplied === true,
      });
    }

    const uiModel = /** @type {UiModelDoc} */ ({
      schema: "claira.ui_model.v2.1",
      interactionCapabilities: ["view", "ack"],
      deliverable: d,
      presentationHints: {
        headline,
        assetSummaries,
        ...(validationSnap.length > 0 ? { assetValidation: validationSnap } : {}),
        ...(clairaSnap.length > 0 ? { clairaReasoning: clairaSnap } : {}),
        ...(routingPlan != null ? { routingPlan } : {}),
        ...(assetMoves != null ? { assetMoves } : {}),
        ...(reviewQueue.length > 0 ? { reviewQueue } : {}),
      },
    });
    context.dispatch("simple_presentation", "setUiModel", uiModel);
    const mod = /** @type {{ state: { selectors: { getUiModel: (s: unknown) => unknown } } }} */ (
      context.getModule("simple_presentation")
    );
    return {
      kind: "simple_presentation",
      uiModel: mod.state.selectors.getUiModel(context.moduleState),
    };
  },
};

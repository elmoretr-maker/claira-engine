/**
 * Phase 9 — Route assets from classifier analysis using config mapping (category + labels only).
 */

import {
  DEFAULT_ASSET_ROUTING_CONFIG,
  normalizeAnalysisLabels,
  resolveRoutingDestination,
} from "../../routing/assetRoutingConfig.js";
import {
  basenameOnly,
  feedbackConfigFromState,
  findImmediateOverride,
  findLearningMatch,
  recordFeedbackEntry,
} from "../../feedback/feedbackStore.js";

/**
 * @typedef {{
 *   schema: string,
 *   summary: string,
 *   items: Array<{
 *     assetId: string,
 *     analysisId: string,
 *     category: string,
 *     labels: string[],
 *     destinationRelPath: string,
 *     matchedBy: string,
 *     matchedKey: string,
 *     refinedCategory?: string | null,
 *     reasoningConfidence?: number | null,
 *     clairaReasoning?: Record<string, unknown> | null,
 *     decisionSource?: "ai" | "user_immediate" | "learned",
 *     preFeedbackRouteCategory?: string,
 *     userCorrected?: boolean,
 *     learnedApplied?: boolean,
 *     learnedMatchCount?: number | null,
 *     userRenamedTo?: string | null,
 *   }>,
 * }} RoutingDeliverableV1
 */

/** @typedef {{ routing: RoutingDeliverableV1 | null }} AssetRouterSlice */

/**
 * @param {unknown} st
 * @returns {import("../../routing/assetRoutingConfig.js").AssetRoutingConfig}
 */
function routingConfigFromState(st) {
  const raw =
    st != null && typeof st === "object" && "runtimePipelineConfig" in st
      ? /** @type {{ runtimePipelineConfig?: unknown }} */ (st).runtimePipelineConfig
      : null;
  const ar =
    raw != null && typeof raw === "object" && !Array.isArray(raw) && "asset_router" in raw
      ? /** @type {{ asset_router?: unknown }} */ (raw).asset_router
      : null;
  const cfg =
    ar != null && typeof ar === "object" && ar !== null && "routingConfig" in ar
      ? /** @type {{ routingConfig?: unknown }} */ (ar).routingConfig
      : null;
  if (cfg != null && typeof cfg === "object" && !Array.isArray(cfg)) {
    return /** @type {import("../../routing/assetRoutingConfig.js").AssetRoutingConfig} */ (cfg);
  }
  return DEFAULT_ASSET_ROUTING_CONFIG;
}

export const assetRouterModule = {
  id: "asset_router",
  label: "Asset router",
  description: "Map classifier category/labels to destination folders via configurable rules (no path-based routing).",
  capabilities: ["route", "aggregate_routing"],
  modulePipelineType: "aggregation",
  consumes: ["asset", "analysis"],
  produces: [{ kind: "deliverable", mode: "derive" }],
  expectedContextVersion: 2,

  state: {
    /** @returns {AssetRouterSlice} */
    initialize: () => ({ routing: null }),
    selectors: {
      /** @param {AssetRouterSlice} s */
      getRouting: (s) => (s?.routing != null && typeof s.routing === "object" ? s.routing : null),
    },
    reducers: {
      /**
       * @param {AssetRouterSlice} s
       * @param {RoutingDeliverableV1 | null} payload
       */
      setRouting: (s, payload) => {
        if (payload == null || typeof payload !== "object") return { ...s, routing: null };
        const p = /** @type {RoutingDeliverableV1} */ (payload);
        const items = Array.isArray(p.items)
          ? p.items.map((it) => ({
              ...it,
              labels: Array.isArray(it.labels) ? [...it.labels] : [],
            }))
          : [];
        return {
          ...s,
          routing: {
            schema: p.schema,
            summary: p.summary,
            items,
          },
        };
      },
    },
  },

  health: {
    check: (s) =>
      s?.routing != null && Array.isArray(s.routing.items) && s.routing.items.length > 0
        ? { status: "healthy", issues: [] }
        : { status: "warning", issues: ["No routing plan yet"] },
  },

  ui: { components: [] },

  /**
   * @param {{ getModule: (id: string) => unknown, moduleState: unknown, getState: () => unknown, dispatch: Function }} context
   */
  execute: (context) => {
    const st = /** @type {{ moduleRuntimeState?: Record<string, unknown>, runtimePipelineConfig?: unknown }} */ (
      context.getState()
    );
    const cfg = routingConfigFromState(context.getState());

    const inputSlice = st.moduleRuntimeState?.image_input;
    const assetsRaw = /** @type {{ assets?: unknown }} */ (inputSlice)?.assets;
    const assets = Array.isArray(assetsRaw) ? assetsRaw : [];

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
      if (id) valByAsset.set(id, v);
    }

    const crSlice = st.moduleRuntimeState?.claira_reasoning;
    const crItemsRaw = /** @type {{ items?: unknown }} */ (crSlice)?.items;
    const crItems = Array.isArray(crItemsRaw) ? crItemsRaw : [];
    /** @type {Map<string, Record<string, unknown>>} */
    const clairaByAsset = new Map();
    for (const c of crItems) {
      if (c == null || typeof c !== "object" || Array.isArray(c)) continue;
      const id = String(/** @type {{ assetId?: unknown }} */ (c).assetId ?? "");
      if (id) clairaByAsset.set(id, c);
    }

    /** @type {Map<string, Record<string, unknown>>} */
    const byAssetId = new Map();
    for (const a of analyses) {
      if (a == null || typeof a !== "object" || Array.isArray(a)) continue;
      const o = /** @type {Record<string, unknown>} */ (a);
      const aid = String(o.assetId ?? "");
      if (aid) byAssetId.set(aid, o);
    }

    /** @type {RoutingDeliverableV1["items"]} */
    const items = [];

    for (const row of assets) {
      if (row == null || typeof row !== "object" || Array.isArray(row)) continue;
      const asset = /** @type {{ id?: unknown, ref?: unknown }} */ (row);
      const assetId = String(asset.id ?? "");
      if (!assetId) continue;
      const an = byAssetId.get(assetId);
      if (an == null) continue;

      const category = String(an.category ?? "unknown");
      const labels = Array.isArray(an.labels) ? an.labels.map((x) => String(x)) : [];
      const analysisId = String(an.id ?? "");

      const val = valByAsset.get(assetId);
      const cl = clairaByAsset.get(assetId);

      let routeCategory = category;
      let routeLabels = [...labels];

      if (cl != null && typeof cl === "object" && !Array.isArray(cl) && /** @type {{ active?: unknown }} */ (cl).active !== false) {
        const rr = /** @type {{ reviewRecommended?: unknown }} */ (cl).reviewRecommended === true;
        const rc = String(/** @type {{ refinedCategory?: unknown }} */ (cl).refinedCategory ?? "").trim();
        if (rr || rc === "review") {
          routeCategory = "review";
          routeLabels = [...labels, "review"];
        } else if (rc) {
          routeCategory = rc;
          routeLabels = [...labels, rc];
        }
      } else if (val != null && typeof val === "object" && !Array.isArray(val)) {
        const vs = String(/** @type {{ validationStatus?: unknown }} */ (val).validationStatus ?? "");
        const fc = String(/** @type {{ finalCategory?: unknown }} */ (val).finalCategory ?? "").trim();
        const ro = /** @type {{ reviewOverride?: unknown }} */ (val).reviewOverride === true;
        if (vs === "low" || ro || fc === "review") {
          routeCategory = "review";
          routeLabels = [...labels, "review"];
        } else if (fc) {
          routeCategory = fc;
        }
      }

      const refinedCategory =
        cl != null && typeof cl === "object" && !Array.isArray(cl)
          ? /** @type {{ refinedCategory?: unknown }} */ (cl).refinedCategory != null
            ? String(/** @type {{ refinedCategory?: unknown }} */ (cl).refinedCategory)
            : null
          : null;

      const preFeedbackRouteCategory = routeCategory;
      /** @type {"ai" | "user_immediate" | "learned"} */
      let decisionSource = "ai";
      let learnedApplied = false;
      /** @type {number | null} */
      let learnedMatchCount = null;
      let userCorrected = false;
      /** @type {string | null} */
      let userRenamedTo = null;

      const filename = basenameOnly(String(asset.ref ?? ""));
      const fbCfg = feedbackConfigFromState(st);

      if (fbCfg != null) {
        const imm = findImmediateOverride(assetId, fbCfg.immediateOverrides);
        if (imm != null) {
          routeCategory = imm.userCorrectedCategory;
          if (imm.userRenamedTo) userRenamedTo = imm.userRenamedTo;
          decisionSource = "user_immediate";
          userCorrected = true;
          if (fbCfg.persistCorrections) {
            recordFeedbackEntry({
              originalLabels: labels,
              refinedCategory,
              userCorrectedCategory: imm.userCorrectedCategory,
              filename,
              assetId,
              sourceRef: String(asset.ref ?? ""),
            });
          }
        }
      }

      if (decisionSource === "ai") {
        const learned = findLearningMatch({ filename });
        if (learned != null && learned.strength === "strong") {
          routeCategory = learned.userCorrectedCategory;
          decisionSource = "learned";
          learnedApplied = true;
          learnedMatchCount = learned.matchCount;
        }
      }

      if (decisionSource === "user_immediate" || decisionSource === "learned") {
        routeLabels = normalizeAnalysisLabels([routeCategory]);
      }

      const resolved = resolveRoutingDestination(
        { category: routeCategory, labels: normalizeAnalysisLabels(routeLabels) },
        cfg,
      );
      const reasoningConfidence =
        cl != null && typeof cl === "object" && !Array.isArray(cl) && typeof /** @type {{ reasoningConfidence?: unknown }} */ (cl).reasoningConfidence === "number"
          ? /** @type {{ reasoningConfidence?: number }} */ (cl).reasoningConfidence
          : null;
      const clairaPayload =
        cl != null && typeof cl === "object" && !Array.isArray(cl) && cl.clairaReasoning != null && typeof cl.clairaReasoning === "object"
          ? /** @type {Record<string, unknown>} */ (cl.clairaReasoning)
          : null;

      items.push({
        assetId,
        analysisId,
        category,
        labels,
        refinedCategory,
        reasoningConfidence,
        clairaReasoning: clairaPayload,
        destinationRelPath: resolved.destination,
        matchedBy: resolved.matchedBy,
        matchedKey: resolved.matchedKey,
        decisionSource,
        preFeedbackRouteCategory,
        userCorrected,
        learnedApplied,
        learnedMatchCount,
        ...(userRenamedTo ? { userRenamedTo } : {}),
      });
    }

    const summary =
      items.length === 0
        ? "empty routing"
        : `${items.length} asset(s) routed to ${[...new Set(items.map((i) => i.destinationRelPath))].length} destination(s)`;

    const routing = /** @type {RoutingDeliverableV1} */ ({
      schema: "claira.routingDecision.v1",
      summary,
      items,
    });

    context.dispatch("asset_router", "setRouting", routing);
    const mod = /** @type {{ state: { selectors: { getRouting: (s: unknown) => unknown } } }} */ (
      context.getModule("asset_router")
    );
    return {
      kind: "asset_router",
      routing: mod.state.selectors.getRouting(context.moduleState),
    };
  },
};

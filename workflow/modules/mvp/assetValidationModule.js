/**
 * Phase 11 — Filename vs content validation, confidence tiers, Review routing for uncertain assets.
 */

import { basenameOnly } from "../../feedback/feedbackStore.js";
import {
  DEFAULT_ASSET_ROUTING_CONFIG,
  resolveRoutingDestination,
} from "../../routing/assetRoutingConfig.js";

/**
 * @typedef {"high" | "medium" | "low"} ValidationStatus
 */

/**
 * @typedef {{
 *   assetId: string,
 *   sourceRef: string,
 *   filenameTokens: string[],
 *   validationStatus: ValidationStatus,
 *   suggestedName: string,
 *   adjustedConfidence: number | null,
 *   finalCategory: string,
 *   reviewOverride: boolean,
 * }} AssetValidationRow
 */

/** @typedef {{ items: AssetValidationRow[] }} AssetValidationSlice */

function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

/**
 * @param {string} ref
 * @returns {string[]}
 */
export function extractFilenameTokens(ref) {
  const base = basenameOnly(String(ref ?? ""));
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  return stem
    .split(/[\s_\-+.]+/g)
    .map((t) => norm(t))
    .filter((t) => t.length > 0);
}

/**
 * @param {string[]} tokens
 * @param {string[]} labelList
 * @returns {number} overlap score 0..1
 */
function filenameLabelOverlap(tokens, labelList) {
  const labels = labelList.map(norm).filter(Boolean);
  if (labels.length === 0 || tokens.length === 0) return 0;
  let hits = 0;
  for (const t of tokens) {
    if (t.length < 2) continue;
    let hit = false;
    for (const L of labels) {
      if (!L) continue;
      if (L === t || L.includes(t) || t.includes(L)) {
        hit = true;
        break;
      }
    }
    if (hit) hits += 1;
  }
  return hits / Math.max(tokens.length, 1);
}

/**
 * @param {number | null | undefined} c
 * @param {ValidationStatus} tier
 * @returns {number | null}
 */
function adjustConfidence(c, tier) {
  const base = typeof c === "number" && Number.isFinite(c) ? c : 0.55;
  if (tier === "high") return Math.min(1, base);
  if (tier === "medium") return Math.min(1, base * 0.88);
  return Math.min(1, base * 0.45);
}

/**
 * @param {string} category
 * @param {string[]} labels
 * @param {import("../../routing/assetRoutingConfig.js").AssetRoutingConfig} cfg
 */
function hasStrongLabelRoute(category, labels, cfg) {
  const r = resolveRoutingDestination({ category, labels }, cfg);
  return r.matchedBy !== "default";
}

/**
 * @param {string} topLabel
 * @param {string} ext
 * @param {Record<string, number>} used
 */
function buildSuggestedName(topLabel, ext, used) {
  const raw = norm(topLabel).replace(/[^a-z0-9]+/g, " ").trim();
  const parts = raw.split(/\s+/).filter((w) => w.length > 1).slice(0, 3);
  const base = (parts.length ? parts.join("_") : "asset").replace(/_+/g, "_");
  const n = (used[base] = (used[base] ?? 0) + 1);
  return `${base}_${String(n).padStart(2, "0")}${ext}`;
}

function orchestrationLogEnabled() {
  const v = process.env.ASSET_ORCHESTRATION_LOG;
  return v === "1" || v === "true" || v === "yes";
}

export const assetValidationModule = {
  id: "asset_validation",
  label: "Asset validation",
  description:
    "Compare filename tokens to classifier labels; tier confidence; route uncertain assets to Review; suggest filenames.",
  capabilities: ["validate_assets", "filename_sanity"],
  modulePipelineType: "processing",
  consumes: ["asset", "analysis"],
  produces: [{ kind: "aggregate", mode: "create" }],
  expectedContextVersion: 2,

  state: {
    /** @returns {AssetValidationSlice} */
    initialize: () => ({ items: [] }),
    selectors: {
      /** @param {AssetValidationSlice} s */
      listItems: (s) => (Array.isArray(s?.items) ? s.items : []),
    },
    reducers: {
      /**
       * @param {AssetValidationSlice} s
       * @param {AssetValidationRow[]} payload
       */
      setItems: (s, payload) => {
        if (!Array.isArray(payload)) return { ...s, items: [] };
        return { ...s, items: payload.map((x) => ({ ...x })) };
      },
    },
  },

  health: {
    check: (s) =>
      Array.isArray(s?.items) && s.items.length > 0
        ? { status: "healthy", issues: [] }
        : { status: "warning", issues: ["No validation rows"] },
  },

  ui: { components: [] },

  /**
   * @param {{ getModule: (id: string) => unknown, moduleState: unknown, getState: () => unknown, dispatch: Function }} context
   */
  execute: (context) => {
    const st = /** @type {{ moduleRuntimeState?: Record<string, unknown>, runtimePipelineConfig?: unknown }} */ (
      context.getState()
    );
    const rawCfg =
      st.runtimePipelineConfig != null &&
      typeof st.runtimePipelineConfig === "object" &&
      "asset_router" in /** @type {object} */ (st.runtimePipelineConfig)
        ? /** @type {{ asset_router?: { routingConfig?: unknown } }} */ (st.runtimePipelineConfig).asset_router
            ?.routingConfig
        : null;
    const routingCfg =
      rawCfg != null && typeof rawCfg === "object" && !Array.isArray(rawCfg)
        ? /** @type {import("../../routing/assetRoutingConfig.js").AssetRoutingConfig} */ (rawCfg)
        : DEFAULT_ASSET_ROUTING_CONFIG;

    const inputSlice = st.moduleRuntimeState?.image_input;
    const assetsRaw = /** @type {{ assets?: unknown }} */ (inputSlice)?.assets;
    const assets = Array.isArray(assetsRaw) ? assetsRaw : [];

    const classifier = st.moduleRuntimeState?.basic_classifier;
    const analysesRaw = /** @type {{ analyses?: unknown }} */ (classifier)?.analyses;
    const analyses = Array.isArray(analysesRaw) ? analysesRaw : [];

    /** @type {Map<string, Record<string, unknown>>} */
    const byAssetId = new Map();
    for (const a of analyses) {
      if (a == null || typeof a !== "object" || Array.isArray(a)) continue;
      const o = /** @type {Record<string, unknown>} */ (a);
      const aid = String(o.assetId ?? "");
      if (aid) byAssetId.set(aid, o);
    }

    /** @type {Record<string, number>} */
    const suggestedUsed = {};

    /** @type {AssetValidationRow[]} */
    const items = [];

    for (const row of assets) {
      if (row == null || typeof row !== "object" || Array.isArray(row)) continue;
      const asset = /** @type {{ id?: unknown, ref?: unknown }} */ (row);
      const assetId = String(asset.id ?? "");
      const sourceRef = String(asset.ref ?? "");
      if (!assetId || !sourceRef) continue;

      const an = byAssetId.get(assetId);
      const category = an != null ? String(/** @type {{ category?: unknown }} */ (an).category ?? "unknown") : "unknown";
      const labels = an != null && Array.isArray(/** @type {{ labels?: unknown }} */ (an).labels)
        ? /** @type {unknown[]} */ (/** @type {{ labels?: unknown }} */ (an).labels).map((x) => String(x))
        : [];
      const conf = an != null ? /** @type {{ confidence?: unknown }} */ (an).confidence : null;

      const filenameTokens = extractFilenameTokens(sourceRef);
      const overlap = filenameLabelOverlap(filenameTokens, labels);
      const labelRouted = hasStrongLabelRoute(category, labels, routingCfg);

      /** @type {ValidationStatus} */
      let validationStatus = "low";
      if (!labelRouted) {
        validationStatus = "low";
      } else if (overlap >= 0.25) {
        validationStatus = "high";
      } else {
        validationStatus = "medium";
      }

      const baseName = basenameOnly(sourceRef);
      const ext = (baseName.includes(".") ? baseName.slice(baseName.lastIndexOf(".")) : "") || ".png";
      const topLabel = labels.length > 0 ? labels[0] : category;
      const suggestedName = buildSuggestedName(topLabel === "unknown" ? "asset" : topLabel, ext, suggestedUsed);

      const adjustedConfidence = adjustConfidence(
        typeof conf === "number" ? conf : null,
        validationStatus,
      );

      let finalCategory = category;
      let reviewOverride = false;
      if (validationStatus === "low") {
        finalCategory = "review";
        reviewOverride = true;
      }

      items.push({
        assetId,
        sourceRef,
        filenameTokens,
        validationStatus,
        suggestedName,
        adjustedConfidence,
        finalCategory,
        reviewOverride,
      });

      if (orchestrationLogEnabled()) {
        console.log(
          `[asset_validation] asset=${assetId} tokens=[${filenameTokens.join(", ")}] labels=[${labels.map(norm).join(", ")}] tier=${validationStatus} review=${reviewOverride} suggested=${suggestedName} adjConf=${adjustedConfidence}`,
        );
      }
    }

    context.dispatch("asset_validation", "setItems", items);
    const mod = /** @type {{ state: { selectors: { listItems: (s: unknown) => unknown[] } } }} */ (
      context.getModule("asset_validation")
    );
    return {
      kind: "asset_validation",
      items: mod.state.selectors.listItems(context.moduleState),
      count: items.length,
    };
  },
};

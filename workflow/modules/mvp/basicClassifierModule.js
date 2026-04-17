/**
 * MVP — Basic classification (processing): per-asset analysis via optional provider + heuristic fallback.
 */

import { prepareInferenceInput, tryAnalyzeImage } from "../../integrations/imageAnalysisProvider.js";

/**
 * @typedef {{
 *   id: string,
 *   assetId: string,
 *   sourceRef: string,
 *   category: string,
 *   labels: string[],
 *   confidence: number | null,
 *   features: Record<string, unknown>,
 *   embeddings: number[] | null,
 *   modelSource: "local" | "external" | "mock" | "heuristic",
 *   modelHint: string,
 *   inferenceInput: Record<string, unknown>,
 *   extensions: Record<string, unknown>,
 * }} AnalysisEntry
 */

/** @typedef {{ analyses: AnalysisEntry[] }} ClassifierSlice */

function categoryFromRef(ref) {
  const r = String(ref ?? "").toLowerCase();
  if (/\.(png|gif|webp|bmp)$/i.test(r)) return "raster_image";
  if (/\.(jpg|jpeg)$/i.test(r)) return "raster_image";
  if (/\.(svg|eps)$/i.test(r)) return "vector_image";
  return "unknown";
}

function analysisIdFor(assetId, ref) {
  let h = 2166136261;
  const key = `${assetId}\0${ref}`;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return `an_${(h >>> 0).toString(16)}`;
}

/**
 * @param {import("../../integrations/imageAnalysisProvider.js").ImageAnalysisResult | null} intel
 * @param {string} fallbackCategory
 * @param {{ id: string, ref: string, entityId?: string }} assetLike
 */
function buildEntryFromProviderOrHeuristic(intel, fallbackCategory, assetLike) {
  if (intel != null) {
    return {
      category: intel.category || fallbackCategory,
      labels: intel.labels.length ? [...intel.labels] : [intel.category || fallbackCategory],
      confidence: intel.confidence,
      features: { ...intel.features },
      embeddings: intel.embeddings,
      modelSource: intel.modelSource === "external" ? "external" : intel.modelSource === "mock" ? "mock" : "local",
      inferenceInput:
        intel.inferenceInput != null && typeof intel.inferenceInput === "object"
          ? { ...intel.inferenceInput }
          : prepareInferenceInput(assetLike),
    };
  }
  return {
    category: fallbackCategory,
    labels: fallbackCategory !== "unknown" ? [fallbackCategory] : [],
    confidence: null,
    features: {},
    embeddings: null,
    modelSource: "heuristic",
    inferenceInput: prepareInferenceInput(assetLike),
  };
}

export const basicClassifierModule = {
  id: "basic_classifier",
  label: "Basic classifier",
  description: "Classify each ingested asset; optional imageAnalysisProvider with heuristic fallback.",
  capabilities: ["classify", "classify_batch", "provider_hook"],
  modulePipelineType: "processing",
  consumes: ["asset"],
  produces: [{ kind: "analysis", mode: "create" }],
  expectedContextVersion: 2,

  state: {
    /** @returns {ClassifierSlice} */
    initialize: () => ({ analyses: [] }),
    selectors: {
      /** @param {ClassifierSlice} s */
      listAnalyses: (s) => (Array.isArray(s?.analyses) ? s.analyses : []),
    },
    reducers: {
      /**
       * @param {ClassifierSlice} s
       * @param {AnalysisEntry[]} payload
       */
      setAnalyses: (s, payload) => {
        if (!Array.isArray(payload)) return { ...s, analyses: [] };
        return {
          ...s,
          analyses: payload.map((p) => ({
            ...p,
            labels: [...p.labels],
            features: { ...p.features },
            inferenceInput: { ...p.inferenceInput },
            extensions: { ...p.extensions },
            embeddings:
              p.embeddings === null || p.embeddings === undefined
                ? null
                : Array.isArray(p.embeddings)
                  ? [...p.embeddings]
                  : null,
          })),
        };
      },
    },
  },

  health: {
    check: (s) =>
      Array.isArray(s?.analyses) && s.analyses.length > 0
        ? { status: "healthy", issues: [] }
        : { status: "warning", issues: ["No analyses yet"] },
  },

  ui: { components: [] },

  /**
   * @param {{ getModule: (id: string) => unknown, moduleState: unknown, getState: () => unknown, dispatch: Function }} context
   */
  execute: (context) => {
    const st = /** @type {{ moduleRuntimeState?: Record<string, unknown> }} */ (context.getState());
    const inputSlice = st.moduleRuntimeState?.image_input;
    const assets = /** @type {{ assets?: unknown }} */ (inputSlice)?.assets;
    const list = Array.isArray(assets) ? assets : [];

    /** @type {AnalysisEntry[]} */
    const analyses = [];
    for (const row of list) {
      if (row == null || typeof row !== "object" || Array.isArray(row)) continue;
      const id = String(/** @type {{ id?: unknown }} */ (row).id ?? "");
      const ref = String(/** @type {{ ref?: unknown }} */ (row).ref ?? "");
      const entityId = /** @type {{ entityId?: unknown }} */ (row).entityId;
      if (!id || !ref) continue;

      const assetLike = {
        id,
        ref,
        ...(entityId != null ? { entityId: String(entityId) } : {}),
      };

      const intel = tryAnalyzeImage(assetLike);
      const fallbackCategory = categoryFromRef(ref);
      const built = buildEntryFromProviderOrHeuristic(intel, fallbackCategory, assetLike);

      const modelHint =
        intel != null ? `provider:${built.modelSource}` : "heuristic:v1";

      analyses.push({
        id: analysisIdFor(id, ref),
        assetId: id,
        sourceRef: ref,
        category: built.category,
        labels: built.labels,
        confidence: built.confidence,
        features: built.features,
        embeddings: built.embeddings,
        modelSource: built.modelSource,
        modelHint,
        inferenceInput: {
          ...prepareInferenceInput(assetLike),
          ...built.inferenceInput,
        },
        extensions: {
          claria: { reserved: true, pipeline: intel ? "provider" : "heuristic" },
        },
      });
    }

    context.dispatch("basic_classifier", "setAnalyses", analyses);
    const mod = /** @type {{ state: { selectors: { listAnalyses: (s: unknown) => unknown[] } } }} */ (
      context.getModule("basic_classifier")
    );
    return {
      kind: "basic_classifier",
      analyses: mod.state.selectors.listAnalyses(context.moduleState),
      analysisCount: analyses.length,
    };
  },
};

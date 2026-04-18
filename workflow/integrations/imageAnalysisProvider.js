/**
 * Phase 7 — Pluggable image analysis (provider-agnostic). No network I/O in this module.
 *
 * Implementations may later call Claria or other backends; the workflow only sees the interface below.
 */

/**
 * Minimal asset shape passed from the pipeline (image_input slice).
 * @typedef {{
 *   id: string,
 *   ref: string,
 *   entityId?: string,
 * }} ImageAssetLike
 */

/**
 * Normalized output from any provider (or mock). Maps to classifier `AnalysisEntry` fields.
 * @typedef {{
 *   category: string,
 *   labels: string[],
 *   confidence: number | null,
 *   features: Record<string, unknown>,
 *   embeddings?: number[] | null,
 *   modelSource: "local" | "external" | "mock",
 *   provider?: string,
 *   inferenceInput?: Record<string, unknown>,
 * }} ImageAnalysisResult
 */

/**
 * @typedef {{
 *   id: string,
 *   analyzeImage: (asset: ImageAssetLike) => ImageAnalysisResult | null | undefined,
 * }} ImageAnalysisProvider
 */

/** @type {ImageAnalysisProvider | null} */
let registeredProvider = null;

/**
 * Register or clear the active provider (tests may swap implementations).
 * @param {ImageAnalysisProvider | null} provider
 */
export function setImageAnalysisProvider(provider) {
  registeredProvider = provider;
}

/**
 * @returns {ImageAnalysisProvider | null}
 */
export function getImageAnalysisProvider() {
  return registeredProvider;
}

/**
 * @returns {void}
 */
export function clearImageAnalysisProvider() {
  registeredProvider = null;
}

/**
 * Prepare model / inference input from an asset (no I/O).
 * @param {ImageAssetLike} asset
 * @returns {{ kind: "image_ref", assetId: string, ref: string, entityId?: string }}
 */
export function prepareInferenceInput(asset) {
  return {
    kind: "image_ref",
    assetId: String(asset?.id ?? ""),
    ref: String(asset?.ref ?? ""),
    ...(asset?.entityId != null && String(asset.entityId).trim()
      ? { entityId: String(asset.entityId) }
      : {}),
  };
}

/**
 * Run registered provider synchronously. Returns `null` if none or on failure (caller uses heuristic).
 * @param {ImageAssetLike} asset
 * @returns {ImageAnalysisResult | null}
 */
export function tryAnalyzeImage(asset) {
  const p = registeredProvider;
  if (p == null || typeof p.analyzeImage !== "function") return null;
  try {
    const raw = p.analyzeImage(asset);
    if (raw == null || typeof raw !== "object") return null;
    return normalizeAnalysisResult(/** @type {Record<string, unknown>} */ (raw), asset);
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>} raw
 * @param {ImageAssetLike} asset
 * @returns {ImageAnalysisResult}
 */
function normalizeAnalysisResult(raw, asset) {
  const labels = Array.isArray(raw.labels) ? raw.labels.map((x) => String(x)) : [];
  const conf = raw.confidence;
  const confidence =
    typeof conf === "number" && Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : null;
  const features =
    raw.features != null && typeof raw.features === "object" && !Array.isArray(raw.features)
      ? /** @type {Record<string, unknown>} */ ({ ...raw.features })
      : {};
  if (typeof raw.provider === "string" && raw.provider.trim()) {
    features.provider = raw.provider.trim();
  }
  const emb = raw.embeddings;
  const embeddings =
    emb === null || emb === undefined
      ? null
      : Array.isArray(emb)
        ? emb.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : 0))
        : null;
  const ms = raw.modelSource;
  const modelSource =
    ms === "external" || ms === "local" || ms === "mock" ? ms : "local";
  const category = typeof raw.category === "string" && raw.category.trim() ? raw.category.trim() : "unknown";
  const inferenceInput =
    raw.inferenceInput != null && typeof raw.inferenceInput === "object" && !Array.isArray(raw.inferenceInput)
      ? /** @type {Record<string, unknown>} */ ({ ...raw.inferenceInput })
      : prepareInferenceInput(asset);

  return {
    category,
    labels: labels.length ? labels : [category],
    confidence,
    features,
    embeddings,
    modelSource,
    inferenceInput,
  };
}

/**
 * Mock provider: deterministic, rich labels — simulates future intelligence without APIs.
 * @type {ImageAnalysisProvider}
 */
export const mockImageAnalysisProvider = {
  id: "mock",
  /**
   * @param {ImageAssetLike} asset
   * @returns {ImageAnalysisResult}
   */
  analyzeImage(asset) {
    const ref = String(asset?.ref ?? "").toLowerCase();
    let category = "unknown";
    if (/\.(png|gif|webp|bmp)$/i.test(ref)) category = "raster_image";
    else if (/\.(jpg|jpeg)$/i.test(ref)) category = "raster_image";
    else if (/\.(svg|eps)$/i.test(ref)) category = "vector_image";

    return {
      category,
      labels: [category, "mock:preview", "pipeline:phase7"],
      confidence: 0.88,
      features: {
        mockSignal: true,
        heuristicBoost: 0.12,
      },
      embeddings: null,
      modelSource: "mock",
      inferenceInput: prepareInferenceInput(asset),
    };
  },
};

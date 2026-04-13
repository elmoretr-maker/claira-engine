/**
 * Oversight level + app mode → decision thresholds and conflict UI gating.
 * No label-pair rules — only confidence and margin.
 */

/** @typedef {"light" | "medium" | "strict"} OversightLevel */
/** @typedef {"setup" | "runtime"} AppMode */

/**
 * Effective thresholds for {@link decide}: higher confidence/margin required → more review.
 * @param {OversightLevel} oversightLevel
 * @param {AppMode} appMode
 * @param {{ confidence: number, margin: number }} base — from engine.config.json
 * @returns {{ confidence: number, margin: number }}
 */
export function getEffectiveDecisionThresholds(oversightLevel, appMode, base) {
  const bConf = typeof base?.confidence === "number" ? base.confidence : 0.85;
  const bMar = typeof base?.margin === "number" ? base.margin : 0.01;

  /** @type {{ confidence: number, margin: number }} */
  let t = { confidence: bConf, margin: bMar };

  if (oversightLevel === "light") {
    t = { confidence: 0.72, margin: 0.004 };
  } else if (oversightLevel === "strict") {
    t = { confidence: 0.90, margin: 0.022 };
  }

  if (appMode === "setup") {
    t = {
      confidence: Math.min(t.confidence + 0.05, 0.96),
      margin: Math.min(t.margin + 0.006, 0.05),
    };
  }

  return t;
}

/**
 * Build conflict UI options only from real cosine neighbors (no synthetic labels).
 * @param {unknown} raw — {@link classification.visualCosineTop3}
 * @returns {Array<{ label: string, score: number }>} at most 3 entries, deduped by label
 */
export function validVisualCosineOptions(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  /** @type {Array<{ label: string, score: number }>} */
  const out = [];
  const seen = new Set();

  for (const row of raw) {
    if (out.length >= 3) break;
    if (row == null || typeof row !== "object") continue;
    const id = /** @type {{ id?: unknown, cosine?: unknown }} */ (row).id;
    const cosine = /** @type {{ id?: unknown, cosine?: unknown }} */ (row).cosine;
    const label = typeof id === "string" ? id.trim() : "";
    if (!label) continue;
    if (typeof cosine !== "number" || !Number.isFinite(cosine)) continue;
    const k = label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ label, score: cosine });
  }

  return out;
}

/**
 * Merge cosine top labels with softmax / second_label so pattern-mismatch review can offer ≥2 choices.
 * @param {unknown} classification
 * @returns {Array<{ label: string, score: number }>}
 */
export function buildConflictCandidateOptions(classification) {
  const cls = classification && typeof classification === "object" ? classification : null;
  if (!cls) return [];

  const fromCos = validVisualCosineOptions(
    /** @type {{ visualCosineTop3?: unknown }} */ (cls).visualCosineTop3,
  );
  /** @type {Array<{ label: string, score: number }>} */
  const out = [...fromCos];
  const seen = new Set(out.map((o) => o.label.toLowerCase()));

  const softmax = /** @type {{ softmaxTop3?: unknown }} */ (cls).softmaxTop3;
  if (Array.isArray(softmax)) {
    for (const row of softmax) {
      if (out.length >= 5) break;
      if (row == null || typeof row !== "object") continue;
      const id = /** @type {{ id?: unknown, confidence?: unknown }} */ (row).id;
      const conf = /** @type {{ id?: unknown, confidence?: unknown }} */ (row).confidence;
      const label = typeof id === "string" ? id.trim() : "";
      if (!label) continue;
      const k = label.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      const score = typeof conf === "number" && Number.isFinite(conf) ? conf : 0;
      out.push({ label, score });
    }
  }

  const second = /** @type {{ second_label?: unknown }} */ (cls).second_label;
  const secondStr = typeof second === "string" ? second.trim() : "";
  if (secondStr && !seen.has(secondStr.toLowerCase())) {
    seen.add(secondStr.toLowerCase());
    out.push({ label: secondStr, score: 0.0001 });
  }

  return out;
}

/**
 * Whether to show classification conflict picker, given pre-fallback confidence/margin only.
 * Caller must ensure at least two valid cosine options exist.
 *
 * @param {{
 *   appMode: AppMode,
 *   oversightLevel: OversightLevel,
 *   preFallback: { confidence?: number, margin?: number } | null | undefined
 * }} p
 * @returns {boolean}
 */
export function shouldRequireConflictUserInput(p) {
  const { appMode, oversightLevel, preFallback } = p;

  const c = typeof preFallback?.confidence === "number" ? preFallback.confidence : 0;
  const m = typeof preFallback?.margin === "number" ? preFallback.margin : 0;

  if (appMode === "setup") return true;

  if (oversightLevel === "strict") return true;
  if (oversightLevel === "medium") return c < 0.78 || m < 0.012;
  return c < 0.58 || m < 0.006;
}

/**
 * @param {unknown} raw
 * @returns {OversightLevel}
 */
export function normalizeOversightLevel(raw) {
  const s = String(raw ?? "").toLowerCase();
  if (s === "light" || s === "strict") return s;
  return "medium";
}

/**
 * @param {unknown} raw
 * @returns {AppMode}
 */
export function normalizeAppMode(raw) {
  if (raw == null || String(raw).trim() === "") return "runtime";
  return String(raw).toLowerCase() === "setup" ? "setup" : "runtime";
}

/**
 * @param {{
 *   decision?: { decision?: string, reason?: string } | null,
 *   classification?: { predicted_label?: string | null, visualCosineTop3?: unknown } | null,
 *   classificationPreFallback?: { predicted_label?: string | null, confidence?: number, margin?: number } | null,
 * }} result
 * @param {string} absPath
 * @param {{ appMode?: string, oversightLevel?: string, expectedCategory?: string }} runtimeContext
 * @returns {{
 *   kind: "classification_conflict",
 *   predicted_label: string | null,
 *   options: Array<{ label: string, score: number }>,
 *   requires_user_input: true,
 *   filePath: string,
 *   tunnel_validation_mismatch?: boolean,
 *   expectedCategory?: string | null,
 *   potential_conflict?: boolean,
 *   strict_oversight?: boolean,
 * } | null}
 */
export function buildClassificationConflictPayload(result, absPath, runtimeContext) {
  if (result?.decision?.decision !== "review") return null;

  const cls = result.classification;
  const refCtx =
    cls && typeof cls === "object"
      ? /** @type {{ reference_context?: { potential_conflict?: unknown } }} */ (cls).reference_context
      : undefined;
  const potentialConflict =
    result?.decision?.reason === "reference_potential_conflict" ||
    refCtx?.potential_conflict === true;

  const pre = result.classificationPreFallback;
  const oversightLevel = normalizeOversightLevel(runtimeContext?.oversightLevel);
  const appMode = normalizeAppMode(runtimeContext?.appMode);
  const tunnelMismatch = result?.decision?.reason === "tunnel_expected_category_mismatch";
  const expectedCat =
    typeof runtimeContext?.expectedCategory === "string" ? runtimeContext.expectedCategory.trim() : "";

  const requirePicker =
    shouldRequireConflictUserInput({ appMode, oversightLevel, preFallback: pre }) || potentialConflict;

  if (!requirePicker) return null;

  let options = buildConflictCandidateOptions(cls);
  if (options.length < 2) return null;
  options = options.slice(0, 3);

  /** @type {{
   *   kind: "classification_conflict",
   *   predicted_label: string | null,
   *   options: Array<{ label: string, score: number }>,
   *   requires_user_input: true,
   *   filePath: string,
   *   tunnel_validation_mismatch?: boolean,
   *   expectedCategory?: string | null,
   *   potential_conflict?: boolean,
   *   strict_oversight?: boolean,
   * }} */
  const payload = {
    kind: "classification_conflict",
    predicted_label:
      cls != null &&
      typeof cls === "object" &&
      /** @type {{ predicted_label?: string | null }} */ (cls).predicted_label != null
        ? String(/** @type {{ predicted_label?: string | null }} */ (cls).predicted_label)
        : null,
    options,
    requires_user_input: true,
    filePath: absPath,
    potential_conflict: potentialConflict,
    strict_oversight: oversightLevel === "strict",
  };

  if (tunnelMismatch) {
    payload.tunnel_validation_mismatch = true;
    payload.expectedCategory = expectedCat || null;
  }

  return payload;
}

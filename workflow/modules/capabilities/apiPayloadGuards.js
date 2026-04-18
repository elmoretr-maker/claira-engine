/**
 * Shared type checks for capability HTTP/API payloads (fail fast in dev, clear errors).
 * Does not change business outcomes — rejects invalid *types* only.
 */

/**
 * @param {string} label
 * @param {unknown} v
 * @returns {string} trimmed string, or "" when absent
 */
export function optionalTrimmedString(label, v) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") {
    throw new TypeError(`${label} must be a string when provided`);
  }
  return v.trim();
}

/**
 * @param {string} label
 * @param {unknown} v
 */
export function requireNonEmptyString(label, v) {
  if (typeof v !== "string" || !v.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function pathsByStageAsStrings(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("pathsByStage must be a plain object");
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  /** @type {Record<string, string>} */
  const out = {};
  for (const key of Object.keys(o)) {
    const v = o[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") {
      throw new TypeError(`pathsByStage[${key}] must be a string`);
    }
    out[key] = v;
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function orderedStagesAsStrings(raw) {
  if (!Array.isArray(raw)) {
    throw new TypeError("orderedStages must be an array");
  }
  return raw.map((s, i) => {
    if (typeof s !== "string") {
      throw new TypeError(`orderedStages[${i}] must be a string`);
    }
    return s.trim();
  }).filter(Boolean);
}

/**
 * @param {unknown} raw
 * @returns {{ stageA: string, stageB: string, pathA: string, pathB: string }[]}
 */
export function assertFitnessImagePairsArray(raw) {
  if (!Array.isArray(raw)) {
    throw new TypeError("imagePairs must be an array");
  }
  return raw.map((row, i) => {
    if (row == null || typeof row !== "object" || Array.isArray(row)) {
      throw new TypeError(`imagePairs[${i}] must be an object`);
    }
    const rec = /** @type {Record<string, unknown>} */ (row);
    const pathA = optionalTrimmedString(`imagePairs[${i}].pathA`, rec.pathA);
    const pathB = optionalTrimmedString(`imagePairs[${i}].pathB`, rec.pathB);
    if (!pathA || !pathB) {
      throw new TypeError(`imagePairs[${i}] requires non-empty pathA and pathB`);
    }
    return {
      stageA: optionalTrimmedString(`imagePairs[${i}].stageA`, rec.stageA),
      stageB: optionalTrimmedString(`imagePairs[${i}].stageB`, rec.stageB),
      pathA,
      pathB,
    };
  });
}

/**
 * @param {unknown} paths
 */
export function assertTaxPathsEntries(paths) {
  if (!Array.isArray(paths)) return;
  paths.forEach((p, i) => {
    if (p != null && typeof p !== "string") {
      throw new TypeError(`paths[${i}] must be a string`);
    }
  });
}

/**
 * @param {unknown} uploads
 */
export function assertTaxUploadsEntries(uploads) {
  if (!Array.isArray(uploads)) return;
  uploads.forEach((u, i) => {
    if (u == null || typeof u !== "object" || Array.isArray(u)) {
      throw new TypeError(`uploads[${i}] must be an object`);
    }
    const rec = /** @type {Record<string, unknown>} */ (u);
    if (rec.name != null && typeof rec.name !== "string") {
      throw new TypeError(`uploads[${i}].name must be a string when provided`);
    }
    if (rec.dataBase64 != null && typeof rec.dataBase64 !== "string") {
      throw new TypeError(`uploads[${i}].dataBase64 must be a string when provided`);
    }
  });
}

/**
 * @param {unknown} raw
 * @returns {string[] | undefined}
 */
export function taxSelectedFieldsAsStrings(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new TypeError("selectedFields must be an array");
  }
  return raw.map((f, i) => {
    if (typeof f !== "string") {
      throw new TypeError(`selectedFields[${i}] must be a string`);
    }
    return f;
  });
}

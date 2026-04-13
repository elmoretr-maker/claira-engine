/**
 * Browser client — same exports as interfaces/api.js, routed through Vite dev middleware.
 */

async function post(body) {
  const r = await fetch("/__claira/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
    throw new Error("Invalid JSON from server");
  }
  if (!r.ok) throw new Error(typeof data?.error === "string" ? data.error : text || `HTTP ${r.status}`);
  return data;
}

/**
 * @param {string} inputPath
 * @param {{ cwd?: string, runtimeContext?: { appMode?: string, oversightLevel?: string, expectedCategory?: string } }} [options]
 */
export function processFolder(inputPath, options) {
  return post({
    kind: "processFolder",
    folderPath: inputPath,
    cwd: options?.cwd,
    runtimeContext: options?.runtimeContext,
  });
}

/**
 * @param {unknown[]} normalizedData
 * @param {{ cwd?: string, runtimeContext?: { appMode?: string, oversightLevel?: string, expectedCategory?: string } }} [options]
 */
export function processData(normalizedData, options) {
  return post({
    kind: "processData",
    items: normalizedData,
    cwd: options?.cwd,
    runtimeContext: options?.runtimeContext,
  });
}

/**
 * @param {{
 *   predicted_label?: string | null,
 *   selected_label?: string | null,
 *   confidence?: number,
 *   filePath?: string | null,
 *   scope?: "global" | "single",
 *   extractedText?: string | null,
 *   classification?: object | null,
 *   mismatchSeverity?: "high" | "medium" | "low",
 * }} payload
 */
export function applyDecision(payload) {
  return post({
    kind: "applyDecision",
    predicted_label: payload?.predicted_label,
    selected_label: payload?.selected_label,
    confidence: payload?.confidence,
    filePath: payload?.filePath,
    scope: payload?.scope,
    extractedText: payload?.extractedText,
    classification: payload?.classification,
    mismatchSeverity: payload?.mismatchSeverity,
    mismatchFingerprint: payload?.mismatchFingerprint,
    mismatchReason: payload?.mismatchReason,
  });
}

/** @returns {Promise<{ categories: unknown[], confusionPairs: unknown[], generatedAt: string }>} */
export function getRiskInsights() {
  return post({ kind: "getRiskInsights" });
}

/**
 * @param {{ source: string, input?: unknown }} args
 * @param {{ cwd?: string }} [options]
 */
export function ingestData(args, options) {
  return post({ kind: "ingestData", payload: args, cwd: options?.cwd });
}

/** @param {{ cwd?: string }} [options] */
export function getRooms(options) {
  return post({ kind: "getRooms", cwd: options?.cwd });
}

/** @param {{ cwd?: string }} [options] */
export function getSuggestions(options) {
  return post({ kind: "getSuggestions", cwd: options?.cwd });
}

/**
 * @param {string} industry
 * @param {{ cwd?: string }} [options]
 */
export function loadIndustryPack(industry, options) {
  return post({ kind: "loadIndustryPack", industry, cwd: options?.cwd });
}

/** @param {{ cwd?: string }} [options] */
export function getStructureCategories(options) {
  return post({ kind: "getStructureCategories", cwd: options?.cwd });
}

/** @param {{ cwd?: string }} [options] */
export function getPackReference(options) {
  return post({ kind: "getPackReference", cwd: options?.cwd });
}

/** @returns {Promise<{ ok: boolean, packs: Array<{ slug: string, label: string, inputVerb?: string }> }>} */
export function listIndustryPacks() {
  return post({ kind: "listIndustryPacks" });
}

/** @returns {Promise<{ connected: boolean, detail: string, checked?: unknown[] }>} */
export function checkInternetConnection() {
  return post({ kind: "checkInternetConnection" });
}

/**
 * @param {{ industryName: string }} payload
 * @returns {Promise<Record<string, unknown>>}
 */
export function createIndustryFromInput(payload) {
  return post({
    kind: "createIndustryFromInput",
    industryName: typeof payload?.industryName === "string" ? payload.industryName : "",
  });
}

/**
 * @param {{ slug: string }} payload
 */
export function confirmIndustryPackActivation(payload) {
  return post({
    kind: "confirmIndustryPackActivation",
    slug: typeof payload?.slug === "string" ? payload.slug : "",
  });
}

/**
 * @param {{ slug: string }} payload
 */
export function getIndustryBuildReport(payload) {
  return post({
    kind: "getIndustryBuildReport",
    slug: typeof payload?.slug === "string" ? payload.slug : "",
  });
}

/**
 * @param {{ slug: string }} payload
 */
export function autoImproveIndustryPack(payload) {
  return post({
    kind: "autoImproveIndustryPack",
    slug: typeof payload?.slug === "string" ? payload.slug : "",
  });
}

/** @param {{ industry: string }} payload */
export function getIndustryFeatures(payload) {
  return post({
    kind: "getIndustryFeatures",
    industry: typeof payload?.industry === "string" ? payload.industry : "",
  });
}

/** @param {{ industry: string }} payload */
export function getTrackingConfig(payload) {
  return post({
    kind: "getTrackingConfig",
    industry: typeof payload?.industry === "string" ? payload.industry : "",
  });
}

/** @param {{ industry: string, categoryKey: string }} payload */
export function categoryTrackingSupport(payload) {
  return post({
    kind: "categoryTrackingSupport",
    industry: typeof payload?.industry === "string" ? payload.industry : "",
    categoryKey: typeof payload?.categoryKey === "string" ? payload.categoryKey : "",
  });
}

/** @param {{ industry?: string }} payload */
export function listTrackingEntities(payload) {
  return post({
    kind: "listTrackingEntities",
    industry: typeof payload?.industry === "string" ? payload.industry : "",
  });
}

/** @param {{ name: string, category: string, industry: string }} payload */
export function createTrackingEntity(payload) {
  return post({
    kind: "createTrackingEntity",
    name: typeof payload?.name === "string" ? payload.name : "",
    category: typeof payload?.category === "string" ? payload.category : "",
    industry: typeof payload?.industry === "string" ? payload.industry : "",
  });
}

/** @param {{ entityId: string, imageBase64?: string, manualMetrics?: Record<string, number>, categoryKey?: string, industrySlug?: string }} payload */
export function addTrackingSnapshot(payload) {
  return post({
    kind: "addTrackingSnapshot",
    entityId: typeof payload?.entityId === "string" ? payload.entityId : "",
    imageBase64: typeof payload?.imageBase64 === "string" ? payload.imageBase64 : "",
    manualMetrics:
      payload?.manualMetrics && typeof payload.manualMetrics === "object" ? payload.manualMetrics : undefined,
    categoryKey: typeof payload?.categoryKey === "string" ? payload.categoryKey : "",
    industrySlug: typeof payload?.industrySlug === "string" ? payload.industrySlug : "",
  });
}

/** @param {{ entityId: string }} payload */
export function listTrackingSnapshots(payload) {
  return post({
    kind: "listTrackingSnapshots",
    entityId: typeof payload?.entityId === "string" ? payload.entityId : "",
  });
}

/** @param {{ entityId: string }} payload */
export function getTrackingProgress(payload) {
  return post({
    kind: "getTrackingProgress",
    entityId: typeof payload?.entityId === "string" ? payload.entityId : "",
  });
}

/**
 * @param {string} category
 * @param {string} [industryOverride]
 */
export function getActiveReferenceAssets(category, industryOverride) {
  return post({
    kind: "getActiveReferenceAssets",
    category,
    industry: industryOverride,
  });
}

/**
 * @param {{ industry?: string, cwd?: string }} [options]
 */
export function getPackProcesses(options) {
  return post({
    kind: "getPackProcesses",
    industry: options?.industry,
    cwd: options?.cwd,
  });
}

/**
 * @param {string[]} selectedKeys
 * @param {{ cwd?: string }} [options]
 */
export function ensureCapabilityOutputFolders(selectedKeys, options) {
  return post({
    kind: "ensureCapabilityOutputFolders",
    selectedKeys,
    cwd: options?.cwd,
  });
}

/**
 * @param {string} category
 * @param {{ name: string, base64: string }[]} files
 * @param {{ cwd?: string, uploadTag?: { type: string, category?: string } }} [options]
 */
export function tunnelUploadStaged(category, files, options) {
  return post({
    kind: "tunnelUploadStaged",
    category,
    files,
    cwd: options?.cwd,
    uploadTag: options?.uploadTag,
  });
}

/** @returns {Promise<string>} */
export async function getMovesLog() {
  const r = await fetch("/api/logs");
  const text = await r.text();
  if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
  return text;
}

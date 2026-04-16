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
 * @param {{ cwd?: string, workflowContext?: { entityId?: string, clientId?: string }, runtimeContext?: {
 *   appMode?: string,
 *   oversightLevel?: string,
 *   expectedCategory?: string,
 *   autoMove?: boolean,
 *   strictValidation?: boolean,
 *   reviewThreshold?: number,
 * } }} [options]
 */
export function processFolder(inputPath, options) {
  return post({
    kind: "processFolder",
    folderPath: inputPath,
    cwd: options?.cwd,
    runtimeContext: options?.runtimeContext,
    workflowContext: options?.workflowContext,
  });
}

/**
 * @param {unknown[]} normalizedData
 * @param {{ cwd?: string, workflowContext?: { entityId?: string, clientId?: string }, runtimeContext?: {
 *   appMode?: string,
 *   oversightLevel?: string,
 *   expectedCategory?: string,
 *   autoMove?: boolean,
 *   strictValidation?: boolean,
 *   reviewThreshold?: number,
 * } }} [options]
 */
export function processData(normalizedData, options) {
  return post({
    kind: "processData",
    items: normalizedData,
    cwd: options?.cwd,
    runtimeContext: options?.runtimeContext,
    workflowContext: options?.workflowContext,
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
    decision_type: payload?.decision_type,
    predicted_label: payload?.predicted_label,
    selected_label: payload?.selected_label,
    selected_room: payload?.selected_room,
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

/** @returns {Promise<{ rules: unknown[], bypassLog: unknown[] }>} */
export function getUserControlState() {
  return post({ kind: "getUserControlState" });
}

/**
 * @param {{
 *   predicted_label: string,
 *   effect: "force_review" | "bypass_review",
 *   enabled?: boolean,
 *   remove?: boolean,
 * }} payload
 */
export function setUserControlRule(payload) {
  return post({
    kind: "setUserControlRule",
    predicted_label: payload.predicted_label,
    effect: payload.effect,
    enabled: payload.enabled,
    remove: payload.remove === true,
  });
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
 * @param {{
 *   industryName: string,
 *   buildIntent?: string,
 *   guidedModuleSignals?: { trackPeople?: boolean, trackActivity?: boolean, trackFiles?: boolean },
 * }} payload
 * @returns {Promise<Record<string, unknown>>}
 */
export function previewIndustryModuleComposition(payload) {
  const body = {
    kind: "previewIndustryModuleComposition",
    industryName: typeof payload?.industryName === "string" ? payload.industryName : "",
    buildIntent: typeof payload?.buildIntent === "string" ? payload.buildIntent : "",
  };
  const g = payload?.guidedModuleSignals;
  if (g != null && typeof g === "object") {
    body.guidedModuleSignals = {
      trackPeople: g.trackPeople === true,
      trackActivity: g.trackActivity === true,
      trackFiles: g.trackFiles === true,
    };
  }
  return post(body);
}

/**
 * @param {{ industryName: string, buildIntent?: string, selectedModules: string[] }} payload
 * @returns {Promise<Record<string, unknown>>}
 */
export function createIndustryFromInput(payload) {
  return post({
    kind: "createIndustryFromInput",
    industryName: typeof payload?.industryName === "string" ? payload.industryName : "",
    buildIntent: typeof payload?.buildIntent === "string" ? payload.buildIntent : "",
    selectedModules: Array.isArray(payload?.selectedModules) ? payload.selectedModules : [],
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

/**
 * @param {{ industry: string, mode?: string, accountId?: string }} args
 * @returns {Promise<Record<string, unknown>>}
 */
export function workspaceScan(args) {
  return post({
    kind: "workspaceScan",
    industry: typeof args?.industry === "string" ? args.industry : "",
    mode: args?.mode,
    accountId: typeof args?.accountId === "string" ? args.accountId : undefined,
  });
}

/**
 * @param {{ industry: string, mode?: string, accountId?: string, operations?: unknown[] }} args
 * @returns {Promise<Record<string, unknown>>}
 */
export function workspaceSync(args) {
  return post({
    kind: "workspaceSync",
    industry: typeof args?.industry === "string" ? args.industry : "",
    mode: args?.mode,
    accountId: typeof args?.accountId === "string" ? args.accountId : undefined,
    operations: Array.isArray(args?.operations) ? args.operations : [],
  });
}

/**
 * @param {{ industry: string, accountId?: string, files: Array<{ name: string, base64: string }> }} args
 * @returns {Promise<Record<string, unknown>>}
 */
export function workspaceSimulationIngest(args) {
  return post({
    kind: "workspaceSimulationIngest",
    industry: typeof args?.industry === "string" ? args.industry : "",
    mode: args?.mode,
    accountId: typeof args?.accountId === "string" ? args.accountId : undefined,
    files: Array.isArray(args?.files) ? args.files : [],
  });
}

/**
 * @param {{ industry: string, mode?: string, accountId?: string }} args
 * @returns {Promise<Record<string, unknown>>}
 */
export function workspaceGeneratorSnapshot(args) {
  return post({
    kind: "workspaceGeneratorSnapshot",
    industry: typeof args?.industry === "string" ? args.industry : "",
    mode: args?.mode,
    accountId: typeof args?.accountId === "string" ? args.accountId : undefined,
  });
}

/**
 * @param {{ displayName: string }} payload
 * @returns {Promise<Record<string, unknown>>}
 */
export function createTrainerClient(payload) {
  return post({
    kind: "createTrainerClient",
    displayName: typeof payload?.displayName === "string" ? payload.displayName : "",
  });
}

/** Domain-agnostic alias (same API as createTrainerClient). */
export function createEntity(payload) {
  return createTrainerClient(payload);
}

/** @returns {Promise<Record<string, unknown>>} */
export function listTrainerClients() {
  return post({ kind: "listTrainerClients" });
}

/** Domain-agnostic alias (same API as listTrainerClients). */
export function listEntities() {
  return listTrainerClients();
}

/**
 * @param {{ entityId?: string, clientId?: string }} payload
 * @returns {Promise<Record<string, unknown>>}
 */
export function getTrainerClient(payload) {
  return post({
    kind: "getTrainerClient",
    entityId: typeof payload?.entityId === "string" ? payload.entityId : "",
    clientId: typeof payload?.clientId === "string" ? payload.clientId : "",
  });
}

/** Domain-agnostic alias (same API as getTrainerClient). */
export function getEntity(payload) {
  return getTrainerClient(payload);
}

/** @returns {Promise<Record<string, unknown>>} */
export function getActiveWorkflowTemplate() {
  return post({ kind: "getActiveWorkflowTemplate" });
}

/** @returns {Promise<Record<string, unknown>>} */
export function listWorkflowCompositions() {
  return post({ kind: "listWorkflowCompositions" });
}

/** @returns {Promise<string>} */
export async function getMovesLog() {
  const r = await fetch("/api/logs");
  const text = await r.text();
  if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
  return text;
}

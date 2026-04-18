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

/**
 * Records user category override from the Reasoning panel (feedbackStore only).
 * @param {{
 *   originalCategory?: string | null,
 *   correctedCategory?: string,
 *   chosenCategory: string,
 *   filename?: string,
 *   originalLabels?: string[],
 *   semanticTokens?: string[],
 *   labelThemes?: string[],
 *   reasoningContext?: Record<string, unknown>,
 * }} payload
 */
export function recordReasoningOverrideFeedback(payload) {
  return post({
    kind: "recordReasoningOverrideFeedback",
    payload: payload ?? {},
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

/**
 * Compare two tax PDFs (read-only). Tries Express `/api/capabilities/tax-compare` when present, else `/__claira/run`.
 * @param {{
 *   cwd?: string,
 *   paths?: string[],
 *   uploads?: Array<{ name: string, dataBase64: string }>,
 *   selectedFields?: string[],
 *   anomalyThresholdPct?: number,
 * }} [payload]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runTaxDocumentComparison(payload = {}) {
  const bodyObj = {
    cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
    domainMode: "tax",
    ...(Array.isArray(payload.paths) ? { paths: payload.paths } : {}),
    ...(Array.isArray(payload.uploads) ? { uploads: payload.uploads } : {}),
    ...(Array.isArray(payload.selectedFields) ? { selectedFields: payload.selectedFields } : {}),
    ...(typeof payload.anomalyThresholdPct === "number" && Number.isFinite(payload.anomalyThresholdPct)
      ? { anomalyThresholdPct: payload.anomalyThresholdPct }
      : {}),
  };
  try {
    const r = await fetch("/api/capabilities/tax-compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj),
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (data != null && typeof data === "object") return /** @type {Record<string, unknown>} */ (data);
  } catch {
    /* use Vite run */
  }
  return post({ kind: "taxDocumentComparison", ...bodyObj });
}

/**
 * Attach per-row capability results (product modules). Tries production API first, then Vite dev `/__claira/run`.
 * @param {unknown[]} rows
 * @param {{ cwd?: string, domainMode?: string, planMode?: "single" | "planned" }} [options]
 * @returns {Promise<unknown[]>}
 */
export async function attachPipelineCapabilities(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const cwd = typeof options?.cwd === "string" ? options.cwd : undefined;
  const domainMode = typeof options?.domainMode === "string" ? options.domainMode : undefined;
  const planMode = options?.planMode === "planned" ? "planned" : "single";
  const body = JSON.stringify({
    rows: safeRows,
    ...(cwd ? { cwd } : {}),
    ...(domainMode ? { domainMode } : {}),
    planMode,
  });

  try {
    const r = await fetch("/api/capabilities/attach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (r.ok && data != null && typeof data === "object" && Array.isArray(data.rows)) {
      return data.rows;
    }
    console.warn(
      "[attachPipelineCapabilities] POST /api/capabilities/attach failed:",
      r.status,
      typeof text === "string" ? text.slice(0, 400) : text,
    );
  } catch (e) {
    console.warn("[attachPipelineCapabilities] /api/capabilities/attach unreachable:", e);
  }

  try {
    const data = await post({
      kind: "attachPipelineCapabilities",
      rows: safeRows,
      cwd,
      ...(domainMode ? { domainMode } : {}),
      planMode,
    });
    if (data != null && typeof data === "object" && Array.isArray(data.rows)) return data.rows;
  } catch (e2) {
    console.warn("[attachPipelineCapabilities] fallback POST /__claira/run failed:", e2);
  }
  return safeRows;
}

const LS_APPLIED_CAP = "claira.appliedCapabilities.v1";

/**
 * @returns {Promise<Record<string, unknown>>}
 */
export async function fetchAppliedCapabilityByRowId() {
  try {
    const r = await fetch("/api/capabilities/applied");
    if (r.ok) {
      const data = await r.json();
      if (data != null && typeof data === "object" && data.ok === true && data.byRowId != null && typeof data.byRowId === "object") {
        try {
          localStorage.setItem(LS_APPLIED_CAP, JSON.stringify(data.byRowId));
        } catch {
          /* ignore quota */
        }
        return /** @type {Record<string, unknown>} */ (data.byRowId);
      }
    }
    console.warn("[fetchAppliedCapabilityByRowId] HTTP", r.status, await r.text().catch(() => ""));
  } catch (e) {
    console.warn("[fetchAppliedCapabilityByRowId] unreachable, trying localStorage:", e);
  }
  try {
    const raw = localStorage.getItem(LS_APPLIED_CAP);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * @param {{
 *   rowId: string,
 *   moduleId: string,
 *   originalValues: Record<string, unknown>,
 *   finalValues: Record<string, unknown>,
 *   timestamp: number,
 *   simulation?: Record<string, unknown>,
 * }} record
 */
export async function persistAppliedCapabilityRecord(record) {
  try {
    const r = await fetch("/api/capabilities/applied", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    if (r.ok) {
      try {
        const raw = localStorage.getItem(LS_APPLIED_CAP);
        const byRowId = raw && typeof raw === "string" ? JSON.parse(raw) : {};
        byRowId[record.rowId] = { ...record };
        localStorage.setItem(LS_APPLIED_CAP, JSON.stringify(byRowId));
      } catch {
        /* ignore */
      }
      return { ok: true, localFallback: false };
    }
    const t = await r.text();
    console.warn("[persistAppliedCapabilityRecord] server:", r.status, t.slice(0, 300));
  } catch (e) {
    console.warn("[persistAppliedCapabilityRecord] server unreachable:", e);
  }
  try {
    const raw = localStorage.getItem(LS_APPLIED_CAP);
    const byRowId = raw && typeof raw === "string" ? JSON.parse(raw) : {};
    byRowId[record.rowId] = { ...record };
    localStorage.setItem(LS_APPLIED_CAP, JSON.stringify(byRowId));
    console.warn("[persistAppliedCapabilityRecord] used localStorage fallback");
    return { ok: true, localFallback: true };
  } catch (e2) {
    console.warn("[persistAppliedCapabilityRecord] localStorage failed:", e2);
    return { ok: false, error: String(e2) };
  }
}

/**
 * @param {{
 *   rowId: string,
 *   moduleId: string,
 *   originalValues: Record<string, unknown>,
 *   finalValues: Record<string, unknown>,
 *   filename?: string,
 *   timestamp?: number,
 * }} payload
 */
export async function recordCapabilityOverride(payload) {
  try {
    const r = await fetch("/api/capabilities/record-override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data && data.ok !== false) return data;
    console.warn("[recordCapabilityOverride] POST /api failed:", r.status, data);
  } catch (e) {
    console.warn("[recordCapabilityOverride] POST /api unreachable:", e);
  }
  return post({
    kind: "recordCapabilityOverride",
    rowId: typeof payload?.rowId === "string" ? payload.rowId : "",
    moduleId: typeof payload?.moduleId === "string" ? payload.moduleId : "",
    originalValues: payload?.originalValues,
    finalValues: payload?.finalValues,
    filename: payload?.filename,
    timestamp: payload?.timestamp,
  });
}

/**
 * @param {{
 *   row: unknown,
 *   rowIndex: number,
 *   allRows: unknown[],
 *   cwd?: string,
 *   inputOverrides?: Record<string, unknown>,
 * }} payload
 */
export async function previewCapabilityRow(payload) {
  try {
    const r = await fetch("/api/capabilities/preview-row", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data && data.ok === true) return data;
    console.warn("[previewCapabilityRow] POST /api failed:", r.status, data);
  } catch (e) {
    console.warn("[previewCapabilityRow] POST /api unreachable:", e);
  }
  return post({
    kind: "previewCapabilityRow",
    row: payload?.row,
    rowIndex: payload?.rowIndex,
    allRows: payload?.allRows,
    cwd: payload?.cwd,
    inputOverrides: payload?.inputOverrides,
  });
}

/** @returns {Promise<string>} */
export async function getMovesLog() {
  const r = await fetch("/api/logs");
  const text = await r.text();
  if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
  return text;
}

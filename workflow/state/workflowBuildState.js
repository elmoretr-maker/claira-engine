/**
 * Workflow build state engine — single source for category creation flow.
 * Transitions are explicit; analyzer updates merge into existing state (no blind resets).
 * See MODULE_DISCOVERY_WORKING.md (guided resolution, no fallbacks).
 */

import { MODULE_SELECTION_ORDER, validateWorkflowModuleSelection } from "../contracts/workflowRules.js";
import { moduleIdsFromGuidedSignals } from "../moduleMapping/guidedModuleSignals.js";
import { domainExpectedModules } from "../moduleMapping/domainExpectedCoverage.js";

/**
 * @typedef {'init' | 'input' | 'guided' | 'analyzed' | 'clarify' | 'select' | 'confirm' | 'build'} WorkflowBuildStep
 */

/**
 * @typedef {{
 *   step: WorkflowBuildStep,
 *   entryPath: 'input' | 'guided',
 *   industryName: string,
 *   buildIntent: string,
 *   detectedModules: string[],
 *   affirmedModuleIds: string[],
 *   knownModuleIds: string[],
 *   domainSignals: string[],
 *   expectedModules: string[],
 *   missingModules: string[],
 *   userSelections: string[],
 *   moduleSelectionById: Record<string, boolean>,
 *   confirmed: boolean,
 *   needsClarification: boolean,
 *   history: Array<Record<string, unknown>>,
 *   analysisSnapshot: Record<string, unknown> | null,
 *   guidedDraft: {
 *     trackPeople: boolean,
 *     trackActivity: boolean,
 *     trackFiles: boolean,
 *     goal: string,
 *     system: string,
 *     domain: string,
 *   },
 *   clarificationSeedModuleIds: string[],
 * }} WorkflowBuildState
 */

function emptyModuleRecord() {
  /** @type {Record<string, boolean>} */
  const r = {};
  for (const id of MODULE_SELECTION_ORDER) r[id] = false;
  return r;
}

function pushHistory(state, entry) {
  return {
    ...state,
    history: [...state.history, { at: Date.now(), ...entry }],
  };
}

function expectedModulesUnion(domainIds) {
  const u = new Set();
  for (const did of domainIds) {
    const exp = domainExpectedModules[did];
    if (exp) for (const m of exp) u.add(m);
  }
  return MODULE_SELECTION_ORDER.filter((id) => u.has(id));
}

/** @returns {WorkflowBuildState} */
export function createInitialWorkflowBuildState() {
  return {
    step: "input",
    entryPath: "input",
    industryName: "",
    buildIntent: "",
    detectedModules: [],
    affirmedModuleIds: [],
    knownModuleIds: [],
    domainSignals: [],
    expectedModules: [],
    missingModules: [],
    userSelections: [],
    moduleSelectionById: emptyModuleRecord(),
    confirmed: false,
    needsClarification: false,
    history: [],
    analysisSnapshot: null,
    guidedDraft: {
      trackPeople: false,
      trackActivity: false,
      trackFiles: false,
      goal: "",
      system: "",
      domain: "",
    },
    clarificationSeedModuleIds: [],
  };
}

/**
 * init → input (default initial state uses input; use this if step starts at init).
 * @param {WorkflowBuildState} state
 * @returns {WorkflowBuildState}
 */
export function transitionInitToInput(state) {
  if (state.step !== "init") return state;
  return pushHistory({ ...state, step: "input" }, { action: "initToInput", to: "input" });
}

/**
 * User chooses freeform vs guided entry.
 * @param {WorkflowBuildState} state
 * @param {'input' | 'guided'} mode
 * @returns {WorkflowBuildState}
 */
export function transitionChooseEntryPath(state, mode) {
  const to = mode === "guided" ? "guided" : "input";
  const next = { ...state, step: to, entryPath: to };
  return pushHistory(next, { action: "chooseEntryPath", from: state.step, to });
}

/**
 * @param {WorkflowBuildState} state
 * @param {{ industryName?: string, buildIntent?: string }} fields
 * @returns {WorkflowBuildState}
 */
export function patchIndustryFields(state, fields) {
  return {
    ...state,
    industryName: typeof fields.industryName === "string" ? fields.industryName : state.industryName,
    buildIntent: typeof fields.buildIntent === "string" ? fields.buildIntent : state.buildIntent,
  };
}

/**
 * Guided questionnaire draft; keeps affirmedModuleIds in sync (intent signals only).
 * @param {WorkflowBuildState} state
 * @param {Partial<WorkflowBuildState['guidedDraft']>} draftPatch
 * @returns {WorkflowBuildState}
 */
export function patchGuidedDraft(state, draftPatch) {
  const guidedDraft = { ...state.guidedDraft, ...draftPatch };
  const affirmedModuleIds = moduleIdsFromGuidedSignals({
    trackPeople: guidedDraft.trackPeople,
    trackActivity: guidedDraft.trackActivity,
    trackFiles: guidedDraft.trackFiles,
  });
  return { ...state, guidedDraft, affirmedModuleIds };
}

/**
 * API payload for preview — only when guided path.
 * @param {WorkflowBuildState} state
 * @returns {{ trackPeople?: boolean, trackActivity?: boolean, trackFiles?: boolean } | undefined}
 */
export function getGuidedModuleSignalsForApi(state) {
  if (state.entryPath !== "guided") return undefined;
  return {
    trackPeople: state.guidedDraft.trackPeople === true,
    trackActivity: state.guidedDraft.trackActivity === true,
    trackFiles: state.guidedDraft.trackFiles === true,
  };
}

/**
 * Analyzer completed: merge snapshot into state, route analyzed → clarify | select (logged in history).
 * @param {WorkflowBuildState} state
 * @param {Record<string, unknown>} apiResult — analyzeModuleCompositionForBuild success payload
 * @returns {{ state: WorkflowBuildState, ok: true, error: null } | { state: WorkflowBuildState, ok: false, error: string }}
 */
export function applyAnalyzerToWorkflowBuildState(state, apiResult) {
  if (!apiResult || apiResult.ok !== true) {
    return {
      state,
      ok: false,
      error: typeof apiResult?.error === "string" ? apiResult.error : "Analysis failed",
    };
  }

  const cs = /** @type {{ domainSignals?: { matchedDomainIds?: string[] }, knownModuleIds?: string[], affirmedModuleIds?: string[] } | undefined} */ (
    apiResult.clarificationState
  );
  const domains = Array.isArray(cs?.domainSignals?.matchedDomainIds) ? cs.domainSignals.matchedDomainIds : [];
  const detail = /** @type {{ modulesToResolve?: string[] } | undefined} */ (apiResult.clarificationDetail);
  const modulesToResolve = Array.isArray(detail?.modulesToResolve) ? detail.modulesToResolve : [];
  const nextKnown = Array.isArray(cs?.knownModuleIds) ? [...cs.knownModuleIds] : [];
  const expected = expectedModulesUnion(domains);
  const needsClarification = apiResult.needsClarification === true;
  const targetStep = needsClarification ? "clarify" : "select";

  const moduleSelectionById = emptyModuleRecord();
  /** @type {string[]} */
  let userSelections = [];
  if (!needsClarification) {
    for (const id of /** @type {string[]} */ (apiResult.detectedModules ?? [])) {
      if (MODULE_SELECTION_ORDER.includes(id)) moduleSelectionById[id] = true;
    }
    userSelections = MODULE_SELECTION_ORDER.filter((id) => moduleSelectionById[id]);
  }

  const affirmedFromApi = Array.isArray(cs?.affirmedModuleIds) ? cs.affirmedModuleIds : state.affirmedModuleIds;

  let next = {
    ...state,
    detectedModules: [...(/** @type {string[]} */ (apiResult.detectedModules ?? []))],
    affirmedModuleIds: [...affirmedFromApi],
    knownModuleIds: nextKnown,
    domainSignals: [...domains],
    expectedModules: expected,
    missingModules: [...modulesToResolve],
    needsClarification,
    analysisSnapshot: apiResult,
    confirmed: false,
    clarificationSeedModuleIds: [],
    moduleSelectionById,
    userSelections,
    step: targetStep,
  };

  next = pushHistory(next, {
    action: "analyzerComplete",
    through: "analyzed",
    from: state.step,
    to: targetStep,
    needsClarification,
  });

  return { state: next, ok: true, error: null };
}

/**
 * @param {WorkflowBuildState} state
 * @param {string} moduleId
 * @param {boolean} checked
 * @returns {WorkflowBuildState}
 */
export function patchModuleSelectionToggle(state, moduleId, checked) {
  if (!MODULE_SELECTION_ORDER.includes(moduleId)) return state;
  return {
    ...state,
    moduleSelectionById: { ...state.moduleSelectionById, [moduleId]: checked },
  };
}

/**
 * clarify → select: merge known ∪ picks; validate; persist userSelections.
 * @param {WorkflowBuildState} state
 * @returns {{ state: WorkflowBuildState, ok: true, error: null } | { state: WorkflowBuildState, ok: false, error: string }}
 */
export function transitionClarifyToSelect(state) {
  const snap = state.analysisSnapshot;
  const known = Array.isArray(snap?.clarificationState?.knownModuleIds)
    ? /** @type {string[]} */ (snap.clarificationState.knownModuleIds)
    : state.knownModuleIds;
  const picked = MODULE_SELECTION_ORDER.filter((id) => state.moduleSelectionById[id]);
  const merged = [...new Set([...known, ...picked])];
  const err = validateWorkflowModuleSelection(merged);
  if (err) return { state, ok: false, error: err };

  const detectedSet = new Set(/** @type {string[]} */ (snap?.detectedModules ?? []));
  const clarificationSeedModuleIds = picked.filter((id) => !detectedSet.has(id));

  const moduleSelectionById = emptyModuleRecord();
  for (const id of merged) moduleSelectionById[id] = true;

  let next = {
    ...state,
    step: "select",
    userSelections: merged,
    moduleSelectionById,
    clarificationSeedModuleIds,
    knownModuleIds: [...new Set([...state.knownModuleIds, ...picked])],
  };
  next = pushHistory(next, { action: "clarifyToSelect", from: "clarify", to: "select" });
  return { state: next, ok: true, error: null };
}

/**
 * select → confirm
 * @param {WorkflowBuildState} state
 * @returns {{ state: WorkflowBuildState, ok: true, error: null } | { state: WorkflowBuildState, ok: false, error: string }}
 */
export function transitionSelectToConfirm(state) {
  const ids = MODULE_SELECTION_ORDER.filter((id) => state.moduleSelectionById[id]);
  const err = validateWorkflowModuleSelection(ids);
  if (err) return { state, ok: false, error: err };
  let next = {
    ...state,
    step: "confirm",
    userSelections: ids,
    confirmed: true,
  };
  next = pushHistory(next, { action: "selectToConfirm", from: "select", to: "confirm" });
  return { state: next, ok: true, error: null };
}

/**
 * confirm → build (pipeline start; no API here).
 * @param {WorkflowBuildState} state
 * @returns {WorkflowBuildState}
 */
export function transitionConfirmToBuild(state) {
  let next = { ...state, step: "build" };
  return pushHistory(next, { action: "confirmToBuild", from: "confirm", to: "build" });
}

/**
 * Clear analysis branch; keep industry copy + guided draft + entry path + history.
 * @param {WorkflowBuildState} state
 * @returns {WorkflowBuildState}
 */
export function transitionBackToInput(state) {
  const entryStep = state.entryPath === "guided" ? "guided" : "input";
  const affirmedModuleIds = moduleIdsFromGuidedSignals({
    trackPeople: state.guidedDraft.trackPeople,
    trackActivity: state.guidedDraft.trackActivity,
    trackFiles: state.guidedDraft.trackFiles,
  });
  let next = {
    ...state,
    step: entryStep,
    detectedModules: [],
    knownModuleIds: [],
    domainSignals: [],
    expectedModules: [],
    missingModules: [],
    userSelections: [],
    moduleSelectionById: emptyModuleRecord(),
    confirmed: false,
    needsClarification: false,
    analysisSnapshot: null,
    clarificationSeedModuleIds: [],
    affirmedModuleIds,
  };
  return pushHistory(next, { action: "backToInput", from: "postAnalysis" });
}

/**
 * @param {WorkflowBuildState} state
 * @returns {WorkflowBuildState}
 */
export function transitionBackToClarify(state) {
  const mod = emptyModuleRecord();
  for (const id of state.clarificationSeedModuleIds) {
    if (MODULE_SELECTION_ORDER.includes(id)) mod[id] = true;
  }
  let next = {
    ...state,
    step: "clarify",
    confirmed: false,
    moduleSelectionById: mod,
    userSelections: [],
  };
  return pushHistory(next, { action: "backToClarify", from: "select", to: "clarify" });
}

/**
 * @param {WorkflowBuildState} state
 * @returns {WorkflowBuildState}
 */
export function transitionBackToSelect(state) {
  let next = { ...state, step: "select", confirmed: false };
  return pushHistory(next, { action: "backToSelect", from: "confirm", to: "select" });
}

/**
 * Successful pack creation: new session (history cleared).
 * @returns {WorkflowBuildState}
 */
export function transitionCompleteReset() {
  return createInitialWorkflowBuildState();
}

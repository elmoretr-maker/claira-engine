/**
 * Preview analysis for guided module selection — no generic fallbacks, no silent preset degradation.
 * Progressive clarification: gap = expected − (detected ∪ guided-affirmed); UI asks only unresolved modules.
 */

import { REGISTERED_WORKFLOW_MODULE_IDS } from "../modules/moduleRegistry.js";
import { MODULE_SELECTION_ORDER, CLARIFICATION_INTRO, CLARIFICATION_OPTIONS } from "../contracts/workflowRules.js";
import { getKeywordDetectedModules } from "./detectModulesFromNormalizedText.js";
import { DOMAIN_MODULE_HINTS } from "./domainModuleSuggestions.js";
import { getRequiredModulesForDomain } from "./domainExpectedCoverage.js";
import { isVagueAmbiguousIntent } from "./vagueIntentDetection.js";
import { MODULE_PUBLIC_COPY } from "./modulePublicCopy.js";
import { loadWorkflowPresets, matchWorkflowPreset } from "../presets/loadWorkflowPresets.js";
import { moduleIdsFromGuidedSignals } from "./guidedModuleSignals.js";

/**
 * @typedef {{
 *   moduleId: string,
 *   reason: string,
 *   domainId: string,
 * }} SuggestedModuleRow
 */

/** @typedef {"no_signal" | "missing_expected_modules" | "ambiguous_input"} ClarificationReason */

/**
 * @param {string[]} knownModuleIds
 * @returns {string | null}
 */
function buildClarificationContinuationSummary(knownModuleIds) {
  const known = new Set(knownModuleIds);
  const parts = [];
  if (known.has("entity_tracking")) parts.push("tracking people or identities (clients, members, patients, etc.)");
  if (known.has("event_log")) parts.push("tracking activity over time (progress, sessions, history)");
  if (known.has("asset_registry")) parts.push("storing files, images, or documents");
  if (parts.length === 0) return null;
  if (parts.length === 1) return `You’ve already indicated you’re ${parts[0]}—from your wording or guided answers.`;
  return `You’ve already indicated you’re ${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}—from your wording or guided answers.`;
}

/**
 * @param {string} industryName
 * @param {string} [buildIntent]
 * @param {{ guidedModuleSignals?: { trackPeople?: boolean, trackActivity?: boolean, trackFiles?: boolean } }} [options]
 * @returns {object}
 */
export function analyzeModuleCompositionForBuild(industryName, buildIntent = "", options = {}) {
  const name = String(industryName ?? "").trim();
  if (!name) {
    return { ok: false, error: "Industry name is required." };
  }

  const normalizedText = `${name} ${String(buildIntent ?? "").trim()}`.trim().toLowerCase();

  const detectedModules = getKeywordDetectedModules(normalizedText);
  const affirmedModuleIds = moduleIdsFromGuidedSignals(options.guidedModuleSignals);
  const knownModuleIds = MODULE_SELECTION_ORDER.filter(
    (id) => detectedModules.includes(id) || affirmedModuleIds.includes(id),
  );
  const known = new Set(knownModuleIds);

  /** @type {SuggestedModuleRow[]} */
  const suggestedModules = [];
  const suggestedIds = new Set();

  const addSuggestion = (moduleId, reason, domainId) => {
    if (!REGISTERED_WORKFLOW_MODULE_IDS.includes(moduleId)) return;
    if (detectedModules.includes(moduleId)) return;
    if (suggestedIds.has(moduleId)) return;
    suggestedIds.add(moduleId);
    suggestedModules.push({ moduleId, reason, domainId });
  };

  /** @type {{ id: string, text: string } | null} */
  let domainIntro = null;

  /** @type {string[]} */
  const matchedDomainIds = [];
  for (const domain of DOMAIN_MODULE_HINTS) {
    const matchedDomain = domain.keywords.some((kw) => normalizedText.includes(kw));
    if (!matchedDomain) continue;
    matchedDomainIds.push(domain.id);
    if (!domainIntro) {
      domainIntro = { id: domain.id, text: domain.intro };
    }
    for (const s of domain.suggestions) {
      addSuggestion(s.moduleId, s.reason, domain.id);
    }
  }

  let presets;
  try {
    presets = loadWorkflowPresets();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `System configuration error: invalid workflow preset or preset load failed — ${msg}`,
    };
  }

  const matchedPreset = matchWorkflowPreset(normalizedText, presets);
  if (matchedPreset) {
    for (const mid of matchedPreset.modules) {
      addSuggestion(mid, `Often used together in the “${matchedPreset.presetId}” layout`, "preset");
    }
  }

  const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;
  const minimalInput = wordCount <= 2;

  const ambiguousMultiDomain = matchedDomainIds.length >= 2;

  /** @type {string[]} */
  let missingExpectedModules = [];
  /** @type {string | null} */
  let primaryDomainForPartial = null;

  let partialVersusDomain = false;
  if (!ambiguousMultiDomain && matchedDomainIds.length === 1) {
    const domainId = matchedDomainIds[0];
    const expected = getRequiredModulesForDomain(domainId);
    if (expected.length > 0) {
      missingExpectedModules = expected.filter((m) => !known.has(m));
      partialVersusDomain = missingExpectedModules.length > 0;
      primaryDomainForPartial = domainId;
    }
  }

  let partialVersusPreset = false;
  if (
    !ambiguousMultiDomain &&
    matchedPreset &&
    Array.isArray(matchedPreset.modules) &&
    matchedPreset.modules.length > 0
  ) {
    const missingPreset = matchedPreset.modules.filter((m) => !known.has(m));
    if (missingPreset.length > 0) {
      partialVersusPreset = true;
      if (missingExpectedModules.length === 0) {
        missingExpectedModules = [...missingPreset];
      } else {
        const set = new Set([...missingExpectedModules, ...missingPreset]);
        missingExpectedModules = REGISTERED_WORKFLOW_MODULE_IDS.filter((id) => set.has(id));
      }
    }
  }

  let partialCoverage = partialVersusDomain || partialVersusPreset;

  const hasPresetOrDomainSignal =
    matchedDomainIds.length > 0 || matchedPreset != null;
  const noSignal = knownModuleIds.length === 0 && !hasPresetOrDomainSignal;

  const ambiguousMinimal =
    !ambiguousMultiDomain && minimalInput && hasPresetOrDomainSignal && knownModuleIds.length === 0;

  const vagueAmbiguousIntent = isVagueAmbiguousIntent(
    normalizedText,
    knownModuleIds,
    matchedDomainIds,
  );

  const ambiguousInput = ambiguousMultiDomain || ambiguousMinimal || vagueAmbiguousIntent;

  if (ambiguousMultiDomain) {
    const u = new Set();
    for (const did of matchedDomainIds) {
      for (const m of getRequiredModulesForDomain(did)) {
        if (!known.has(m)) u.add(m);
      }
    }
    missingExpectedModules = REGISTERED_WORKFLOW_MODULE_IDS.filter((id) => u.has(id));
  }

  /** @type {ClarificationReason | null} */
  let clarificationReason = null;
  if (ambiguousInput) {
    clarificationReason = "ambiguous_input";
  } else if (partialCoverage) {
    clarificationReason = "missing_expected_modules";
  } else if (noSignal) {
    clarificationReason = "no_signal";
  }

  let needsClarification = clarificationReason != null;

  /** What the clarification step should list (never re-ask known modules). */
  let modulesToResolve = [];
  if (needsClarification && clarificationReason != null) {
    if (clarificationReason === "missing_expected_modules") {
      modulesToResolve = [...missingExpectedModules];
    } else {
      modulesToResolve = MODULE_SELECTION_ORDER.filter((id) => !known.has(id));
    }
  }

  if (needsClarification && modulesToResolve.length === 0) {
    needsClarification = false;
    clarificationReason = null;
  }

  const clarificationOptionsProgressive = CLARIFICATION_OPTIONS.filter((row) =>
    modulesToResolve.includes(row.moduleId),
  );

  /** @type {Record<string, unknown> | null} */
  let clarificationDetail = null;
  if (needsClarification && clarificationReason != null) {
    clarificationDetail = {
      reason: clarificationReason,
      missingModules: [...missingExpectedModules],
      modulesToResolve: [...modulesToResolve],
      matchedDomainIds: [...matchedDomainIds],
      matchedPresetId: matchedPreset ? matchedPreset.presetId : null,
      primaryDomainId: primaryDomainForPartial,
      minimalInput,
      vagueIntent: vagueAmbiguousIntent,
      continuationSummary: buildClarificationContinuationSummary(knownModuleIds),
    };
  }

  const clarificationState = {
    detectedModules: [...detectedModules],
    affirmedModuleIds: [...affirmedModuleIds],
    knownModuleIds: [...knownModuleIds],
    domainSignals: { matchedDomainIds: [...matchedDomainIds] },
    expectedGapModuleIds: [...missingExpectedModules],
    modulesToResolve: [...modulesToResolve],
  };

  return {
    ok: true,
    needsClarification,
    clarificationReason,
    clarificationIntro: CLARIFICATION_INTRO,
    clarificationOptions: CLARIFICATION_OPTIONS,
    clarificationOptionsProgressive,
    clarificationDetail,
    clarificationState,
    detectedModules,
    suggestedModules,
    domainIntro,
    modulesMeta: MODULE_PUBLIC_COPY,
  };
}

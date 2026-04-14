/**
 * Browser persistence for app mode, oversight, industry UX, setup progress.
 */

import { fingerprintSelectedCaps } from "./tunnelSteps.js";

export const STORAGE_APP_MODE = "claira.appMode";
export const STORAGE_OVERSIGHT = "claira.oversightLevel";
export const STORAGE_INDUSTRY = "claira.selectedIndustry";
/** Set only after the final industry confirmation step (select-only); not when a pack is merely loaded mid-flow. */
export const STORAGE_INDUSTRY_GATE_COMPLETE = "claira.industryGateComplete";
const STORAGE_INDUSTRY_GATE_BOOTSTRAP = "claira.industryGateBootstrapV1";

/**
 * One-time migration: before the gate flag existed, persisting an industry implied the gate was done.
 * Runs once per browser profile, then only {@link STORAGE_INDUSTRY_GATE_COMPLETE} is authoritative.
 */
function bootstrapIndustryGatePersistence() {
  try {
    if (localStorage.getItem(STORAGE_INDUSTRY_GATE_BOOTSTRAP) === "1") return;
    if (localStorage.getItem(STORAGE_INDUSTRY) && !localStorage.getItem(STORAGE_INDUSTRY_GATE_COMPLETE)) {
      localStorage.setItem(STORAGE_INDUSTRY_GATE_COMPLETE, "1");
    }
    localStorage.setItem(STORAGE_INDUSTRY_GATE_BOOTSTRAP, "1");
  } catch {
    /* private mode */
  }
}

/**
 * @returns {boolean}
 */
export function getIndustryGateComplete() {
  bootstrapIndustryGatePersistence();
  try {
    return localStorage.getItem(STORAGE_INDUSTRY_GATE_COMPLETE) === "1";
  } catch {
    return false;
  }
}

/**
 * @param {boolean} done
 */
export function setIndustryGateComplete(done) {
  try {
    if (done) localStorage.setItem(STORAGE_INDUSTRY_GATE_COMPLETE, "1");
    else localStorage.removeItem(STORAGE_INDUSTRY_GATE_COMPLETE);
  } catch {
    /* private mode */
  }
}
export const STORAGE_SETUP_CONFLICTS = "claira.setupConflictsResolved";
export const STORAGE_CAPABILITIES = "claira.capabilitiesSelected";
export const STORAGE_TUNNEL_STEP = "claira.tunnelStepIndex";
export const STORAGE_TUNNEL_SKIPPED = "claira.tunnelSkipped";
export const STORAGE_TUNNEL_EXAMPLES = "claira.tunnelExamplesCount";
export const STORAGE_TUNNEL_MANIFEST = "claira.tunnelManifest";
export const STORAGE_TUNNEL_GRANULAR = "claira.tunnelGranular";

/** Setup wizard: user completed “structure / intake” questions (UI-only; not used by engine). */
export const STORAGE_STRUCTURE_SETUP = "claira.structureSetupComplete";

/** UI-only answers for intake structure prompts (JSON). */
export const STORAGE_INTAKE_STRUCTURE = "claira.intakeStructure";

/** Minimum user conflict resolutions before auto transition setup → runtime */
export const MIN_SETUP_CONFLICTS_RESOLVED = 3;

/** Guided tunnel: successfully processed files per category */
export const MIN_TUNNEL_EXAMPLES = 3;

/** @typedef {"setup" | "runtime"} AppMode */
/** @typedef {"light" | "medium" | "strict"} OversightLevel */

/**
 * @returns {AppMode}
 */
export function getAppMode() {
  try {
    return localStorage.getItem(STORAGE_APP_MODE) === "runtime" ? "runtime" : "setup";
  } catch {
    return "setup";
  }
}

/**
 * @param {AppMode} mode
 */
export function setAppMode(mode) {
  try {
    localStorage.setItem(STORAGE_APP_MODE, mode);
  } catch {
    /* private mode */
  }
}

/**
 * @returns {OversightLevel}
 */
export function getOversightLevel() {
  try {
    const v = localStorage.getItem(STORAGE_OVERSIGHT);
    if (v === "light" || v === "strict") return v;
    return "medium";
  } catch {
    return "medium";
  }
}

/**
 * @param {OversightLevel} level
 */
export function setOversightLevel(level) {
  try {
    localStorage.setItem(STORAGE_OVERSIGHT, level);
  } catch {
    /* ignore */
  }
}

/**
 * @returns {number}
 */
export function getSetupConflictsResolved() {
  try {
    const n = Number(localStorage.getItem(STORAGE_SETUP_CONFLICTS));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/**
 * Increment after user resolves a classification conflict (learning).
 */
export function bumpSetupConflictsResolved() {
  const n = getSetupConflictsResolved() + 1;
  try {
    localStorage.setItem(STORAGE_SETUP_CONFLICTS, String(n));
  } catch {
    /* ignore */
  }
  return n;
}

/**
 * After a processing session completes, maybe move setup → runtime.
 * @param {{ processed: number }} summary
 */
export function maybeCompleteSetupAfterSession(summary) {
  if (getAppMode() !== "setup") return;
  const processed = typeof summary?.processed === "number" ? summary.processed : 0;
  if (processed <= 0) return;
  if (getSetupConflictsResolved() < MIN_SETUP_CONFLICTS_RESOLVED) return;
  setAppMode("runtime");
}

/**
 * Clear guided tunnel selections and progress (e.g. after switching industry pack).
 */
export function clearTunnelExampleCounts() {
  try {
    localStorage.removeItem(STORAGE_TUNNEL_EXAMPLES);
  } catch {
    /* ignore */
  }
}

export function clearTunnelState() {
  try {
    localStorage.removeItem(STORAGE_CAPABILITIES);
    localStorage.removeItem(STORAGE_TUNNEL_STEP);
    localStorage.removeItem(STORAGE_TUNNEL_SKIPPED);
    localStorage.removeItem(STORAGE_TUNNEL_EXAMPLES);
    localStorage.removeItem(STORAGE_TUNNEL_MANIFEST);
    localStorage.removeItem(STORAGE_TUNNEL_GRANULAR);
    localStorage.removeItem(STORAGE_STRUCTURE_SETUP);
    localStorage.removeItem(STORAGE_INTAKE_STRUCTURE);
  } catch {
    /* ignore */
  }
}

/**
 * Full onboarding reset (UI persistence only): tunnel/caps, structure intake, industry selection,
 * setup conflict counter, oversight, app mode — does not touch industry feature toggles or external systems.
 */
export function clearAllOnboardingLocalStorage() {
  clearTunnelState();
  try {
    localStorage.removeItem(STORAGE_SETUP_CONFLICTS);
    localStorage.removeItem(STORAGE_INDUSTRY);
    localStorage.removeItem(STORAGE_INDUSTRY_GATE_COMPLETE);
    localStorage.removeItem(STORAGE_OVERSIGHT);
    localStorage.removeItem(STORAGE_APP_MODE);
  } catch {
    /* ignore */
  }
  setAppMode("setup");
}

/**
 * @returns {boolean}
 */
export function getStructureSetupComplete() {
  try {
    return localStorage.getItem(STORAGE_STRUCTURE_SETUP) === "1";
  } catch {
    return false;
  }
}

/**
 * @param {boolean} done
 */
export function setStructureSetupComplete(done) {
  try {
    if (done) localStorage.setItem(STORAGE_STRUCTURE_SETUP, "1");
    else localStorage.removeItem(STORAGE_STRUCTURE_SETUP);
  } catch {
    /* ignore */
  }
}

/**
 * @returns {{ multipleSizes: boolean | null, usesSkus: boolean | null, hasVariations: boolean | null } | null}
 */
export function getIntakeStructureAnswers() {
  try {
    const raw = localStorage.getItem(STORAGE_INTAKE_STRUCTURE);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    return {
      multipleSizes: p.multipleSizes === true ? true : p.multipleSizes === false ? false : null,
      usesSkus: p.usesSkus === true ? true : p.usesSkus === false ? false : null,
      hasVariations: p.hasVariations === true ? true : p.hasVariations === false ? false : null,
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ multipleSizes: boolean | null, usesSkus: boolean | null, hasVariations: boolean | null }} answers
 */
export function setIntakeStructureAnswers(answers) {
  try {
    localStorage.setItem(STORAGE_INTAKE_STRUCTURE, JSON.stringify(answers));
  } catch {
    /* ignore */
  }
}

/**
 * @returns {boolean}
 */
export function getTunnelGranular() {
  try {
    return localStorage.getItem(STORAGE_TUNNEL_GRANULAR) === "1";
  } catch {
    return false;
  }
}

/**
 * @param {boolean} value
 */
export function setTunnelGranular(value) {
  try {
    localStorage.setItem(STORAGE_TUNNEL_GRANULAR, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * @param {string[]} selectedCaps
 * @param {unknown[]} steps
 * @param {boolean} granular
 */
export function setTunnelManifest(selectedCaps, steps, granular) {
  try {
    const payload = {
      version: 1,
      fingerprint: fingerprintSelectedCaps(selectedCaps),
      granular: !!granular,
      steps,
    };
    localStorage.setItem(STORAGE_TUNNEL_MANIFEST, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/**
 * @returns {{ fingerprint?: string, granular?: boolean, steps?: unknown[] } | null}
 */
export function getTunnelManifestRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_TUNNEL_MANIFEST);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * @param {string[]} [selectedCaps]
 * @returns {number}
 */
export function getResolvedTunnelStepCount(selectedCaps) {
  const sel = selectedCaps ?? getSelectedCapabilities();
  const m = getTunnelManifestRaw();
  if (m && m.fingerprint === fingerprintSelectedCaps(sel) && Array.isArray(m.steps)) {
    return m.steps.length;
  }
  return sel.length;
}

/**
 * @returns {string[]}
 */
export function getSelectedCapabilities() {
  try {
    const raw = localStorage.getItem(STORAGE_CAPABILITIES);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.filter((x) => typeof x === "string" && x.trim()) : [];
  } catch {
    return [];
  }
}

/**
 * @param {string[]} categories
 */
export function setSelectedCapabilities(categories) {
  const list = Array.isArray(categories)
    ? [...new Set(categories.map((c) => String(c).trim()).filter(Boolean))]
    : [];
  try {
    localStorage.setItem(STORAGE_CAPABILITIES, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/**
 * @returns {number}
 */
export function getTunnelStepIndex() {
  try {
    const n = Number(localStorage.getItem(STORAGE_TUNNEL_STEP));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/**
 * @param {number} idx
 */
export function setTunnelStepIndex(idx) {
  const n = Number.isFinite(idx) && idx >= 0 ? Math.floor(idx) : 0;
  try {
    localStorage.setItem(STORAGE_TUNNEL_STEP, String(n));
  } catch {
    /* ignore */
  }
}

/**
 * @returns {Record<string, boolean>}
 */
export function getTunnelSkippedMap() {
  try {
    const raw = localStorage.getItem(STORAGE_TUNNEL_SKIPPED);
    if (!raw) return {};
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    /** @type {Record<string, boolean>} */
    const out = {};
    for (const [k, v] of Object.entries(p)) {
      if (v === true) out[k] = true;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, boolean>} map
 */
export function setTunnelSkippedMap(map) {
  try {
    localStorage.setItem(STORAGE_TUNNEL_SKIPPED, JSON.stringify(map && typeof map === "object" ? map : {}));
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} category
 */
export function markTunnelCategorySkipped(category) {
  const key = String(category ?? "").trim();
  if (!key) return;
  const m = getTunnelSkippedMap();
  m[key] = true;
  setTunnelSkippedMap(m);
}

/**
 * @returns {Record<string, number>}
 */
export function getTunnelExampleCounts() {
  try {
    const raw = localStorage.getItem(STORAGE_TUNNEL_EXAMPLES);
    if (!raw) return {};
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    /** @type {Record<string, number>} */
    const out = {};
    for (const [k, v] of Object.entries(p)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * @param {string} category
 * @param {number} delta
 */
export function addTunnelExampleCount(category, delta) {
  const key = String(category ?? "").trim();
  if (!key) return;
  const d = typeof delta === "number" && Number.isFinite(delta) ? Math.max(0, Math.floor(delta)) : 0;
  if (d === 0) return;
  const cur = getTunnelExampleCounts();
  const next = (cur[key] ?? 0) + d;
  cur[key] = next;
  try {
    localStorage.setItem(STORAGE_TUNNEL_EXAMPLES, JSON.stringify(cur));
  } catch {
    /* ignore */
  }
}

/**
 * User chose no capabilities — exit setup without conflict requirement.
 * @returns {boolean} true if mode was updated
 */
export function maybeCompleteSetupWithZeroCapabilities() {
  if (getAppMode() !== "setup") return false;
  setAppMode("runtime");
  return true;
}

/**
 * Every selected tunnel category was skipped — exit setup without conflict requirement.
 * @param {string[]} selected
 * @param {Record<string, boolean>} [skippedMap]
 * @returns {boolean} true if mode was updated
 */
export function maybeCompleteSetupAfterAllTunnelCategoriesSkipped(selected, skippedMap) {
  if (getAppMode() !== "setup") return false;
  if (!Array.isArray(selected) || selected.length === 0) return false;
  const sm = skippedMap && typeof skippedMap === "object" ? skippedMap : getTunnelSkippedMap();
  const allSkipped = selected.every((c) => sm[String(c)] === true);
  if (!allSkipped) return false;
  setAppMode("runtime");
  return true;
}

/**
 * @param {Array<{ skipKey: string }>} steps
 * @param {Record<string, boolean>} [skippedMap]
 * @returns {boolean}
 */
export function maybeCompleteSetupAfterAllTunnelStepsSkipped(steps, skippedMap) {
  if (getAppMode() !== "setup") return false;
  if (!Array.isArray(steps) || steps.length === 0) return false;
  const sm = skippedMap && typeof skippedMap === "object" ? skippedMap : getTunnelSkippedMap();
  const allSkipped = steps.every((s) => sm[String(s?.skipKey ?? "")] === true);
  if (!allSkipped) return false;
  setAppMode("runtime");
  return true;
}

/** Industry-specific optional features (local only; never shared). */
export const STORAGE_INDUSTRY_FEATURES = "claira.industryFeaturePrefs";

/**
 * @returns {Record<string, Record<string, "enabled" | "dismissed">>}
 */
function readIndustryFeaturePrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_INDUSTRY_FEATURES);
    if (!raw) return {};
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    return /** @type {Record<string, Record<string, "enabled" | "dismissed">>} */ (p);
  } catch {
    return {};
  }
}

/**
 * @param {string} industry
 * @param {string} featureKey
 * @returns {"enabled" | "dismissed" | null}
 */
export function getIndustryFeatureState(industry, featureKey) {
  const ind = String(industry ?? "").trim().toLowerCase();
  const key = String(featureKey ?? "").trim();
  if (!ind || !key) return null;
  const v = readIndustryFeaturePrefs()[ind]?.[key];
  return v === "enabled" || v === "dismissed" ? v : null;
}

/**
 * @param {string} industry
 * @param {string} featureKey
 * @param {"enabled" | "dismissed"} state
 */
export function setIndustryFeatureState(industry, featureKey, state) {
  const ind = String(industry ?? "").trim().toLowerCase();
  const key = String(featureKey ?? "").trim();
  if (!ind || !key) return;
  const prefs = readIndustryFeaturePrefs();
  if (!prefs[ind]) prefs[ind] = {};
  prefs[ind][key] = state;
  try {
    localStorage.setItem(STORAGE_INDUSTRY_FEATURES, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} industry
 * @param {string} featureKey
 */
export function isIndustryFeatureEnabled(industry, featureKey) {
  return getIndustryFeatureState(industry, featureKey) === "enabled";
}

/**
 * Progress / measurement tracking UI when any matching feature is enabled.
 * @param {string} industry
 */
export function isProgressTrackingUiEnabled(industry) {
  const ind = String(industry ?? "").trim().toLowerCase();
  if (!ind) return false;
  const row = readIndustryFeaturePrefs()[ind] || {};
  return Object.entries(row).some(
    ([k, v]) =>
      v === "enabled" &&
      (k.includes("progress") || k.includes("measurement") || k.includes("patient") || k.includes("project")),
  );
}

/**
 * Generic fallback when pack reference has no `pack.inputVerb`.
 * @param {string | null | undefined} _industry
 * @returns {string}
 */
export function inputButtonLabelForIndustry(_industry) {
  return "Add files";
}

/**
 * Unified programmatic API for Claira Engine (no console output).
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, extname, join, resolve, sep } from "path";
import { getAdapter, normalizeInput } from "../adapters/index.js";
import { sendOutput } from "../outputs/index.js";
import { generateSessionReport } from "./sessionLedger.js";
import { generateSuggestions } from "./suggestionEngine.js";
import { assignPriority } from "./reviewQueue.js";
import { captureUserDecision } from "./decisionCapture.js";
import { loadRooms } from "../rooms/index.js";
import { applyDecision as engineApplyDecision, getRiskInsights as engineGetRiskInsights } from "../index.js";
import { loadIndustryPack as applyIndustryPack } from "../packs/loadIndustryPack.js";
import { listIndustryPacks } from "../packs/listIndustryPacks.js";
import { checkInternetConnection } from "../packs/industryAutogen/internetCheck.js";
import { autoImproveIndustryPack } from "../packs/industryAutogen/autoImproveIndustryPack.js";
import { buildIndustryReport } from "../packs/industryAutogen/coverageEvaluator.js";
import { confirmIndustryPackActivation } from "../packs/industryAutogen/confirmIndustryPackActivation.js";
import { createIndustryFromInput } from "../packs/industryAutogen/createIndustryFromInput.js";
import { analyzeModuleCompositionForBuild } from "../workflow/moduleMapping/analyzeModuleCompositionForBuild.js";
import { readStructureCategories } from "./referenceLoader.js";
import {
  ensureCapabilityOutputFolders,
  humanizeCategoryKey,
  readActivePackIndustry,
  readPackReference,
  readPackWorkflowSource,
} from "./packReference.js";
import { getActiveReferenceAssets, getProcesses, getReferenceAssets } from "./referenceAssets.js";
import { persistReferenceLearning } from "../learning/addUserReference.js";
import {
  cleanupTunnelStagingCategoryDir,
  ensureTunnelStagingRoot,
  getTunnelStagingRoot,
  tunnelStagingFolderRel,
} from "./tunnelStaging.js";
import { runProcessFolderPipeline, runProcessItemsPipeline } from "./processFolderPipeline.js";
import { dispatchPostPipeline } from "../workflow/moduleHost/moduleHost.js";
import { assertWorkflowTemplateContract } from "../workflow/validation/workflowTemplateContract.js";
import { readWorkflowTemplateFromActivePack } from "../workflow/trainer/readWorkflowTemplate.js";
import { TRAINER_ROOT } from "../workflow/trainer/paths.js";
import { createTrainerClient, getTrainerClient, listTrainerClients } from "../workflow/trainer/clientStore.js";
import { listTrainerAssets } from "../workflow/trainer/assetStore.js";
import { listTrainerEvents } from "../workflow/trainer/eventStore.js";
import {
  loadUserControlRules,
  readBypassReviewLog,
  removeUserControlRule,
  setUserControlRule,
} from "../policies/userControl.js";
export {
  addTrackingSnapshotApi,
  categorySupportsProgressTracking,
  categoryTrackingSupportApi,
  createTrackingEntityApi,
  getIndustryFeaturesApi,
  getTrackingConfigApi,
  getTrackingProgressApi,
  listTrackingEntitiesApi,
  listTrackingSnapshotsApi,
  resolveTrackingConsistencyConfig,
} from "./trackingApi.js";
export {
  workspaceGeneratorSnapshotApi,
  workspaceScanApi,
  workspaceSimulationIngestApi,
  workspaceSyncApi,
} from "./workspaceApi.js";
export { assertFreshGeneratorReadModel, loadGeneratorReadModel } from "../workspace/generatorConsumption.js";

/**
 * @param {unknown} raw
 */
function sanitizeTunnelCategory(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(s)) return "";
  return s;
}

/**
 * @param {unknown} name
 */
function safeTunnelLeaf(name) {
  const b = basename(String(name ?? "file"));
  if (!b || b === "." || b === ".." || b.includes("..")) return `file_${Date.now()}.bin`;
  const cleaned = b.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  return cleaned || `file_${Date.now()}.bin`;
}

/**
 * Stage tunnel uploads under temp/tunnel_staging/<category>/.
 * Reference tag: copy into references/user via persistReferenceLearning and clear staging.
 * Live: return relative folderPath for processFolder.
 *
 * @param {string} category
 * @param {{ name: string, base64: string }[]} files
 * @param {{ uploadTag?: { type?: string, category?: string } }} [options]
 * @returns {{ ok: true, uploadKind: "reference", added: number, category: string } | { ok: true, uploadKind: "live", folderPath: string }}
 */
export function tunnelUploadStaged(category, files, options = {}) {
  const cat = sanitizeTunnelCategory(category);
  if (!cat) throw new Error("tunnelUploadStaged: invalid category");
  if (!Array.isArray(files) || files.length === 0) throw new Error("tunnelUploadStaged: no files");
  if (files.length > 40) throw new Error("tunnelUploadStaged: too many files");
  ensureTunnelStagingRoot();
  const destRoot = join(getTunnelStagingRoot(), cat);
  mkdirSync(destRoot, { recursive: true });
  for (const f of files) {
    const leaf = safeTunnelLeaf(f?.name);
    const b64 = typeof f?.base64 === "string" ? f.base64 : "";
    const buf = Buffer.from(b64, "base64");
    if (buf.length > 25 * 1024 * 1024) throw new Error("tunnelUploadStaged: file too large");
    writeFileSync(join(destRoot, leaf), buf);
  }

  const uploadTag = options.uploadTag;
  const isReference =
    uploadTag &&
    typeof uploadTag === "object" &&
    uploadTag.type === "reference" &&
    sanitizeTunnelCategory(uploadTag.category) === cat;

  if (isReference) {
    let added = 0;
    /** @type {Array<{ filePath: string, reason: string, detail?: string }>} */
    const referenceLearningFailures = [];
    for (const name of readdirSync(destRoot)) {
      const full = join(destRoot, name);
      try {
        if (!statSync(full).isFile()) continue;
        const r = persistReferenceLearning(full, cat);
        if (r.ok && !r.skipped) added += 1;
        else if (!r.ok) {
          console.error(`[learning] tunnel reference persistReferenceLearning failed: ${r.reason} (${full})`);
          /** @type {{ filePath: string, reason: string, detail?: string }} */
          const fail = { filePath: full, reason: r.reason };
          if ("detail" in r && typeof r.detail === "string") fail.detail = r.detail;
          referenceLearningFailures.push(fail);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[learning] tunnel reference error: ${msg} (${full})`);
        referenceLearningFailures.push({ filePath: full, reason: "io_error", detail: msg });
      }
    }
    cleanupTunnelStagingCategoryDir(destRoot);
    const ok = referenceLearningFailures.length === 0;
    return {
      ok,
      uploadKind: "reference",
      added,
      category: cat,
      ...(referenceLearningFailures.length ? { referenceLearningFailures } : {}),
    };
  }

  return { ok: true, uploadKind: "live", folderPath: tunnelStagingFolderRel(cat) };
}

/**
 * @param {string} inputPath — folder path (relative to cwd or absolute)
 * @param {{ cwd?: string, workflowContext?: { entityId?: string, clientId?: string }, runtimeContext?: {
 *   appMode?: string,
 *   oversightLevel?: string,
 *   expectedCategory?: string,
 *   autoMove?: boolean,
 *   strictValidation?: boolean,
 *   reviewThreshold?: number,
 * } }} [options]
 * @returns {Promise<{
 *   processed: number,
 *   moved: number,
 *   review: number,
 *   results: unknown[],
 *   reviewPriorityCounts: { high: number, medium: number, low: number },
 *   workflowModuleErrors?: string[],
 * }>}
 */
export async function processFolder(inputPath, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const abs = resolve(cwd, inputPath);
  const out = await runProcessFolderPipeline(abs, {
    cwd,
    runtimeContext: options.runtimeContext,
  });
  const wf = options.workflowContext && typeof options.workflowContext === "object" ? options.workflowContext : {};
  const entityId = String(wf.entityId ?? wf.clientId ?? "").trim();
  const { moduleErrors } = dispatchPostPipeline(out, {
    entityId,
    cwd,
    templateId: typeof wf.templateId === "string" ? wf.templateId : undefined,
  });
  return {
    processed: out.processed,
    moved: out.moved,
    review: out.review,
    results: out.results,
    reviewPriorityCounts: out.reviewPriorityCounts,
    ...(moduleErrors.length ? { workflowModuleErrors: moduleErrors } : {}),
  };
}

/**
 * @returns {{ rooms: Array<{ name: string, destination: string, config: object }> }}
 */
/**
 * @param {string} industry — pack folder under packs/<industry>/
 * @returns {Promise<{ ok: true, industry: string }>}
 */
export async function loadIndustryPack(industry) {
  await applyIndustryPack(industry);
  return { ok: true, industry: String(industry ?? "").trim() };
}

/**
 * Category keys from config/structure.json (current pack).
 * @param {{ cwd?: string }} [_options]
 * @returns {{ categories: string[] }}
 */
export function getStructureCategories(_options = {}) {
  const cats = readStructureCategories();
  const keys = Object.keys(cats).map((k) => String(k).trim()).filter(Boolean);
  keys.sort((a, b) => a.localeCompare(b));
  return { categories: keys };
}

/**
 * UX/onboarding schema merged with config/structure.json (classification keys).
 * Categories are driven by structure; labels/descriptions/examples come from pack_reference when present.
 * @param {{ cwd?: string }} [_options]
 * @returns {{
 *   ok: boolean,
 *   version: number,
 *   categories: Record<string, unknown>,
 *   keys: string[],
 *   groups: Record<string, { label: string, description: string, categories: string[] }>,
 *   groupOrder: string[],
 *   pack: { label?: string, inputVerb?: string, intents?: Array<{ value: string, label: string }> },
 * }}
 */
export function getPackReference(_options = {}) {
  const struct = readStructureCategories();
  const structKeys = Object.keys(struct)
    .map((k) => String(k).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const validKeySet = new Set(structKeys);
  const p = readPackReference();
  const refCats = p?.categories && typeof p.categories === "object" ? p.categories : {};

  /** @type {Record<string, unknown>} */
  const categories = {};
  for (const k of structKeys) {
    const v = refCats[k];
    const keywords = Array.isArray(struct[k]) ? struct[k].filter((x) => typeof x === "string").map((x) => x.trim()) : [];
    const refEx =
      v && typeof v === "object" && !Array.isArray(v) && Array.isArray(/** @type {{ examples?: unknown }} */ (v).examples)
        ? /** @type {{ examples?: string[] }} */ (v).examples.filter((x) => typeof x === "string")
        : [];
    const examples = refEx.length > 0 ? refEx : keywords.slice(0, 16);
    const refLabel =
      v && typeof v === "object" && !Array.isArray(v) && typeof /** @type {{ label?: string }} */ (v).label === "string"
        ? /** @type {{ label?: string }} */ (v).label?.trim()
        : "";
    const refDesc =
      v && typeof v === "object" && !Array.isArray(v) && typeof /** @type {{ description?: string }} */ (v).description === "string"
        ? /** @type {{ description?: string }} */ (v).description?.trim()
        : "";
    const subs =
      v && typeof v === "object" && !Array.isArray(v) && v.subcategories && typeof v.subcategories === "object"
        ? v.subcategories
        : {};
    categories[k] = {
      label: refLabel || humanizeCategoryKey(k),
      description: refDesc || "",
      examples,
      structureKeywords: keywords,
      subcategories: subs,
    };
  }

  /** @type {Record<string, { label: string, description: string, categories: string[] }>} */
  const groups = {};
  /** @type {string[]} */
  let groupOrder = [];
  if (p?.groups && typeof p.groups === "object") {
    const preferred = Array.isArray(p.groupOrder) ? p.groupOrder : Object.keys(p.groups);
    for (const gid of preferred) {
      const g = p.groups[gid];
      if (!g || typeof g !== "object") continue;
      const ge = /** @type {{ label?: string, description?: string, categories?: string[] }} */ (g);
      const rawCats = Array.isArray(ge.categories) ? ge.categories : [];
      const cats = [...new Set(rawCats.map((c) => String(c).trim()).filter((c) => c && validKeySet.has(c)))];
      if (cats.length === 0) continue;
      groups[gid] = {
        label: typeof ge.label === "string" && ge.label.trim() ? ge.label.trim() : gid,
        description: typeof ge.description === "string" ? ge.description.trim() : "",
        categories: cats,
      };
      groupOrder.push(gid);
    }
  }

  /** @type {{ label?: string, inputVerb?: string, intents?: Array<{ value: string, label: string }> }} */
  const pack = p?.pack && typeof p.pack === "object" ? { ...p.pack } : {};

  return {
    ok: true,
    version: p?.version ?? 1,
    categories,
    keys: structKeys,
    groups,
    groupOrder,
    pack,
  };
}

/**
 * Packs under packs/ with structure.json (for industry picker UI).
 * @returns {{ ok: true, packs: Array<{ slug: string, label: string, inputVerb?: string }> }}
 */
export function listIndustryPacksApi() {
  return { ok: true, packs: listIndustryPacks() };
}

/**
 * Connectivity for autonomous industry builder (uses config/allowedSources.json ping URLs only).
 * @returns {Promise<{ connected: boolean, detail: string, checked: Array<{ url: string, ok: boolean }> }>}
 */
export async function checkInternetConnectionApi() {
  return checkInternetConnection();
}

/**
 * Deterministic module preview for Create Your Category (no build).
 * @param {{
 *   industryName?: string,
 *   buildIntent?: string,
 *   guidedModuleSignals?: { trackPeople?: boolean, trackActivity?: boolean, trackFiles?: boolean },
 * }} [input]
 */
export function previewIndustryModuleCompositionApi(input = {}) {
  const industryName = typeof input.industryName === "string" ? input.industryName : "";
  const buildIntent = typeof input.buildIntent === "string" ? input.buildIntent : "";
  const g = input.guidedModuleSignals;
  const guidedModuleSignals =
    g != null && typeof g === "object"
      ? {
          trackPeople: g.trackPeople === true,
          trackActivity: g.trackActivity === true,
          trackFiles: g.trackFiles === true,
        }
      : undefined;
  return analyzeModuleCompositionForBuild(industryName, buildIntent, { guidedModuleSignals });
}

/**
 * Research + generate_pack_system pipeline (no classifier / learning changes).
 * @param {{ industryName?: string, buildIntent?: string, selectedModules?: string[] }} [input]
 */
export async function createIndustryFromInputApi(input = {}) {
  const industryName = typeof input.industryName === "string" ? input.industryName : "";
  const buildIntent = typeof input.buildIntent === "string" ? input.buildIntent : "";
  const selectedModules = Array.isArray(input.selectedModules)
    ? input.selectedModules.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  return createIndustryFromInput({ industryName, buildIntent, selectedModules });
}

/**
 * Load pack into config after user confirms passable/insufficient quality gate.
 * @param {{ slug?: string }} [input]
 */
export async function confirmIndustryPackActivationApi(input = {}) {
  const slug = typeof input.slug === "string" ? input.slug : "";
  return confirmIndustryPackActivation(slug);
}

/**
 * Reference coverage report for a pack under packs/<slug>/.
 * @param {{ slug?: string }} [input]
 */
export function getIndustryBuildReportApi(input = {}) {
  const slug = typeof input.slug === "string" ? input.slug.trim().toLowerCase() : "";
  if (!slug || !/^[a-z0-9_-]+$/.test(slug)) {
    return { ok: false, error: "Invalid or missing slug" };
  }
  const report = buildIndustryReport(slug);
  return { ok: true, ...report };
}

/**
 * Repair pack reference gaps (generator) and return a fresh coverage report.
 * @param {{ slug?: string }} [input]
 */
export function autoImproveIndustryPackApi(input = {}) {
  const slug = typeof input.slug === "string" ? input.slug.trim().toLowerCase() : "";
  if (!slug || !/^[a-z0-9_-]+$/.test(slug)) {
    return { ok: false, error: "Invalid or missing slug" };
  }
  return autoImproveIndustryPack(slug);
}

/**
 * Pack workflow metadata from reference_assets/processes.json (UI / decision support only).
 * @param {{ industry?: string | null, cwd?: string }} [options] — industry defaults to active pack
 * @returns {{ ok: true, industry: string, processes: Record<string, unknown> }}
 */
export function getPackProcesses(options = {}) {
  const raw = options.industry != null ? String(options.industry).trim().toLowerCase() : "";
  const slug =
    raw && /^[a-z0-9_-]+$/.test(raw) ? raw : readActivePackIndustry() || "";
  const processes = slug ? getProcesses(slug) : {};
  return { ok: true, industry: slug, processes };
}

/**
 * @param {string[]} selectedKeys
 * @param {{ cwd?: string }} [options]
 * @returns {{ ok: true }}
 */
export function ensureCapabilityOutputFoldersApi(selectedKeys, options = {}) {
  ensureCapabilityOutputFolders(selectedKeys, { cwd: options.cwd });
  return { ok: true };
}

/**
 * Read-only: list pack reference_assets (images, documents, patterns) for a category.
 * @param {string} industry — pack slug
 * @param {string} category — structure category key
 */
export function getReferenceAssetsApi(industry, category) {
  return getReferenceAssets(industry, category);
}

/**
 * Same as {@link getReferenceAssetsApi} using active pack from config when industry omitted.
 * Omits full `processes` map (only per-category process) to keep UI payloads small.
 * @param {string} category
 * @param {string} [industryOverride]
 */
export function getActiveReferenceAssetsApi(category, industryOverride) {
  const full = getActiveReferenceAssets(category, industryOverride);
  return {
    industry: full.industry,
    category: full.category,
    images: full.images,
    documents: full.documents,
    patterns: full.patterns,
    patternForCategory: full.patternForCategory,
    processForCategory: full.processForCategory,
  };
}

/**
 * @param {{
 *   decision_type?: "learning" | "express_pass" | "exemption",
 *   predicted_label?: string | null,
 *   selected_label?: string | null,
 *   selected_room?: string | null,
 *   confidence?: number,
 *   file?: string | null,
 *   filePath?: string | null,
 *   scope?: "global" | "single",
 *   extractedText?: string | null,
 *   classification?: object | null,
 *   mismatchSeverity?: "high" | "medium" | "low",
 *   mismatchFingerprint?: string | null,
 *   mismatchReason?: string | null,
 * }} [input]
 */
export async function applyDecision(input = {}) {
  return engineApplyDecision(input);
}

/**
 * In-memory risk dashboard (fingerprints, confusion pairs) for UI.
 */
export function getRiskInsights() {
  return engineGetRiskInsights();
}

export function getRooms() {
  const loaded = loadRooms();
  const rooms = Object.values(loaded).map((r) => ({
    name: String(r.config?.name ?? ""),
    destination: String(r.config?.destination ?? ""),
    config: r.config,
  }));
  return { rooms };
}

function reviewReasonForItem(item) {
  if (item.room_validation != null) return "rejected_by_room";
  if (typeof item.reason === "string" && item.reason.length) return item.reason;
  const pc = item.place_card;
  if (pc && typeof pc === "object" && pc.reason != null) return String(pc.reason);
  return "review";
}

function isReviewQueueItem(item) {
  if (item == null || typeof item !== "object") return false;
  const pcEarly = item.place_card;
  if (
    pcEarly &&
    typeof pcEarly === "object" &&
    /** @type {{ user_override?: unknown }} */ (pcEarly).user_override === "bypass_review"
  ) {
    if (item.room_validation != null) return true;
    if (item.text_mismatch === true) return true;
    if (item.text_label_conflict === true) return true;
    if (item.text_routing_conflict === true) return true;
    if (item.text_insight_flag === true) return true;
    return false;
  }
  if (item.room_validation != null) return true;
  if (item.text_mismatch === true) return true;
  if (item.text_label_conflict === true) return true;
  if (item.text_routing_conflict === true) return true;
  if (item.text_insight_flag === true) return true;
  if (item.priority != null) return true;
  if (item.error === "embedding_failed") return true;
  const pc = item.place_card;
  if (!pc) return false;
  const decReason = String(pc.reason ?? "");
  if (decReason === "rejected_by_room") return true;
  return false;
}

/**
 * @param {{ cwd?: string }} [options]
 * @returns {{
 *   high: unknown[],
 *   medium: unknown[],
 *   low: unknown[]
 * }}
 */
export function getReviewQueue(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const path = join(cwd, "output", "results.json");
  if (!existsSync(path)) {
    return { high: [], medium: [], low: [] };
  }
  let rows;
  try {
    rows = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { high: [], medium: [], low: [] };
  }
  if (!Array.isArray(rows)) return { high: [], medium: [], low: [] };

  const high = [];
  const medium = [];
  const low = [];

  for (const item of rows) {
    if (!isReviewQueueItem(item)) continue;
    const reason = reviewReasonForItem(item);
    const { priority } = assignPriority({ reason });
    const enriched = { ...item, priority, review_reason: reason };

    if (priority === "high") high.push(enriched);
    else if (priority === "medium") medium.push(enriched);
    else low.push(enriched);
  }

  return { high, medium, low };
}

/**
 * Programmatic alias for {@link captureUserDecision} → {@link applyDecision}.
 * Prefer calling `applyDecision` with `decision_type` when wiring new code; this exists for stable API shape.
 *
 * @param {{
 *   file?: string | null,
 *   selected_room: string,
 *   decision_type: "learning" | "express_pass" | "exemption",
 *   predicted_label?: string | null,
 *   confidence?: number,
 *   scope?: "global" | "single",
 * }} payload
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function submitDecision(payload) {
  return captureUserDecision(payload);
}

/**
 * @returns {ReturnType<typeof generateSessionReport>}
 */
export function getSessionSummary() {
  return generateSessionReport();
}

/**
 * @returns {ReturnType<typeof generateSuggestions>}
 */
export function getSuggestions() {
  return generateSuggestions();
}

/**
 * User control rules (force_review / bypass_review) and bypass audit log.
 * @returns {{ rules: unknown[], bypassLog: unknown[] }}
 */
export function getUserControlState() {
  const { rules } = loadUserControlRules();
  return { rules: Array.isArray(rules) ? rules : [], bypassLog: readBypassReviewLog() };
}

/**
 * @param {{
 *   predicted_label: string,
 *   effect: "force_review" | "bypass_review",
 *   enabled?: boolean,
 * }} payload
 */
export function setUserControlRuleApi(payload = {}) {
  try {
    if (payload.remove === true) {
      removeUserControlRule({
        predicted_label: typeof payload.predicted_label === "string" ? payload.predicted_label : "",
        effect: /** @type {"force_review"|"bypass_review"} */ (payload.effect),
      });
      return { ok: true };
    }
    setUserControlRule({
      predicted_label: typeof payload.predicted_label === "string" ? payload.predicted_label : "",
      effect: /** @type {"force_review"|"bypass_review"} */ (payload.effect),
      enabled: payload.enabled,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Export result rows to a configured target (filesystem or simulated external).
 * @param {{
 *   target: string,
 *   results: unknown,
 *   cwd?: string,
 *   split?: boolean,
 *   externalTarget?: string
 * }} payload
 * @returns {{ ok: true, target: string } & Record<string, unknown> | { ok: false, target?: string, error: string }}
 */
export function exportData(payload = {}) {
  const target = payload?.target;
  const results = payload?.results;
  const cwd = payload?.cwd;
  const split = payload?.split;
  const externalTarget = payload?.externalTarget;

  try {
    const status = sendOutput({
      target,
      results,
      cwd,
      split,
      externalTarget,
    });
    return { ok: true, target: String(target ?? ""), ...status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, target: target != null ? String(target) : undefined, error: msg };
  }
}

/**
 * @param {string} dir
 * @param {string} file
 */
function fileIsUnderDir(dir, file) {
  const base = resolve(dir);
  const f = resolve(file);
  if (f === base) return true;
  const pref = base.endsWith(sep) ? base : base + sep;
  return f.startsWith(pref);
}

/**
 * Buffer/url ingest writes under tmpBase. Files not moved (e.g. review) must survive rmSync(tmpBase).
 * Copies remaining files to cwd/temp/claira_ingest_hold/ and updates result row paths for applyDecision / UI.
 * @param {import("./processFolderPipeline.js").ProcessPipelineItem[]} pipelineItems
 * @param {unknown[]} results
 * @param {string} tmpBase
 * @param {string} cwd
 */
function persistRemainingAdapterTempFiles(pipelineItems, results, tmpBase, cwd) {
  if (!existsSync(tmpBase)) return;
  const holdRoot = resolve(cwd, "temp", "claira_ingest_hold");
  for (let i = 0; i < pipelineItems.length; i++) {
    const it = pipelineItems[i];
    if (!it || it.skip === true) continue;
    const abs = it.absPath;
    if (typeof abs !== "string" || !fileIsUnderDir(tmpBase, abs)) continue;
    if (!existsSync(abs)) continue;
    mkdirSync(holdRoot, { recursive: true });
    const dest = join(holdRoot, `${Date.now()}_${i}_${basename(abs)}`);
    try {
      copyFileSync(abs, dest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[learning] ingest hold copy failed: ${msg} (${abs})`);
      const row = results[i];
      if (row && typeof row === "object") {
        const r = /** @type {Record<string, unknown>} */ (row);
        r.ingest_hold_error = msg;
        if (typeof r.filePath === "string" && fileIsUnderDir(tmpBase, r.filePath)) {
          delete r.filePath;
        }
        const cc = r.classification_conflict;
        if (cc && typeof cc === "object") {
          const cco = /** @type {Record<string, unknown>} */ (cc);
          if (typeof cco.filePath === "string" && fileIsUnderDir(tmpBase, cco.filePath)) {
            delete cco.filePath;
          }
        }
      }
      continue;
    }
    const row = results[i];
    if (!row || typeof row !== "object") continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    const cc = r.classification_conflict;
    if (cc && typeof cc === "object") {
      const cco = /** @type {Record<string, unknown>} */ (cc);
      if (typeof cco.filePath === "string" && resolve(cco.filePath) === resolve(abs)) {
        cco.filePath = dest;
      }
    }
    r.filePath = dest;
  }
}

/**
 * @param {string} url
 * @param {string} destDir
 * @param {number} index
 * @returns {Promise<string>} absolute path to written file
 */
async function fetchUrlToTempFile(url, destDir, index) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const lower = url.toLowerCase();
  const ext = lower.includes(".png")
    ? ".png"
    : lower.includes(".webp")
      ? ".webp"
      : lower.includes(".jpg") || lower.includes(".jpeg")
        ? ".jpg"
        : "";
  const name = `url_${index}${ext || ".bin"}`;
  const p = join(destDir, name);
  writeFileSync(p, buf);
  return p;
}

/**
 * @param {{ source: string, input?: unknown, ocr?: boolean }} args — `ocr: true` runs OCR for source `"file"` only (default off)
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<{ source: string, items: unknown[] }>}
 */
export async function ingestData(args, options = {}) {
  const source = args?.source;
  const input = args?.input;
  const cwd = options.cwd ?? process.cwd();
  const s = String(source ?? "").toLowerCase();

  if (s === "file") {
    if (typeof input !== "string" || !input.length) {
      throw new Error('ingestData: source "file" requires input (folder path string)');
    }
    const { ingestFiles } = getAdapter("file");
    const ocr = args?.ocr === true;
    const items = await ingestFiles(input, { cwd, ocr });
    return { source: "file", items };
  }

  if (s === "document") {
    if (typeof input !== "string" || !input.length) {
      throw new Error('ingestData: source "document" requires input (folder path string)');
    }
    const { ingestDocuments } = getAdapter("document");
    const items = await ingestDocuments(input, { cwd });
    return { source: "document", items };
  }

  if (s === "external") {
    const { fetchExternalData } = getAdapter("external");
    const items = await fetchExternalData();
    return { source: "external", items };
  }

  getAdapter(String(source));
  throw new Error("ingestData: unreachable");
}

/**
 * Run the process-folder pipeline on normalized adapter items (images only; other types yield skip rows).
 * @param {unknown[]} normalizedData
 * @param {{ cwd?: string, workflowContext?: { entityId?: string, clientId?: string }, runtimeContext?: {
 *   appMode?: string,
 *   oversightLevel?: string,
 *   expectedCategory?: string,
 *   autoMove?: boolean,
 *   strictValidation?: boolean,
 *   reviewThreshold?: number,
 * } }} [options]
 * @returns {Promise<{
 *   processed: number,
 *   moved: number,
 *   review: number,
 *   results: unknown[],
 *   reviewPriorityCounts: { high: number, medium: number, low: number },
 *   workflowModuleErrors?: string[],
 * }>}
 */
export async function processData(normalizedData, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  if (!Array.isArray(normalizedData)) {
    throw new Error("processData: expected array of normalized inputs");
  }

  const tmpBase = mkdtempSync(join(tmpdir(), "claira-adapter-"));
  let urlIndex = 0;

  /** @type {import("./processFolderPipeline.js").ProcessPipelineItem[]} */
  const pipelineItems = [];

  try {
    for (let i = 0; i < normalizedData.length; i++) {
      const norm = normalizeInput(normalizedData[i]);
      const rel = norm.metadata.originalName;

      if (norm.type !== "image") {
        pipelineItems.push({
          skip: true,
          row: { rel, error: "unsupported_type", item_type: norm.type },
        });
        continue;
      }

      if (norm.data.filePath) {
        const absPath = resolve(cwd, norm.data.filePath);
        const pi =
          typeof norm.metadata.extractedText === "string" && norm.metadata.extractedText.length
            ? { skip: false, absPath, rel, extractedText: norm.metadata.extractedText }
            : { skip: false, absPath, rel };
        pipelineItems.push(pi);
        continue;
      }

      if (norm.data.buffer) {
        const buf = Buffer.isBuffer(norm.data.buffer)
          ? norm.data.buffer
          : Buffer.from(/** @type {Uint8Array} */ (norm.data.buffer));
        const ext = extname(norm.metadata.originalName);
        const safeExt = ext && ext.length <= 8 ? ext : ".png";
        const name = `buffer_${i}${safeExt}`.replace(/[^a-zA-Z0-9._-]/g, "_");
        const p = join(tmpBase, name || `buffer_${i}.png`);
        writeFileSync(p, buf);
        const pi =
          typeof norm.metadata.extractedText === "string" && norm.metadata.extractedText.length
            ? { skip: false, absPath: p, rel, extractedText: norm.metadata.extractedText }
            : { skip: false, absPath: p, rel };
        pipelineItems.push(pi);
        continue;
      }

      if (norm.data.url) {
        try {
          const absPath = await fetchUrlToTempFile(norm.data.url, tmpBase, urlIndex++);
          const pi =
            typeof norm.metadata.extractedText === "string" && norm.metadata.extractedText.length
              ? { skip: false, absPath, rel, extractedText: norm.metadata.extractedText }
              : { skip: false, absPath, rel };
          pipelineItems.push(pi);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          pipelineItems.push({
            skip: true,
            row: { rel, error: "ingest_fetch_failed", message: msg },
          });
        }
        continue;
      }

      pipelineItems.push({
        skip: true,
        row: { rel, error: "no_usable_input" },
      });
    }

    const out = await runProcessItemsPipeline(pipelineItems, {
      cwd,
      runtimeContext: options.runtimeContext,
    });
    persistRemainingAdapterTempFiles(pipelineItems, out.results, tmpBase, cwd);
    const wf = options.workflowContext && typeof options.workflowContext === "object" ? options.workflowContext : {};
    const entityId = String(wf.entityId ?? wf.clientId ?? "").trim();
    const { moduleErrors } = dispatchPostPipeline(out, {
      entityId,
      cwd,
      templateId: typeof wf.templateId === "string" ? wf.templateId : undefined,
    });
    try {
      const outPath = join(resolve(cwd, "output"), "results.json");
      writeFileSync(outPath, JSON.stringify(out.results, null, 2), "utf8");
    } catch {
      /* ignore */
    }
    return {
      ...out,
      ...(moduleErrors.length ? { workflowModuleErrors: moduleErrors } : {}),
    };
  } finally {
    try {
      rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Active pack workflow template (packs/&lt;active&gt;/workflow_template.json).
 */
export function getActiveWorkflowTemplateApi() {
  const packSlug = readActivePackIndustry();
  if (!packSlug) {
    throw new Error("getActiveWorkflowTemplateApi: no active pack (config/active_pack.json)");
  }
  const wfSrc = readPackWorkflowSource(packSlug);
  if (wfSrc !== "generated") {
    throw new Error(
      'getActiveWorkflowTemplateApi: modular workflow is only for custom-built packs (pack.workflowSource must be "generated")',
    );
  }
  const hint = `packs/${packSlug}/workflow_template.json`;
  const template = readWorkflowTemplateFromActivePack();
  if (!template) {
    throw new Error(`getActiveWorkflowTemplateApi: missing ${hint}`);
  }
  assertWorkflowTemplateContract(template, hint);
  return { ok: true, packSlug, template };
}

/**
 * Packs that define workflow_template.json (composition metadata for UI hub).
 */
export function listWorkflowCompositionsApi() {
  const packs = listIndustryPacks();
  const activePackSlug = readActivePackIndustry();
  /** @type {unknown[]} */
  const workflows = [];
  for (const p of packs) {
    const tmplPath = join(TRAINER_ROOT, "packs", p.slug, "workflow_template.json");
    if (!existsSync(tmplPath)) continue;
    const wfSrc = readPackWorkflowSource(p.slug);
    if (wfSrc !== "generated") {
      throw new Error(
        `packs/${p.slug}: workflow_template.json exists but pack.workflowSource is not "generated" (found ${wfSrc === undefined ? "missing" : JSON.stringify(wfSrc)})`,
      );
    }
    const raw = JSON.parse(readFileSync(tmplPath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Invalid workflow template (not an object): ${tmplPath}`);
    }
    const hint = tmplPath.split(/[/\\]/g).join("/").replace(/^.*\/packs\//, "packs/");
    assertWorkflowTemplateContract(raw, hint);
    const o = /** @type {Record<string, unknown>} */ (raw);
    workflows.push({
      slug: p.slug,
      packLabel: p.label,
      workflowSource: "generated",
      templateId: o.templateId,
      label: o.label,
      modules: o.modules,
      moduleOptions: o.moduleOptions,
      template: raw,
    });
  }
  return { ok: true, activePackSlug, workflows };
}

/**
 * @param {{ displayName?: string }} [input]
 */
export function createTrainerClientApi(input = {}) {
  return createTrainerClient(input.displayName ?? "");
}

export function listTrainerClientsApi() {
  return listTrainerClients();
}

/**
 * @param {{ entityId?: string, clientId?: string }} [input]
 */
export function getTrainerClientApi(input = {}) {
  const id = String(input.entityId ?? input.clientId ?? "").trim();
  const r = getTrainerClient(id);
  if (!r.ok) return r;
  const clientId = r.client.id;
  const events = listTrainerEvents(clientId)
    .slice()
    .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  return { ok: true, client: r.client, events, assets: listTrainerAssets(clientId) };
}

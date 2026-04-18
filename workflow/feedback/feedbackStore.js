/**
 * Phase 13–18 — User feedback + semantic memory + cross-batch group patterns + deterministic memory reinforcement (Phase 18).
 * Path helpers are browser-safe (no `node:path`); `node:fs` is stubbed in the Vite client graph via `ui/vite.config.mjs`.
 */

import fs from "node:fs";

/**
 * @typedef {{
 *   originalLabels: string[],
 *   refinedCategory: string | null,
 *   userCorrectedCategory: string,
 *   filename: string,
 *   timestamp: number,
 *   feedbackType?: "normal" | "override",
 *   incorrectCount?: number,
 *   lastFeedbackType?: string,
 *   assetId?: string,
 *   sourceRef?: string,
 *   semanticTokens?: string[],
 *   labelThemes?: string[],
 *   embeddingSignature?: number[],
 *   reasoningContext?: Record<string, unknown>,
 * }} FeedbackEntry
 */

/**
 * @typedef {{
 *   semanticTokens: string[],
 *   labelThemes: string[],
 *   groupType: string | null,
 *   dominantCategory: string,
 * }} GroupPatternSignature
 */

/**
 * Persisted with each group pattern (Phase 18).
 * @typedef {{
 *   hierarchyHint?: string | null,
 *   groupType?: string | null,
 *   finalCategory?: string | null,
 * }} GroupPatternRouteContext
 */

/**
 * @typedef {{
 *   groupSignature: string,
 *   dominantCategory: string,
 *   semanticTokens?: string[],
 *   labelThemes?: string[],
 *   embeddingSignature?: number[],
 *   patternSignature?: GroupPatternSignature,
 *   patternMatchScore?: number,
 *   hitCount: number,
 *   timestamp: number,
 *   updatedAt?: number,
 *   usageCount?: number,
 *   successCount?: number,
 *   lastUsedAt?: number,
 *   routeContext?: GroupPatternRouteContext | null,
 *   userOverridePrioritized?: boolean,
 *   incorrectCount?: number,
 * }} GroupPatternEntry
 */

/**
 * @typedef {{
 *   userCorrectedCategory: string,
 *   strength: "strong" | "weak",
 *   matchCount: number,
 * }} LearningMatch
 */

/**
 * @typedef {{
 *   tokenScore: number,
 *   themeScore: number,
 *   embeddingScore: number,
 *   contextScore: number,
 *   combined: number,
 *   weights: { wT: number, wH: number, wE: number, wC: number },
 * }} SemanticScoreBreakdown
 */

/**
 * @typedef {{
 *   userCorrectedCategory: string,
 *   semanticMatchScore: number,
 *   strength: "strong" | "weak",
 *   scoreBreakdown?: SemanticScoreBreakdown,
 * }} SemanticMemoryMatch
 */

const DEFAULT_REL = "workflow/feedback/data/feedback_store.json";

/**
 * @param {string} a
 * @param {string} b
 */
function joinPosix(a, b) {
  const A = String(a ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const B = String(b ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!A) return B;
  if (!B) return A;
  return `${A}/${B}`;
}

/**
 * @param {string} p
 */
function isAbsPath(p) {
  const s = String(p ?? "");
  return /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("/") || s.startsWith("\\\\");
}

/**
 * @param {string} relOrAbs
 */
function resolveFromCwd(relOrAbs) {
  const r = String(relOrAbs ?? "").trim();
  if (!r) return "";
  const norm = r.replace(/\\/g, "/");
  if (isAbsPath(r)) return norm;
  const cwd =
    typeof process !== "undefined" && typeof process.cwd === "function"
      ? String(process.cwd()).replace(/\\/g, "/").replace(/\/+$/, "")
      : "";
  return cwd ? joinPosix(cwd, norm) : norm;
}

/**
 * @param {string} p
 */
function dirnamePosix(p) {
  const s = String(p ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return s.slice(0, i) || ".";
}

/** @type {{ entries: FeedbackEntry[], groupPatterns: GroupPatternEntry[], memorySequence: number } | null} */
let fullCache = null;

/**
 * @returns {boolean}
 */
function isNode() {
  return typeof process !== "undefined" && process.versions != null && typeof process.versions.node === "string";
}

/**
 * @returns {string | null}
 */
function storePath() {
  if (!isNode()) return null;
  const override = process.env.FEEDBACK_STORE_PATH;
  if (typeof override === "string" && override.trim()) return resolveFromCwd(override.trim());
  return resolveFromCwd(DEFAULT_REL);
}

/**
 * @returns {{ entries: FeedbackEntry[], groupPatterns: GroupPatternEntry[], memorySequence: number }}
 */
function readDiskFull() {
  const p = storePath();
  if (!p || !fs.existsSync(p)) return { entries: [], groupPatterns: [], memorySequence: 0 };
  try {
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw);
    const rawEntries = j != null && Array.isArray(j.entries) ? j.entries.filter((x) => x != null && typeof x === "object") : [];
    const entries = rawEntries.map(migrateFeedbackEntry);
    const rawPatterns =
      j != null && Array.isArray(j.groupPatterns) ? j.groupPatterns.filter((x) => x != null && typeof x === "object") : [];
    let memorySequence = typeof j.memorySequence === "number" && Number.isFinite(j.memorySequence) ? Math.max(0, Math.floor(j.memorySequence)) : 0;
    /** @type {GroupPatternEntry[]} */
    const groupPatterns = rawPatterns.map(migrateGroupPatternEntry);
    for (const gp of groupPatterns) {
      if (typeof gp.lastUsedAt === "number" && Number.isFinite(gp.lastUsedAt)) {
        memorySequence = Math.max(memorySequence, Math.floor(gp.lastUsedAt));
      }
    }
    return { entries, groupPatterns: sortGroupPatternsDeterministic(groupPatterns), memorySequence };
  } catch {
    return { entries: [], groupPatterns: [], memorySequence: 0 };
  }
}

/**
 * @param {Record<string, unknown>} row
 * @returns {GroupPatternEntry}
 */
function migrateGroupPatternEntry(row) {
  const o = /** @type {GroupPatternEntry} */ (row);
  const hit = typeof o.hitCount === "number" && Number.isFinite(o.hitCount) ? Math.max(0, Math.floor(o.hitCount)) : 0;
  const usage =
    typeof o.usageCount === "number" && Number.isFinite(o.usageCount)
      ? Math.max(0, Math.floor(o.usageCount))
      : hit;
  const success = typeof o.successCount === "number" && Number.isFinite(o.successCount) ? Math.max(0, Math.floor(o.successCount)) : 0;
  const lastUsed =
    typeof o.lastUsedAt === "number" && Number.isFinite(o.lastUsedAt) ? Math.max(0, Math.floor(o.lastUsedAt)) : 0;
  /** @type {GroupPatternRouteContext | null} */
  let routeContext = null;
  if (o.routeContext != null && typeof o.routeContext === "object" && !Array.isArray(o.routeContext)) {
    const rc = /** @type {Record<string, unknown>} */ (o.routeContext);
    routeContext = {
      hierarchyHint: rc.hierarchyHint != null ? String(rc.hierarchyHint) : null,
      groupType: rc.groupType != null ? String(rc.groupType) : null,
      finalCategory: rc.finalCategory != null ? String(rc.finalCategory) : null,
    };
  }
  const uo = o.userOverridePrioritized === true;
  const incorrect =
    typeof o.incorrectCount === "number" && Number.isFinite(o.incorrectCount) ? Math.max(0, Math.floor(o.incorrectCount)) : 0;
  return {
    ...o,
    usageCount: usage,
    successCount: success,
    lastUsedAt: lastUsed,
    incorrectCount: incorrect,
    ...(routeContext != null ? { routeContext } : {}),
    ...(uo ? { userOverridePrioritized: true } : {}),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {FeedbackEntry}
 */
function migrateFeedbackEntry(row) {
  const o = /** @type {Record<string, unknown>} */ (row);
  const feedbackType = o.feedbackType === "override" ? "override" : "normal";
  const incorrectCount =
    typeof o.incorrectCount === "number" && Number.isFinite(o.incorrectCount) ? Math.max(0, Math.floor(o.incorrectCount)) : 0;
  const lastFeedbackType =
    typeof o.lastFeedbackType === "string" && o.lastFeedbackType.trim()
      ? String(o.lastFeedbackType)
      : feedbackType === "override"
        ? "override"
        : "normal";
  return /** @type {FeedbackEntry} */ ({
    ...row,
    feedbackType,
    incorrectCount,
    lastFeedbackType,
  });
}

/**
 * @param {GroupPatternEntry[]} patterns
 * @returns {GroupPatternEntry[]}
 */
function sortGroupPatternsDeterministic(patterns) {
  return [...patterns].sort((a, b) => String(a.groupSignature).localeCompare(String(b.groupSignature)));
}

/**
 * @param {number} x
 * @returns {number}
 */
function round6(x) {
  return Number(Number(x).toFixed(6));
}

/**
 * @param {number} x
 * @returns {number}
 */
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/**
 * @param {number} successRate
 * @returns {"high" | "medium" | "low"}
 */
function tierFromSuccessRate(successRate) {
  if (successRate >= 0.8) return "high";
  if (successRate >= 0.5) return "medium";
  return "low";
}

/**
 * @param {"high" | "medium" | "low"} tier
 * @returns {number}
 */
function weightMultiplierForTier(tier) {
  if (tier === "high") return 1.15;
  if (tier === "medium") return 1.0;
  return 0.85;
}

/**
 * Phase 18 — memory influence from stored group pattern (deterministic; no randomness).
 * @param {GroupPatternEntry} p
 * @param {number} baseSemanticScore semanticMatchScore (0–1)
 * @param {number} [contextFactor=1] context factor from reasoning (0–1); defaults to 1 when omitted
 * @returns {{
 *   memoryInfluenceScore: number,
 *   weightTier: "high" | "medium" | "low",
 *   weightMultiplier: number,
 *   weightedMemoryScore: number,
 *   usageCount: number,
 *   successRate: number,
 *   historicalConfidence: number,
 * }}
 */
export function computeGroupPatternMemoryMetrics(p, baseSemanticScore, contextFactor = 1) {
  const semanticMatchScore =
    typeof baseSemanticScore === "number" && Number.isFinite(baseSemanticScore) ? clamp01(baseSemanticScore) : 0;
  const cf =
    typeof contextFactor === "number" && Number.isFinite(contextFactor) ? clamp01(contextFactor) : 0;
  const usage = typeof p.usageCount === "number" ? Math.max(0, Math.floor(p.usageCount)) : 0;
  const success = typeof p.successCount === "number" ? Math.max(0, Math.floor(p.successCount)) : 0;
  const incorrect = typeof p.incorrectCount === "number" ? Math.max(0, Math.floor(p.incorrectCount)) : 0;
  /** Historical confidence: successCount / (usageCount + incorrectCount); ties memory influence to reinforcement tallies. */
  const denom = usage + incorrect;
  let confidenceScore = 0;
  if (denom > 0) {
    confidenceScore = clamp01(success / denom);
  }
  /** Dampens patterns that accumulated incorrect override signals (deterministic). */
  const penaltyFactor = 1 / (1 + incorrect);
  const adjustedConfidence = clamp01(confidenceScore * penaltyFactor);
  const overrideBoost = p.userOverridePrioritized === true ? 1.1 : 1;
  let memoryInfluenceScore = adjustedConfidence * semanticMatchScore * cf * overrideBoost;
  memoryInfluenceScore = clamp01(Math.min(memoryInfluenceScore, 1));
  const weightTier = tierFromSuccessRate(confidenceScore);
  const weightMultiplier = weightMultiplierForTier(weightTier);
  const weightedMemoryScore = clamp01(memoryInfluenceScore * weightMultiplier);
  let historicalConfidence = clamp01(adjustedConfidence * weightedMemoryScore);
  if (p.userOverridePrioritized === true) {
    historicalConfidence = Math.max(0.6, historicalConfidence);
  }
  return {
    memoryInfluenceScore: round6(memoryInfluenceScore),
    weightTier,
    weightMultiplier,
    weightedMemoryScore: round6(weightedMemoryScore),
    usageCount: usage,
    successRate: round6(confidenceScore),
    historicalConfidence: round6(historicalConfidence),
  };
}

/**
 * @param {string} groupSignature
 * @returns {GroupPatternEntry | null}
 */
export function getGroupPatternEntry(groupSignature) {
  const sig = String(groupSignature ?? "").trim();
  if (!sig) return null;
  for (const p of allGroupPatterns()) {
    if (String(p.groupSignature) === sig) return p;
  }
  return null;
}

/**
 * Increment usage and monotonic lastUsedAt (sequence). Invoked when a group pattern matches.
 * @param {string} groupSignature
 * @returns {void}
 */
export function touchGroupPatternUsage(groupSignature) {
  const sig = String(groupSignature ?? "").trim();
  if (!sig) return;
  const store = getFullStore();
  const patterns = [...store.groupPatterns];
  const idx = patterns.findIndex((p) => String(p.groupSignature) === sig);
  if (idx < 0) return;
  let seq = typeof store.memorySequence === "number" ? store.memorySequence : 0;
  seq += 1;
  const prev = patterns[idx];
  patterns[idx] = {
    ...prev,
    usageCount: (typeof prev.usageCount === "number" ? prev.usageCount : 0) + 1,
    lastUsedAt: seq,
  };
  setFullStore({ ...store, groupPatterns: patterns, memorySequence: seq });
}

/**
 * Reinforce success when the final refined category matches the pattern (Phase 18).
 * @param {string} groupSignature
 * @param {string | null | undefined} finalCategory
 * @returns {void}
 */
export function registerGroupPatternOutcome(groupSignature, finalCategory) {
  const sig = String(groupSignature ?? "").trim();
  if (!sig) return;
  const fin = normCatKeyLocal(String(finalCategory ?? ""));
  if (!fin) return;
  const store = getFullStore();
  const patterns = [...store.groupPatterns];
  const idx = patterns.findIndex((p) => String(p.groupSignature) === sig);
  if (idx < 0) return;
  const row = patterns[idx];
  const dom = normCatKeyLocal(String(row.dominantCategory ?? ""));
  const rc = row.routeContext != null && typeof row.routeContext === "object" ? row.routeContext : null;
  const rcFinal = rc != null && rc.finalCategory != null ? normCatKeyLocal(String(rc.finalCategory)) : "";
  let correct = fin === dom;
  if (rcFinal) correct = correct || fin === rcFinal;
  if (!correct) return;
  patterns[idx] = {
    ...row,
    successCount: (typeof row.successCount === "number" ? row.successCount : 0) + 1,
  };
  setFullStore({ ...store, groupPatterns: patterns });
}

/**
 * @param {{ entries: FeedbackEntry[], groupPatterns: GroupPatternEntry[], memorySequence: number }} data
 */
function writeDiskFull(data) {
  const p = storePath();
  if (!p) return;
  fs.mkdirSync(dirnamePosix(p), { recursive: true });
  const seq = typeof data.memorySequence === "number" && Number.isFinite(data.memorySequence) ? Math.max(0, Math.floor(data.memorySequence)) : 0;
  fs.writeFileSync(
    p,
    JSON.stringify(
      {
        version: 3,
        memorySequence: seq,
        entries: data.entries,
        groupPatterns: sortGroupPatternsDeterministic(data.groupPatterns),
      },
      null,
      2,
    ),
    "utf8",
  );
}

/**
 * @returns {{ entries: FeedbackEntry[], groupPatterns: GroupPatternEntry[], memorySequence: number }}
 */
function getFullStore() {
  if (fullCache == null) {
    fullCache = readDiskFull();
    if (typeof fullCache.memorySequence !== "number") fullCache.memorySequence = 0;
  }
  return fullCache;
}

/**
 * Capability override entries for a module (reasoningContext.moduleId), most recent last.
 * @param {string} moduleId
 * @returns {FeedbackEntry[]}
 */
export function getCapabilityOverrideEntriesForModule(moduleId) {
  const mid = String(moduleId ?? "").trim();
  if (!mid) return [];
  return getFullStore().entries.filter((e) => {
    const rc = e.reasoningContext;
    return (
      rc != null &&
      typeof rc === "object" &&
      !Array.isArray(rc) &&
      String(/** @type {{ moduleId?: string }} */ (rc).moduleId ?? "") === mid
    );
  });
}

/**
 * @returns {FeedbackEntry[]}
 */
function allEntries() {
  return getFullStore().entries;
}

/**
 * @returns {GroupPatternEntry[]}
 */
function allGroupPatterns() {
  return getFullStore().groupPatterns;
}

/**
 * @param {{ entries: FeedbackEntry[], groupPatterns: GroupPatternEntry[], memorySequence: number }} next
 */
function setFullStore(next) {
  const seq = typeof next.memorySequence === "number" ? next.memorySequence : 0;
  fullCache = { ...next, memorySequence: seq, groupPatterns: sortGroupPatternsDeterministic(next.groupPatterns) };
  writeDiskFull(fullCache);
}

/**
 * Test-only: clear memory and optional disk file.
 */
export function clearFeedbackStore() {
  fullCache = { entries: [], groupPatterns: [], memorySequence: 0 };
  const p = storePath();
  if (p && fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {string} ref
 * @returns {string}
 */
export function basenameOnly(ref) {
  const s = String(ref ?? "").replace(/\\/g, "/");
  const parts = s.split("/").filter((x) => x.length > 0);
  return parts.length ? parts[parts.length - 1] : s || "?";
}

/**
 * @param {string} filename
 * @returns {string}
 */
export function normalizeStemKey(filename) {
  const base = basenameOnly(filename);
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  return String(stem ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number}
 */
function jaccardStrings(a, b) {
  const A = new Set(a.map((x) => String(x).toLowerCase().trim()).filter(Boolean));
  const B = new Set(b.map((x) => String(x).toLowerCase().trim()).filter(Boolean));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) {
    if (B.has(x)) inter++;
  }
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * @param {string | null | undefined} s
 */
function normCatKeyLocal(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

/**
 * FNV-1a 32-bit — deterministic (no randomness).
 * @param {string} str
 */
function fnv1aHash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * @param {FeedbackEntry} entry
 */
function groupSignatureForUserOverrideFeedback(entry) {
  const cat = normCatKeyLocal(String(entry.userCorrectedCategory ?? ""));
  const toks = Array.isArray(entry.semanticTokens)
    ? [...entry.semanticTokens].map((x) => String(x).toLowerCase().trim()).filter(Boolean).sort()
    : [];
  const th = Array.isArray(entry.labelThemes)
    ? [...entry.labelThemes].map((x) => String(x).toLowerCase().trim()).filter(Boolean).sort()
    : [];
  const emb =
    Array.isArray(entry.embeddingSignature) && entry.embeddingSignature.length > 0
      ? entry.embeddingSignature.map((x) => Number(Number(x).toFixed(4))).join(",")
      : "";
  const raw = `${cat}\u0000${toks.join("\u0001")}\u0000${th.join("\u0001")}\u0000${emb}`;
  const h = fnv1aHash32(raw);
  return `uo_${cat.slice(0, 64)}_${h.toString(16)}`;
}

/**
 * Deterministic signatures for override reinforcement tests / tooling.
 * @param {FeedbackEntry} entry
 * @returns {{ corrected: string, originalPenalty: string }}
 */
export function getOverrideFeedbackGroupSignatures(entry) {
  return {
    corrected: groupSignatureForUserOverrideFeedback(entry),
    originalPenalty: groupSignatureForOriginalCategoryPenalty(entry),
  };
}

/** Same token/theme/emb key as override path; hash prefix separates original (penalized) category bucket. */
function groupSignatureForOriginalCategoryPenalty(entry) {
  const cat = normCatKeyLocal(String(entry.refinedCategory ?? ""));
  const toks = Array.isArray(entry.semanticTokens)
    ? [...entry.semanticTokens].map((x) => String(x).toLowerCase().trim()).filter(Boolean).sort()
    : [];
  const th = Array.isArray(entry.labelThemes)
    ? [...entry.labelThemes].map((x) => String(x).toLowerCase().trim()).filter(Boolean).sort()
    : [];
  const emb =
    Array.isArray(entry.embeddingSignature) && entry.embeddingSignature.length > 0
      ? entry.embeddingSignature.map((x) => Number(Number(x).toFixed(4))).join(",")
      : "";
  const raw = `pen_orig\u0000${cat}\u0000${toks.join("\u0001")}\u0000${th.join("\u0001")}\u0000${emb}`;
  const h = fnv1aHash32(raw);
  return `uo_pen_${cat.slice(0, 64)}_${h.toString(16)}`;
}

/**
 * @param {FeedbackEntry} entry
 * @returns {boolean}
 */
function isOverrideFeedbackEntry(entry) {
  if (entry.feedbackType === "override") return true;
  const rc = entry.reasoningContext;
  return rc != null && typeof rc === "object" && !Array.isArray(rc) && rc.userOverride === true;
}

/**
 * Override feedback: reinforce corrected outcome (+1 usageCount, +2 successCount on correct bucket).
 * Penalize incorrect/original bucket (+1 incorrectCount only; successCount unchanged).
 * @param {FeedbackEntry} entry
 */
function reinforceGroupPatternFromUserOverride(entry) {
  if (!isOverrideFeedbackEntry(entry)) return;
  const cat = String(entry.userCorrectedCategory ?? "").trim();
  if (!cat) return;

  const sig = groupSignatureForUserOverrideFeedback(entry);
  recordGroupPattern({
    groupSignature: sig,
    dominantCategory: cat,
    semanticTokens: Array.isArray(entry.semanticTokens) ? entry.semanticTokens.map(String) : [],
    labelThemes: Array.isArray(entry.labelThemes) ? entry.labelThemes.map(String) : [],
    embeddingSignature: Array.isArray(entry.embeddingSignature) ? entry.embeddingSignature : null,
    routeContext: { finalCategory: cat },
  });
  const storeAfterCorrect = getFullStore();
  const patternsCorrect = [...storeAfterCorrect.groupPatterns];
  const idxCorrect = patternsCorrect.findIndex((p) => String(p.groupSignature) === sig);
  if (idxCorrect < 0) return;
  let seq = typeof storeAfterCorrect.memorySequence === "number" ? storeAfterCorrect.memorySequence : 0;
  seq += 1;
  const rowCorrect = patternsCorrect[idxCorrect];
  patternsCorrect[idxCorrect] = {
    ...rowCorrect,
    usageCount: (typeof rowCorrect.usageCount === "number" ? rowCorrect.usageCount : 0) + 1,
    successCount: (typeof rowCorrect.successCount === "number" ? rowCorrect.successCount : 0) + 2,
    lastUsedAt: seq,
    userOverridePrioritized: true,
  };
  setFullStore({ ...storeAfterCorrect, groupPatterns: patternsCorrect, memorySequence: seq });

  const origKey = normCatKeyLocal(String(entry.refinedCategory ?? ""));
  const corrKey = normCatKeyLocal(cat);
  if (!origKey || origKey === corrKey) return;

  const penSig = groupSignatureForOriginalCategoryPenalty(entry);
  const domOrig = String(entry.refinedCategory ?? "").trim() || origKey;
  recordGroupPattern({
    groupSignature: penSig,
    dominantCategory: domOrig,
    semanticTokens: Array.isArray(entry.semanticTokens) ? entry.semanticTokens.map(String) : [],
    labelThemes: Array.isArray(entry.labelThemes) ? entry.labelThemes.map(String) : [],
    embeddingSignature: Array.isArray(entry.embeddingSignature) ? entry.embeddingSignature : null,
    routeContext: { finalCategory: cat },
  });
  const storePen = getFullStore();
  const patternsPen = [...storePen.groupPatterns];
  const idxPen = patternsPen.findIndex((p) => String(p.groupSignature) === penSig);
  if (idxPen < 0) return;
  seq = typeof storePen.memorySequence === "number" ? storePen.memorySequence : 0;
  seq += 1;
  const rowPen = patternsPen[idxPen];
  patternsPen[idxPen] = {
    ...rowPen,
    incorrectCount: (typeof rowPen.incorrectCount === "number" ? rowPen.incorrectCount : 0) + 1,
    lastUsedAt: seq,
  };
  setFullStore({ ...storePen, groupPatterns: patternsPen, memorySequence: seq });
}

/**
 * @param {GroupPatternEntry} p
 * @param {GroupPatternEntry | null} currentBest
 */
function betterGroupPatternEntry(p, currentBest) {
  if (currentBest == null) return true;
  const sp = typeof p.successCount === "number" ? Math.floor(p.successCount) : 0;
  const sb = typeof currentBest.successCount === "number" ? Math.floor(currentBest.successCount) : 0;
  if (sp !== sb) return sp > sb;
  const op = p.userOverridePrioritized === true ? 1 : 0;
  const ob = currentBest.userOverridePrioritized === true ? 1 : 0;
  return op > ob;
}

/**
 * Deterministic filename-derived tokens (prefix, sequence markers, version tags).
 * @param {string} ref
 * @returns {string[]}
 */
export function computeFilenamePatternTokens(ref) {
  const base = basenameOnly(ref);
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  const lower = stem.toLowerCase();
  /** @type {string[]} */
  const out = [];
  const vm = /^(v\d{1,3})(?:[^\d]|$)/i.exec(lower);
  if (vm) out.push(String(vm[1]).toLowerCase());
  if (/frame|frm|seq|sequence/.test(lower)) out.push("seq_marker");
  const nm = /[_-](?:frame|frm|seq)?[_-]?0*(\d{2,4})(?=[_.-]|$)/i.exec(lower);
  if (nm) out.push(`idx_${nm[1]}`);
  const parts = lower.split(/[_\-.]+/).filter(Boolean);
  const prefix = parts[0];
  if (prefix && prefix.length >= 2 && prefix.length <= 32 && !/^\d+$/.test(prefix)) out.push(prefix);
  return [...new Set(out)].slice(0, 10);
}

/**
 * @param {string[]} fpToks
 * @param {string} entryFilename
 */
function filenamePatternOverlap(fpToks, entryFilename) {
  const stem = String(entryFilename ?? "").includes(".")
    ? String(entryFilename).slice(0, String(entryFilename).lastIndexOf("."))
    : String(entryFilename ?? "");
  const parts = stem
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);
  const a = fpToks.map((x) => String(x).toLowerCase());
  return a.length || parts.length ? jaccardStrings(a, parts) : 0;
}

/**
 * Route / history proxy alignment (group consensus, feedback history, hierarchy hints).
 * @param {Record<string, unknown> | null | undefined} routeContext
 * @param {string} entryCategory
 * @param {string[]} themes
 * @param {string[]} tokens
 * @param {FeedbackEntry} entry
 */
function routeAndHistoryScore(routeContext, entryCategory, themes, tokens, entry) {
  if (routeContext == null || typeof routeContext !== "object") return 0;
  let s = 0;
  const ec = normCatKeyLocal(entryCategory);
  const gc =
    "groupConsensusCategory" in routeContext && routeContext.groupConsensusCategory != null
      ? normCatKeyLocal(String(routeContext.groupConsensusCategory))
      : "";
  if (gc && ec && gc === ec) s += 0.44;
  const dh =
    "dominantHistoryTop" in routeContext && routeContext.dominantHistoryTop != null
      ? normCatKeyLocal(String(routeContext.dominantHistoryTop))
      : "";
  if (dh && ec && dh === ec) s += 0.34;
  const hh =
    "hierarchyHint" in routeContext && routeContext.hierarchyHint != null ? String(routeContext.hierarchyHint).toLowerCase() : "";
  if (hh) {
    const pool = `${themes.join(" ")} ${tokens.join(" ")}`;
    const words = hh.split(/[^\w]+/).filter((w) => w.length > 2);
    let hits = 0;
    for (const w of words) {
      if (pool.includes(w.toLowerCase())) hits++;
    }
    s += Math.min(0.2, 0.1 * hits);
  }
  const gt =
    "groupType" in routeContext && routeContext.groupType != null ? String(routeContext.groupType).toLowerCase() : "";
  const eth = Array.isArray(entry.labelThemes) ? entry.labelThemes.map((x) => String(x).toLowerCase()) : [];
  const etok = Array.isArray(entry.semanticTokens) ? entry.semanticTokens.map((x) => String(x).toLowerCase()) : [];
  if (gt && (eth.some((t) => t.includes(gt) || gt.includes(t)) || etok.some((t) => t.includes(gt) || gt.includes(t)))) {
    s += 0.12;
  }
  return Math.min(1, s);
}

/**
 * @param {number[] | null | undefined} a
 * @param {number[] | undefined} b
 * @returns {number | null}
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return null;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * @param {number[] | null | undefined} emb
 * @param {number} maxDim
 * @returns {number[] | null}
 */
export function embeddingSignatureFrom(emb, maxDim = 24) {
  if (!Array.isArray(emb) || emb.length === 0) return null;
  const n = Math.min(maxDim, emb.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = Number(emb[i]);
    out.push(Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0);
  }
  return out;
}

/**
 * @param {Omit<FeedbackEntry, "timestamp"> & { timestamp?: number }} entry
 * @returns {void}
 */
export function recordFeedbackEntry(entry) {
  const sig =
    Array.isArray(entry.embeddingSignature) && entry.embeddingSignature.length > 0
      ? entry.embeddingSignature.map((x) => Number(x))
      : undefined;

  const feedbackType = entry.feedbackType === "override" ? "override" : "normal";
  const incorrectCountFb =
    typeof entry.incorrectCount === "number" && Number.isFinite(entry.incorrectCount)
      ? Math.max(0, Math.floor(entry.incorrectCount))
      : 0;
  const lastFeedbackType =
    typeof entry.lastFeedbackType === "string" && entry.lastFeedbackType.trim()
      ? String(entry.lastFeedbackType)
      : feedbackType === "override"
        ? "override"
        : "normal";

  const full = /** @type {FeedbackEntry} */ ({
    originalLabels: Array.isArray(entry.originalLabels) ? entry.originalLabels.map(String) : [],
    refinedCategory: entry.refinedCategory != null ? String(entry.refinedCategory) : null,
    userCorrectedCategory: String(entry.userCorrectedCategory ?? "").trim() || "unknown",
    filename: String(entry.filename ?? "").trim() || "unknown",
    timestamp: typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
    feedbackType,
    incorrectCount: incorrectCountFb,
    lastFeedbackType,
    ...(entry.assetId != null ? { assetId: String(entry.assetId) } : {}),
    ...(entry.sourceRef != null ? { sourceRef: String(entry.sourceRef) } : {}),
    ...(Array.isArray(entry.semanticTokens) && entry.semanticTokens.length > 0
      ? { semanticTokens: entry.semanticTokens.map((x) => String(x)) }
      : {}),
    ...(Array.isArray(entry.labelThemes) && entry.labelThemes.length > 0
      ? { labelThemes: entry.labelThemes.map((x) => String(x)) }
      : {}),
    ...(sig != null && sig.length > 0 ? { embeddingSignature: sig } : {}),
    ...(entry.reasoningContext != null &&
    typeof entry.reasoningContext === "object" &&
    !Array.isArray(entry.reasoningContext)
      ? { reasoningContext: JSON.parse(JSON.stringify(entry.reasoningContext)) }
      : {}),
  });

  const store = getFullStore();
  const list = [...store.entries, full];
  setFullStore({ ...store, entries: list });
  reinforceGroupPatternFromUserOverride(full);
}

/**
 * Deterministic JSON-like string for capability override diff (sorted keys at every object level).
 * Note: `JSON.stringify(obj, sortedKeyArray)` uses the array as a property whitelist, not key ordering.
 * @param {unknown} value
 * @returns {string}
 */
function stableJsonStringify(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "number") return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  if (t === "boolean") return value ? "true" : "false";
  if (t === "undefined") return "null";
  if (Array.isArray(value)) {
    return `[${value.map((x) => stableJsonStringify(x)).join(",")}]`;
  }
  if (t === "object") {
    const o = /** @type {Record<string, unknown>} */ (value);
    const keys = Object.keys(o).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJsonStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

/**
 * Phase 3 / strengthened learning — capability apply: same override reinforcement as category UI (+2/+1 correct bucket, +incorrect penalty bucket).
 * @param {{
 *   rowId: string,
 *   moduleId: string,
 *   originalValues: Record<string, unknown>,
 *   finalValues: Record<string, unknown>,
 *   filename?: string,
 *   timestamp?: number,
 * }} input
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function recordCapabilityOverrideFeedback(input) {
  const rowId = String(input.rowId ?? "").trim();
  const moduleId = String(input.moduleId ?? "").trim();
  if (!rowId) return { ok: false, error: "rowId required" };
  if (!moduleId) return { ok: false, error: "moduleId required" };
  const orig = input.originalValues != null && typeof input.originalValues === "object" && !Array.isArray(input.originalValues)
    ? /** @type {Record<string, unknown>} */ (input.originalValues)
    : {};
  const fin = input.finalValues != null && typeof input.finalValues === "object" && !Array.isArray(input.finalValues)
    ? /** @type {Record<string, unknown>} */ (input.finalValues)
    : {};
  const origKeys = Object.keys(orig).sort();
  const origStr = stableJsonStringify(orig);
  const finStr = stableJsonStringify(fin);
  if (origStr === finStr) return { ok: false, error: "original and final are identical" };

  /** @type {string[]} */
  const semanticTokens = [];
  if (typeof fin.filename === "string" && fin.filename.trim()) {
    for (const t of computeFilenamePatternTokens(fin.filename)) semanticTokens.push(t);
  }
  if (Array.isArray(fin.tags)) {
    for (const t of fin.tags) semanticTokens.push(String(t).toLowerCase().trim());
  }
  if (typeof fin.folderPath === "string" && fin.folderPath.trim()) {
    for (const part of fin.folderPath.split(/[/\\]+/)) {
      const p = part.trim().toLowerCase();
      if (p.length >= 2) semanticTokens.push(p);
    }
  }

  const originalLabels = origKeys.map((k) => `incorrect:${k}:${stableJsonStringify(orig[k])}`);

  recordFeedbackEntry({
    feedbackType: "override",
    incorrectCount: 0,
    lastFeedbackType: "capability_override",
    originalLabels,
    refinedCategory: `capability:${moduleId}`,
    userCorrectedCategory: finStr.length > 480 ? `${finStr.slice(0, 477)}…` : finStr,
    filename: String(input.filename ?? rowId).trim() || rowId,
    timestamp: typeof input.timestamp === "number" && Number.isFinite(input.timestamp) ? input.timestamp : Date.now(),
    semanticTokens: [...new Set(semanticTokens)].slice(0, 24),
    labelThemes: ["capability_override", moduleId],
    reasoningContext: {
      userOverride: true,
      feedbackType: "override",
      capabilityOverride: true,
      rowId,
      moduleId,
      incorrect: orig,
      correct: fin,
      originalValues: orig,
      finalValues: fin,
    },
  });
  return { ok: true };
}

/**
 * Deterministic intrinsic composition (no store lookup) with explicit breakdown.
 * @param {{
 *   semanticTokens?: string[],
 *   labelThemes?: string[],
 *   embedding?: number[] | null,
 * }} input
 * @returns {SemanticScoreBreakdown}
 */
export function computeSemanticMatchScoreIntrinsicDetailed(input) {
  const t = Array.isArray(input.semanticTokens) ? input.semanticTokens.map((x) => String(x).toLowerCase().trim()).filter(Boolean) : [];
  const h = Array.isArray(input.labelThemes) ? input.labelThemes.map((x) => String(x).toLowerCase().trim()).filter(Boolean) : [];
  const tokenScore = Number(jaccardStrings(t, h).toFixed(4));
  const themeScore = Number((t.length === 0 ? 0 : Math.min(1, t.length / 8)).toFixed(4));
  let embeddingScore = 0;
  const sig = input.embedding != null && Array.isArray(input.embedding) ? embeddingSignatureFrom(input.embedding) : null;
  if (sig != null && sig.length > 0) {
    let sum = 0;
    for (const x of sig) sum += Math.abs(Number(x));
    embeddingScore = Number(Math.min(1, (sum / sig.length) * 1.15).toFixed(4));
  }
  const combined = Number(Math.min(1, 0.48 * tokenScore + 0.28 * themeScore + 0.24 * embeddingScore).toFixed(4));
  return {
    tokenScore,
    themeScore,
    embeddingScore,
    contextScore: 0,
    combined,
    weights: { wT: 0.48, wH: 0.28, wE: 0.24, wC: 0 },
  };
}

/**
 * Deterministic 0–1 score from token/theme alignment + embedding strength (no store lookup).
 * @param {{
 *   semanticTokens?: string[],
 *   labelThemes?: string[],
 *   embedding?: number[] | null,
 * }} input
 * @returns {number}
 */
export function computeSemanticMatchScoreIntrinsic(input) {
  return computeSemanticMatchScoreIntrinsicDetailed(input).combined;
}

/**
 * Semantic memory: match stored feedback with Phase 17 multi-signal composition.
 * @param {{
 *   semanticTokens?: string[],
 *   labelThemes?: string[],
 *   embedding?: number[] | null,
 *   cosineThreshold?: number,
 *   filenamePatternTokens?: string[],
 *   routeContext?: {
 *     hierarchyHint?: string | null,
 *     groupType?: string | null,
 *     groupConsensusCategory?: string | null,
 *     dominantHistoryTop?: string | null,
 *   } | null,
 * }} input
 * @returns {SemanticMemoryMatch | null}
 */
export function findSemanticMemoryMatch(input) {
  const tokens = Array.isArray(input.semanticTokens) ? input.semanticTokens.map((x) => String(x).toLowerCase()) : [];
  const themes = Array.isArray(input.labelThemes) ? input.labelThemes.map((x) => String(x).toLowerCase()) : [];
  const fpToks = Array.isArray(input.filenamePatternTokens)
    ? input.filenamePatternTokens.map((x) => String(x).toLowerCase().trim()).filter(Boolean)
    : [];
  const routeContext = input.routeContext != null && typeof input.routeContext === "object" ? input.routeContext : null;
  const embIn = Array.isArray(input.embedding) && input.embedding.length > 0 ? input.embedding : null;
  const sigIn = embIn != null ? embeddingSignatureFrom(embIn) : null;
  const cosThresh = typeof input.cosineThreshold === "number" && input.cosineThreshold > 0 ? input.cosineThreshold : 0.82;

  const entries = allEntries();
  let bestScore = 0;
  /** @type {string | null} */
  let bestCat = null;
  /** @type {SemanticScoreBreakdown | null} */
  let bestBreakdown = null;
  /** @type {FeedbackEntry | null} */
  let bestEntry = null;

  for (const e of entries) {
    const cat = String(e.userCorrectedCategory ?? "")
      .trim()
      .toLowerCase();
    if (!cat) continue;

    const etok =
      Array.isArray(e.semanticTokens) && e.semanticTokens.length > 0
        ? e.semanticTokens.map((x) => String(x).toLowerCase())
        : (Array.isArray(e.originalLabels) ? e.originalLabels : []).map((x) => String(x).toLowerCase());
    const eth =
      Array.isArray(e.labelThemes) && e.labelThemes.length > 0
        ? e.labelThemes.map((x) => String(x).toLowerCase())
        : [];

    const tScore = tokens.length || etok.length ? jaccardStrings(tokens, etok) : 0;
    const hScore = themes.length || eth.length ? jaccardStrings(themes, eth) : 0;
    let embScore = 0;
    if (sigIn != null && Array.isArray(e.embeddingSignature) && e.embeddingSignature.length === sigIn.length) {
      const c = cosineSimilarity(sigIn, e.embeddingSignature);
      if (c != null) embScore = Math.max(0, c);
    }

    const routeSc = routeAndHistoryScore(routeContext, cat, themes, tokens, e);
    const fpSc = fpToks.length ? filenamePatternOverlap(fpToks, e.filename) : 0;
    const contextScore = Number(Math.min(1, 0.62 * routeSc + 0.38 * fpSc).toFixed(4));

    const sparseSignals = tokens.length < 2 && themes.length >= 1;
    const hasEmbPair = sigIn != null && Array.isArray(e.embeddingSignature) && e.embeddingSignature.length === sigIn.length;

    let wT = 0.28;
    let wH = 0.26;
    let wE = 0.38;
    let wC = 0.08;
    if (!hasEmbPair) {
      wT = sparseSignals ? 0.36 : 0.42;
      wH = sparseSignals ? 0.38 : 0.38;
      wE = 0;
      wC = sparseSignals ? 0.26 : 0.2;
    } else if (sparseSignals) {
      wT -= 0.04;
      wH += 0.03;
      wC += 0.04;
      wE -= 0.03;
    }

    const strongEmb = embScore >= cosThresh * 0.97;
    if (strongEmb) wC *= 0.45;

    let sumW = wT + wH + wE + wC;
    wT /= sumW;
    wH /= sumW;
    wE /= sumW;
    wC /= sumW;

    let combined = wT * tScore + wH * hScore + wE * embScore + wC * contextScore;
    if (embIn != null && embScore >= cosThresh) {
      combined = Math.max(combined, Math.min(1, 0.52 * combined + 0.48 * (embScore * 0.96)));
    }

    const dims = [tScore, hScore, embScore, contextScore].filter((x) => x > 0.07 && x < 0.48);
    if (dims.length >= 2) {
      combined = Math.min(1, combined + 0.032 * (dims.length - 1));
    }
    combined = Math.min(1, combined);

    const bd = {
      tokenScore: Number(tScore.toFixed(4)),
      themeScore: Number(hScore.toFixed(4)),
      embeddingScore: Number(embScore.toFixed(4)),
      contextScore,
      combined: Number(combined.toFixed(4)),
      weights: { wT: Number(wT.toFixed(4)), wH: Number(wH.toFixed(4)), wE: Number(wE.toFixed(4)), wC: Number(wC.toFixed(4)) },
    };

    if (combined > bestScore + 1e-10) {
      bestScore = combined;
      bestCat = cat;
      bestBreakdown = bd;
      bestEntry = e;
    } else if (Math.abs(combined - bestScore) <= 1e-10) {
      const eOv =
        e.feedbackType === "override" ||
        (e.reasoningContext != null &&
          typeof e.reasoningContext === "object" &&
          !Array.isArray(e.reasoningContext) &&
          /** @type {{ userOverride?: unknown }} */ (e.reasoningContext).userOverride === true);
      const bOv =
        bestEntry != null &&
        (bestEntry.feedbackType === "override" ||
          (bestEntry.reasoningContext != null &&
            typeof bestEntry.reasoningContext === "object" &&
            !Array.isArray(bestEntry.reasoningContext) &&
            /** @type {{ userOverride?: unknown }} */ (bestEntry.reasoningContext).userOverride === true));
      if (eOv && !bOv) {
        bestCat = cat;
        bestBreakdown = bd;
        bestEntry = e;
      }
    }
  }

  if (bestCat == null || bestScore < 0.38) return null;
  const strength = bestScore >= 0.62 ? "strong" : "weak";
  let semanticMatchScore = Math.min(1, Number(bestScore.toFixed(4)));
  const uOvSemantic =
    bestEntry != null &&
    (bestEntry.feedbackType === "override" ||
      (bestEntry.reasoningContext != null &&
        typeof bestEntry.reasoningContext === "object" &&
        !Array.isArray(bestEntry.reasoningContext) &&
        /** @type {{ userOverride?: unknown }} */ (bestEntry.reasoningContext).userOverride === true));
  if (uOvSemantic) semanticMatchScore = Math.max(0.6, semanticMatchScore);
  return {
    userCorrectedCategory: bestCat,
    semanticMatchScore,
    strength,
    ...(bestBreakdown != null ? { scoreBreakdown: bestBreakdown } : {}),
  };
}

/**
 * Record / reinforce a recurring group structure for cross-batch memory.
 * @param {{
 *   groupSignature: string,
 *   dominantCategory: string,
 *   semanticTokens?: string[],
 *   labelThemes?: string[],
 *   embeddingSignature?: number[] | null,
 *   groupType?: string | null,
 *   routeContext?: GroupPatternRouteContext | null,
 * }} pattern
 * @returns {void}
 */
export function recordGroupPattern(pattern) {
  const sig = String(pattern.groupSignature ?? "").trim();
  const dom = String(pattern.dominantCategory ?? "").trim().toLowerCase();
  if (!sig || !dom) return;

  const tok = Array.isArray(pattern.semanticTokens) ? pattern.semanticTokens.map(String) : [];
  const thm = Array.isArray(pattern.labelThemes) ? pattern.labelThemes.map(String) : [];
  const gt = pattern.groupType != null && String(pattern.groupType).trim() ? String(pattern.groupType).trim() : null;
  const patternSignature =
    pattern.patternSignature != null && typeof pattern.patternSignature === "object" && !Array.isArray(pattern.patternSignature)
      ? /** @type {GroupPatternSignature} */ (pattern.patternSignature)
      : /** @type {GroupPatternSignature} */ ({
          semanticTokens: tok,
          labelThemes: thm,
          groupType: gt,
          dominantCategory: dom,
        });

  /** @type {GroupPatternRouteContext | null} */
  let routeCtx = null;
  if (pattern.routeContext != null && typeof pattern.routeContext === "object" && !Array.isArray(pattern.routeContext)) {
    const rc = /** @type {Record<string, unknown>} */ (pattern.routeContext);
    routeCtx = {
      hierarchyHint: rc.hierarchyHint != null ? String(rc.hierarchyHint) : null,
      groupType: rc.groupType != null ? String(rc.groupType) : null,
      finalCategory: rc.finalCategory != null ? String(rc.finalCategory) : null,
    };
  }

  const store = getFullStore();
  const patterns = [...store.groupPatterns];
  const idx = patterns.findIndex((p) => String(p.groupSignature) === sig);
  const row = /** @type {GroupPatternEntry} */ ({
    groupSignature: sig,
    dominantCategory: dom,
    patternSignature,
    hitCount: 1,
    timestamp: 0,
    usageCount: 0,
    successCount: 0,
    incorrectCount: 0,
    lastUsedAt: 0,
    ...(tok.length ? { semanticTokens: tok } : {}),
    ...(thm.length ? { labelThemes: thm } : {}),
    ...(Array.isArray(pattern.embeddingSignature) && pattern.embeddingSignature.length > 0
      ? { embeddingSignature: pattern.embeddingSignature.map((x) => Number(x)) }
      : {}),
    ...(routeCtx != null ? { routeContext: routeCtx } : {}),
  });

  if (idx >= 0) {
    const prev = patterns[idx];
    patterns[idx] = {
      ...prev,
      dominantCategory: dom,
      patternSignature,
      hitCount: (typeof prev.hitCount === "number" ? prev.hitCount : 0) + 1,
      updatedAt: 0,
      ...(row.semanticTokens ? { semanticTokens: row.semanticTokens } : {}),
      ...(row.labelThemes ? { labelThemes: row.labelThemes } : {}),
      ...(row.embeddingSignature ? { embeddingSignature: row.embeddingSignature } : {}),
      ...(routeCtx != null ? { routeContext: routeCtx } : {}),
    };
  } else {
    patterns.push(row);
  }

  setFullStore({ ...store, groupPatterns: patterns, memorySequence: typeof store.memorySequence === "number" ? store.memorySequence : 0 });
}

/**
 * Match batch / group signals against stored group patterns.
 * @param {{
 *   semanticTokens?: string[],
 *   labelThemes?: string[],
 *   embedding?: number[] | null,
 *   groupType?: string | null,
 * }} input
 * @returns {{ dominantCategory: string, patternScore: number, patternMatchScore: number, groupSignature: string } | null}
 */
export function findGroupPatternMatch(input) {
  const tokens = Array.isArray(input.semanticTokens) ? input.semanticTokens.map((x) => String(x).toLowerCase()) : [];
  const themes = Array.isArray(input.labelThemes) ? input.labelThemes.map((x) => String(x).toLowerCase()) : [];
  const inputGroupType =
    input.groupType != null && typeof input.groupType === "string" && String(input.groupType).trim()
      ? String(input.groupType).trim().toLowerCase()
      : null;
  const sigIn =
    Array.isArray(input.embedding) && input.embedding.length > 0 ? embeddingSignatureFrom(input.embedding) : null;

  const patterns = sortGroupPatternsDeterministic(allGroupPatterns());
  let best = 0;
  /** @type {GroupPatternEntry | null} */
  let bestP = null;

  for (const p of patterns) {
    const ptok = Array.isArray(p.semanticTokens) ? p.semanticTokens.map((x) => String(x).toLowerCase()) : [];
    const pth = Array.isArray(p.labelThemes) ? p.labelThemes.map((x) => String(x).toLowerCase()) : [];
    const tScore = jaccardStrings(tokens, ptok);
    const hScore = jaccardStrings(themes, pth);
    let embScore = 0;
    if (sigIn != null && Array.isArray(p.embeddingSignature) && p.embeddingSignature.length === sigIn.length) {
      const c = cosineSimilarity(sigIn, p.embeddingSignature);
      if (c != null) embScore = c;
    }
    let combined =
      sigIn != null && Array.isArray(p.embeddingSignature) && p.embeddingSignature.length === sigIn.length
        ? 0.35 * tScore + 0.3 * hScore + 0.35 * embScore
        : 0.5 * tScore + 0.5 * hScore;

    const ps = p.patternSignature;
    if (ps != null && typeof ps === "object" && !Array.isArray(ps)) {
      const st = Array.isArray(ps.semanticTokens) ? ps.semanticTokens.map((x) => String(x).toLowerCase()) : [];
      const th = Array.isArray(ps.labelThemes) ? ps.labelThemes.map((x) => String(x).toLowerCase()) : [];
      const stMatch = st.length || tokens.length ? jaccardStrings(tokens, st) : 0;
      const thMatch = th.length || themes.length ? jaccardStrings(themes, th) : 0;
      const gt = String(ps.groupType ?? "")
        .trim()
        .toLowerCase();
      const gtMatch = inputGroupType && gt && inputGroupType === gt ? 1 : 0;
      const sigPart = 0.24 * stMatch + 0.22 * thMatch + 0.14 * gtMatch;
      combined = Math.min(1, combined + sigPart * (1 - combined * 0.35));
    }

    if (combined > best + 1e-10) {
      best = combined;
      bestP = p;
    } else if (Math.abs(combined - best) <= 1e-10 && betterGroupPatternEntry(p, bestP)) {
      best = combined;
      bestP = p;
    }
  }

  if (bestP == null || best < 0.35) return null;
  const patternMatchScore = Math.min(1, Number(best.toFixed(4)));
  touchGroupPatternUsage(String(bestP.groupSignature));
  return {
    dominantCategory: String(bestP.dominantCategory),
    patternScore: patternMatchScore,
    patternMatchScore,
    groupSignature: String(bestP.groupSignature),
  };
}

/**
 * Learned routing: repeated identical corrections for the same filename stem unlock a strong match.
 * @param {{
 *   filename: string,
 *   originalLabels?: string[],
 *   refinedCategory?: string | null,
 *   repeatThreshold?: number,
 * }} input
 * @returns {LearningMatch | null}
 */
export function findLearningMatch(input) {
  const stem = normalizeStemKey(input.filename);
  if (!stem) return null;
  const threshold = typeof input.repeatThreshold === "number" && input.repeatThreshold >= 1 ? input.repeatThreshold : 2;

  const entries = allEntries();
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const e of entries) {
    const k = normalizeStemKey(e.filename);
    if (k !== stem) continue;
    const cat = String(e.userCorrectedCategory ?? "").trim().toLowerCase();
    if (!cat) continue;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }

  let bestCat = "";
  let bestN = 0;
  for (const [c, n] of counts) {
    if (n > bestN) {
      bestN = n;
      bestCat = c;
    }
  }
  if (bestN >= threshold && bestCat) {
    return {
      userCorrectedCategory: bestCat,
      strength: "strong",
      matchCount: bestN,
    };
  }
  if (bestN === 1) {
    return {
      userCorrectedCategory: bestCat,
      strength: "weak",
      matchCount: 1,
    };
  }
  return null;
}

/**
 * @param {unknown} raw
 * @returns {{ immediateOverrides: Array<Record<string, unknown>>, persistCorrections: boolean } | null}
 */
export function feedbackConfigFromState(raw) {
  const st = raw != null && typeof raw === "object" && "runtimePipelineConfig" in raw ? raw.runtimePipelineConfig : null;
  if (st == null || typeof st !== "object" || st === null) return null;
  const fb = "feedback" in st ? /** @type {{ feedback?: unknown }} */ (st).feedback : null;
  if (fb == null || typeof fb !== "object" || Array.isArray(fb)) return null;
  const o = /** @type {{ immediateOverrides?: unknown, persistCorrections?: unknown }} */ (fb);
  const immediateOverrides = Array.isArray(o.immediateOverrides) ? o.immediateOverrides : [];
  const persistCorrections = o.persistCorrections !== false;
  return { immediateOverrides, persistCorrections };
}

/**
 * @param {string} assetId
 * @param {unknown[]} immediateOverrides
 * @returns {{ userCorrectedCategory: string, userRenamedTo?: string } | null}
 */
export function findImmediateOverride(assetId, immediateOverrides) {
  const id = String(assetId ?? "").trim();
  if (!id) return null;
  for (const raw of immediateOverrides) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const o = /** @type {{ assetId?: unknown, userCorrectedCategory?: unknown, userRenamedTo?: unknown }} */ (raw);
    if (String(o.assetId ?? "").trim() !== id) continue;
    const cat = String(o.userCorrectedCategory ?? "").trim();
    if (!cat) continue;
    const rename =
      typeof o.userRenamedTo === "string" && o.userRenamedTo.trim()
        ? basenameOnly(o.userRenamedTo.trim())
        : undefined;
    return { userCorrectedCategory: cat, ...(rename ? { userRenamedTo: rename } : {}) };
  }
  return null;
}

/**
 * Dominant user-corrected categories from persisted feedback (for Claira context).
 * @param {{ limit?: number } | undefined} opts
 * @returns {string[]}
 */
export function getDominantFeedbackCategories(opts) {
  const limit = opts != null && typeof opts.limit === "number" && opts.limit > 0 ? opts.limit : 5;
  const entries = allEntries();
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const e of entries) {
    const c = String(e.userCorrectedCategory ?? "")
      .trim()
      .toLowerCase();
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([cat]) => cat);
}

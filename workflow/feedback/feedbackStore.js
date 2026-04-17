/**
 * Phase 13–16 — User feedback + semantic memory + cross-batch group patterns (additive; optional disk persistence in Node).
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
 *   assetId?: string,
 *   sourceRef?: string,
 *   semanticTokens?: string[],
 *   labelThemes?: string[],
 *   embeddingSignature?: number[],
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

/** @type {{ entries: FeedbackEntry[], groupPatterns: GroupPatternEntry[] } | null} */
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
 * @returns {{ entries: FeedbackEntry[], groupPatterns: GroupPatternEntry[] }}
 */
function readDiskFull() {
  const p = storePath();
  if (!p || !fs.existsSync(p)) return { entries: [], groupPatterns: [] };
  try {
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw);
    const entries = j != null && Array.isArray(j.entries) ? j.entries.filter((x) => x != null && typeof x === "object") : [];
    const groupPatterns =
      j != null && Array.isArray(j.groupPatterns) ? j.groupPatterns.filter((x) => x != null && typeof x === "object") : [];
    return { entries, groupPatterns };
  } catch {
    return { entries: [], groupPatterns: [] };
  }
}

/**
 * @param {{ entries: FeedbackEntry[], groupPatterns: GroupPatternEntry[] }} data
 */
function writeDiskFull(data) {
  const p = storePath();
  if (!p) return;
  fs.mkdirSync(dirnamePosix(p), { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify({ version: 2, entries: data.entries, groupPatterns: data.groupPatterns }, null, 2),
    "utf8",
  );
}

/**
 * @returns {{ entries: FeedbackEntry[], groupPatterns: GroupPatternEntry[] }}
 */
function getFullStore() {
  if (fullCache == null) {
    fullCache = readDiskFull();
  }
  return fullCache;
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
 * @param {{ entries: FeedbackEntry[], groupPatterns: GroupPatternEntry[] }} next
 */
function setFullStore(next) {
  fullCache = next;
  writeDiskFull(next);
}

/**
 * Test-only: clear memory and optional disk file.
 */
export function clearFeedbackStore() {
  fullCache = { entries: [], groupPatterns: [] };
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

  const full = /** @type {FeedbackEntry} */ ({
    originalLabels: Array.isArray(entry.originalLabels) ? entry.originalLabels.map(String) : [],
    refinedCategory: entry.refinedCategory != null ? String(entry.refinedCategory) : null,
    userCorrectedCategory: String(entry.userCorrectedCategory ?? "").trim() || "unknown",
    filename: String(entry.filename ?? "").trim() || "unknown",
    timestamp: typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
    ...(entry.assetId != null ? { assetId: String(entry.assetId) } : {}),
    ...(entry.sourceRef != null ? { sourceRef: String(entry.sourceRef) } : {}),
    ...(Array.isArray(entry.semanticTokens) && entry.semanticTokens.length > 0
      ? { semanticTokens: entry.semanticTokens.map((x) => String(x)) }
      : {}),
    ...(Array.isArray(entry.labelThemes) && entry.labelThemes.length > 0
      ? { labelThemes: entry.labelThemes.map((x) => String(x)) }
      : {}),
    ...(sig != null && sig.length > 0 ? { embeddingSignature: sig } : {}),
  });

  const store = getFullStore();
  const list = [...store.entries, full];
  setFullStore({ ...store, entries: list });
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

    if (combined > bestScore) {
      bestScore = combined;
      bestCat = cat;
      bestBreakdown = {
        tokenScore: Number(tScore.toFixed(4)),
        themeScore: Number(hScore.toFixed(4)),
        embeddingScore: Number(embScore.toFixed(4)),
        contextScore,
        combined: Number(combined.toFixed(4)),
        weights: { wT: Number(wT.toFixed(4)), wH: Number(wH.toFixed(4)), wE: Number(wE.toFixed(4)), wC: Number(wC.toFixed(4)) },
      };
    }
  }

  if (bestCat == null || bestScore < 0.38) return null;
  const strength = bestScore >= 0.62 ? "strong" : "weak";
  return {
    userCorrectedCategory: bestCat,
    semanticMatchScore: Math.min(1, Number(bestScore.toFixed(4))),
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

  const store = getFullStore();
  const patterns = [...store.groupPatterns];
  const idx = patterns.findIndex((p) => String(p.groupSignature) === sig);
  const row = /** @type {GroupPatternEntry} */ ({
    groupSignature: sig,
    dominantCategory: dom,
    patternSignature,
    hitCount: 1,
    timestamp: Date.now(),
    ...(tok.length ? { semanticTokens: tok } : {}),
    ...(thm.length ? { labelThemes: thm } : {}),
    ...(Array.isArray(pattern.embeddingSignature) && pattern.embeddingSignature.length > 0
      ? { embeddingSignature: pattern.embeddingSignature.map((x) => Number(x)) }
      : {}),
  });

  if (idx >= 0) {
    const prev = patterns[idx];
    patterns[idx] = {
      ...prev,
      dominantCategory: dom,
      patternSignature,
      hitCount: (typeof prev.hitCount === "number" ? prev.hitCount : 0) + 1,
      updatedAt: Date.now(),
      ...(row.semanticTokens ? { semanticTokens: row.semanticTokens } : {}),
      ...(row.labelThemes ? { labelThemes: row.labelThemes } : {}),
      ...(row.embeddingSignature ? { embeddingSignature: row.embeddingSignature } : {}),
    };
  } else {
    patterns.push(row);
  }

  setFullStore({ ...store, groupPatterns: patterns });
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

  const patterns = allGroupPatterns();
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

    if (combined > best) {
      best = combined;
      bestP = p;
    }
  }

  if (bestP == null || best < 0.35) return null;
  const patternMatchScore = Math.min(1, Number(best.toFixed(4)));
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

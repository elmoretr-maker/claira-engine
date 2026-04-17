/**
 * Phase 12–16 — Pluggable Claira reasoning layer for workflow (no fs / no watcher).
 * Phase 15: batch + CLIP embedding similarity, group detection, hierarchy hints.
 * Phase 16: semantic memory, group decisions, intent, confidence breakdown, cross-batch patterns.
 */

import {
  basenameOnly,
  computeSemanticMatchScoreIntrinsic,
  findGroupPatternMatch,
  findLearningMatch,
  findSemanticMemoryMatch,
  getDominantFeedbackCategories,
  recordGroupPattern,
  embeddingSignatureFrom,
} from "../feedback/feedbackStore.js";

/**
 * @typedef {{
 *   assetId: string,
 *   sourceRef: string,
 *   analysis: { category?: string, labels?: unknown[], confidence?: unknown, id?: string, embeddings?: unknown } | null,
 *   validation: Record<string, unknown> | null,
 *   batchContext?: {
 *     batchAssetCount: number,
 *     peers: Array<{ assetId: string, sourceRef: string, analysis: Record<string, unknown> | null }>,
 *     destinationRoot?: string,
 *     cwd?: string,
 *   },
 * }} ClairaReasoningInput
 */

/**
 * @typedef {{
 *   refinedCategory: string,
 *   reasoningConfidence: number | null,
 *   confidenceAdjustment: number | null,
 *   reasoningNotes: string,
 *   reviewRecommended: boolean,
 *   suggestedName: string,
 *   clairaReasoning: Record<string, unknown>,
 *   active: boolean,
 *   semanticSimilarityScore: number | null,
 *   groupId: string | null,
 *   groupType: string | null,
 *   alternativeCategories: string[],
 *   reasoningExplanation: string,
 *   inferredIntent?: string,
 *   intentConfidence?: number | null,
 *   intentCandidates?: Array<{ intent: string, score: number, categoryBoost: string | null, kind: string }>,
 *   intentSource?: "inferred" | "learned" | "fallback",
 *   groupPrior?: { groupConsensusCategory: string | null, groupConfidence: number, voteRatio: number } | null,
 *   effectiveThresholds?: { cosineSemantic: number, contextFactor: number },
 *   adaptiveWeights?: { feedbackStrength: number, groupCohesionStrength: number },
 *   groupDecisionApplied?: boolean,
 *   confidenceBreakdown?: {
 *     perceptionConfidence: number,
 *     validationConfidence: number,
 *     reasoningConfidence: number,
 *     learningConfidence: number,
 *     groupConfidence: number,
 *   },
 *   semanticMatchScore?: number | null,
 * }} ClairaReasoningResult
 */

/**
 * @typedef {{
 *   id: string,
 *   refineReasoning: (input: ClairaReasoningInput) => ClairaReasoningResult | Promise<ClairaReasoningResult>,
 * }} ClairaReasoningProvider
 */

/** @type {ClairaReasoningProvider | null} */
let registered = null;

/**
 * @param {ClairaReasoningProvider | null} provider
 */
export function setClairaReasoningProvider(provider) {
  registered = provider;
}

/**
 * @returns {ClairaReasoningProvider | null}
 */
export function getClairaReasoningProvider() {
  return registered;
}

export function clearClairaReasoningProvider() {
  registered = null;
}

/**
 * @param {number[] | null | undefined} a
 * @param {number[] | null | undefined} b
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
 * @param {string} s
 * @returns {string}
 */
function stemOnly(s) {
  const f = basenameOnly(s);
  return f.includes(".") ? f.slice(0, f.lastIndexOf(".")) : f;
}

/**
 * @param {string} stem
 * @returns {{ numericSuffix: number | null, baseStem: string }}
 */
function parseSequenceStem(stem) {
  const m = /^(.*?)[_-](?:frame|frm|seq|f)?[_-]?0*(\d+)$/i.exec(stem.trim());
  if (m) {
    return { numericSuffix: parseInt(m[2], 10), baseStem: String(m[1] ?? "").replace(/[_-]+$/g, "") };
  }
  const m2 = /^(.+?)(\d{2,4})$/i.exec(stem.trim());
  if (m2 && m2[1].length >= 2) {
    return { numericSuffix: parseInt(m2[2], 10), baseStem: String(m2[1] ?? "").replace(/[_-]+$/g, "") };
  }
  return { numericSuffix: null, baseStem: stem };
}

/**
 * @param {string[]} labels
 * @returns {string[]}
 */
function stripGenericLabels(labels) {
  return labels.filter((l) => !/^(misc|unknown|unclassified|other)$/i.test(String(l).trim()));
}

/**
 * @param {string[]} labels
 * @param {string} hfCat
 * @returns {{ themes: string[], inferredCategory: string | null }}
 */
function interpretLabels(labels, hfCat, filenameStem = "") {
  const L = labels.map((x) => String(x).toLowerCase());
  const joined = `${L.join(" ")} ${String(filenameStem ?? "").toLowerCase()}`.trim();
  const themes = [];
  /** @type {string | null} */
  let inferred = null;

  if (/(video\s*game|game\s*asset|sprite|player|character|idle|npc)/i.test(joined) || /video game/i.test(String(hfCat))) {
    themes.push("game_asset");
    inferred = inferred ?? "video game asset";
  }
  if (/(^|\s)(ui|button|interface|icon|panel)(\s|$)/i.test(joined) || /ui element/i.test(String(hfCat))) {
    themes.push("ui");
    inferred = inferred ?? "ui element";
  }
  if (/(toolbar|glyph|taskbar|titlebar|menubar)/i.test(joined)) {
    themes.push("ui");
    inferred = inferred ?? "ui element";
  }
  if (/(invoice|receipt|statement|tax|ledger)/i.test(joined)) {
    themes.push("finance");
    inferred = inferred ?? "document";
  }
  if (/(photograph|photo|portrait|snapshot)/i.test(joined) || /photograph/i.test(String(hfCat))) {
    themes.push("photography");
    inferred = inferred ?? "photograph";
  }
  if (/(document|pdf|scan|paperwork)/i.test(joined) || /document/i.test(String(hfCat))) {
    themes.push("document");
    inferred = inferred ?? "document";
  }

  const coherent = stripGenericLabels(labels);
  if (coherent.length >= 2 && inferred == null) {
    inferred = hfCat !== "unknown" ? hfCat : null;
  }

  return { themes: [...new Set(themes)], inferredCategory: inferred };
}

/**
 * @param {string} parentCategory
 * @param {string[]} labels
 * @param {string[]} folderSegments
 * @param {string} filenameStem
 * @returns {{ subcategory: string | null, pathHint: string | null }}
 */
function hierarchyHints(parentCategory, labels, folderSegments, filenameStem) {
  const joined = [...labels, ...folderSegments, filenameStem].join(" ").toLowerCase();
  const pc = String(parentCategory ?? "").toLowerCase();

  if (pc.includes("ui") || pc === "ui element") {
    if (/icon|glyph|symbol/.test(joined) || folderSegments.some((f) => /icon/i.test(f))) {
      return { subcategory: "icons", pathHint: "UI → Icons" };
    }
    if (/button|cta|click/.test(joined)) return { subcategory: "buttons", pathHint: "UI → Buttons" };
    if (/panel|sheet|modal|hud/.test(joined)) return { subcategory: "panels", pathHint: "UI → Panels" };
  }

  if (pc.includes("video game") || pc.includes("game")) {
    if (/sprite|sheet|tile|idle|walk|run|anim/.test(joined)) return { subcategory: "sprites", pathHint: "Game → Sprites" };
    if (/character|hero|npc|enemy|avatar/.test(joined)) return { subcategory: "characters", pathHint: "Game → Characters" };
    if (/background|bg|parallax|skybox|backdrop/.test(joined)) return { subcategory: "backgrounds", pathHint: "Game → Backgrounds" };
  }

  return { subcategory: null, pathHint: null };
}

/**
 * @param {string} filenameOrRef
 * @returns {string}
 */
function extOnly(filenameOrRef) {
  const b = basenameOnly(String(filenameOrRef ?? ""));
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i) : "";
}

/**
 * @param {string} sourceRef
 * @param {string | undefined} cwd
 * @returns {string[]}
 */
function folderSegmentsFromRef(sourceRef, cwd) {
  const s = String(sourceRef ?? "").replace(/\\/g, "/");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return [];
  const c = String(cwd ?? (typeof process !== "undefined" && process.cwd ? process.cwd() : ""))
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  let rel = s;
  const cn = c ? `${c}/` : "";
  if (c && (s === c || s.startsWith(cn))) {
    rel = s.slice(c.length).replace(/^\/+/, "");
  } else if (s.startsWith("/") || /^[A-Za-z]:/.test(s)) {
    const parts = s.split("/").filter((x) => x && !/^[.]?$/.test(x));
    if (parts.length > 1) rel = parts.slice(0, -1).join("/");
    else rel = "";
  }
  return rel.split(/[/\\]+/).filter((x) => x && !/^[.]?$/.test(x));
}

/**
 * @param {{
 *   ambiguousHf: boolean,
 *   hfCat: string,
 *   inferredCategory: string | null,
 *   refinedCategory: string,
 *   hierarchySub: string | null,
 * }} p
 * @returns {string[]}
 */
function buildAlternativeCategories(p) {
  /** @type {Set<string>} */
  const set = new Set();
  if (p.inferredCategory) set.add(p.inferredCategory);
  if (p.hfCat && p.hfCat !== "unknown") set.add(p.hfCat);
  if (p.refinedCategory && p.refinedCategory !== "review") set.add(p.refinedCategory);
  if (p.ambiguousHf && p.hfCat) set.add(`maybe:${p.hfCat}`);
  if (p.hierarchySub) set.add(`${p.refinedCategory} (${p.hierarchySub})`);
  return [...set].slice(0, 6);
}

/**
 * @param {unknown} analysis
 * @returns {number[] | null}
 */
function getEmbeddings(analysis) {
  if (analysis == null || typeof analysis !== "object" || Array.isArray(analysis)) return null;
  const e = /** @type {{ embeddings?: unknown }} */ (analysis).embeddings;
  return Array.isArray(e) && e.length > 0 ? e.map((x) => Number(x)) : null;
}

/**
 * @param {ClairaReasoningInput["batchContext"]} bc
 * @param {string} assetId
 * @param {number[] | null} myEmb
 * @returns {{ maxSim: number | null, coherentPeers: number }}
 */
function batchEmbeddingStats(bc, assetId, myEmb) {
  if (bc == null || myEmb == null) return { maxSim: null, coherentPeers: 0 };
  let maxSim = -1;
  let coherent = 0;
  for (const p of bc.peers) {
    const pe = getEmbeddings(p.analysis);
    if (pe == null) continue;
    const sim = cosineSimilarity(myEmb, pe);
    if (sim != null) {
      if (sim > maxSim) maxSim = sim;
      if (sim >= 0.82) coherent++;
    }
  }
  return { maxSim: maxSim < 0 ? null : maxSim, coherentPeers: coherent };
}

/**
 * @param {ClairaReasoningInput["batchContext"]} bc
 * @param {string} assetId
 * @param {string} sourceRef
 * @param {string} hfCat
 * @param {string[]} labels
 * @param {number[] | null} myEmb
 * @returns {{ groupId: string | null, groupType: string | null, sequenceBase: string | null, peerCount: number }}
 */
function detectGroup(bc, assetId, sourceRef, hfCat, labels, myEmb) {
  if (bc == null || bc.batchAssetCount < 2) {
    return { groupId: null, groupType: null, sequenceBase: null, peerCount: 0 };
  }

  const myStem = stemOnly(sourceRef);
  const mySeq = parseSequenceStem(myStem);
  /** @type {string[]} */
  const clusterIds = [assetId];
  let filenameCluster = false;
  let embCluster = false;

  const peers = bc.peers;
  for (const p of peers) {
    const oStem = stemOnly(p.sourceRef);
    const oSeq = parseSequenceStem(oStem);
    if (mySeq.baseStem && oSeq.baseStem && normSlug(mySeq.baseStem) === normSlug(oSeq.baseStem) && mySeq.numericSuffix != null && oSeq.numericSuffix != null) {
      clusterIds.push(p.assetId);
      filenameCluster = true;
    }
    const oEmb = getEmbeddings(p.analysis);
    if (myEmb != null && oEmb != null) {
      const sim = cosineSimilarity(myEmb, oEmb);
      if (sim != null && sim >= 0.9) {
        clusterIds.push(p.assetId);
        embCluster = true;
      }
    }
  }

  const uniq = [...new Set(clusterIds)].sort();
  if (uniq.length < 2) {
    return { groupId: null, groupType: null, sequenceBase: mySeq.baseStem || null, peerCount: peers.length };
  }

  const joined = labels.join(" ").toLowerCase();
  const isPhoto = /photograph|photo/i.test(joined) || /photograph/i.test(hfCat);
  const isGame = /video game|sprite|character|idle/i.test(joined) || /video game/i.test(hfCat);
  const isUi = /ui|icon|button|panel/i.test(joined) || /ui element/i.test(hfCat);

  /** @type {string | null} */
  let groupType = null;
  if (filenameCluster && isGame) groupType = "sprite_set";
  else if (filenameCluster && isPhoto) groupType = "photo_sequence";
  else if (filenameCluster && isUi) groupType = "icon_pack";
  else if (embCluster) groupType = "embedding_cluster";
  else if (filenameCluster) groupType = "filename_sequence";

  let h = 2166136261;
  const key = uniq.join("|");
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const groupId = `grp_${(h >>> 0).toString(16)}`;

  return {
    groupId,
    groupType,
    sequenceBase: mySeq.baseStem || null,
    peerCount: peers.length,
  };
}

/**
 * @param {string} stem
 * @returns {string[]}
 */
function tokenizeFilenameStem(stem) {
  const s = String(stem ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ");
  const parts = s
    .split(/[^a-zA-Z0-9]+/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.length > 1 && !GENERIC_FILENAME.has(x) && !/^\d+$/.test(x));
  return parts;
}

const GENERIC_FILENAME = new Set([
  "file",
  "image",
  "img",
  "asset",
  "new",
  "copy",
  "final",
  "v2",
  "v1",
  "edit",
  "untitled",
]);

/**
 * @param {string[]} labels
 * @returns {string[]}
 */
function labelsToSemanticTokens(labels) {
  /** @type {string[]} */
  const out = [];
  for (const raw of labels) {
    const l = String(raw).toLowerCase();
    if (/unclassified|unknown|misc/i.test(l)) continue;
    if (/video game asset|game asset/i.test(l)) {
      out.push("game");
      continue;
    }
    if (/ui element|^ui$/i.test(l)) {
      out.push("ui");
      continue;
    }
    if (l === "photograph" || l === "photo") {
      out.push("photo");
      continue;
    }
    const slug = normSlug(l);
    if (slug && slug.length <= 32) out.push(slug);
  }
  return [...new Set(out)].slice(0, 6);
}

/**
 * @param {string} refinedSlug
 * @param {string[]} fnToks
 * @param {string[]} labelToks
 * @param {number} maxParts
 * @param {{ groupType: string | null, sequenceBase: string | null, numericSuffix: number | null }} groupNaming
 * @returns {string}
 */
function buildSemanticStem(refinedSlug, fnToks, labelToks, maxParts, groupNaming) {
  const seen = new Set();
  /** @type {string[]} */
  const ordered = [];

  const push = (t) => {
    const x = normSlug(t);
    if (!x || seen.has(x)) return;
    seen.add(x);
    ordered.push(x);
  };

  if (groupNaming.groupType && groupNaming.sequenceBase) {
    push(normSlug(groupNaming.sequenceBase));
    push("set");
  }

  if (fnToks.length >= 2) {
    for (const t of fnToks) {
      push(t);
      if (ordered.length >= maxParts) break;
    }
  } else if (fnToks.length === 1) {
    push(fnToks[0]);
    for (const t of labelToks) {
      push(t);
      if (ordered.length >= maxParts) break;
    }
  } else {
    for (const t of labelToks) {
      push(t);
      if (ordered.length >= maxParts) break;
    }
    if (ordered.length === 0) push(refinedSlug);
  }

  if (groupNaming.numericSuffix != null && ordered.length < maxParts) {
    push(`n${groupNaming.numericSuffix}`);
  }

  if (ordered.length === 0) push(refinedSlug);
  return ordered.slice(0, maxParts).join("_") || refinedSlug;
}

/**
 * @param {string} c
 */
function normCatKey(c) {
  return String(c ?? "")
    .trim()
    .toLowerCase();
}

/**
 * @param {unknown[] | undefined} peers
 * @param {string} hfCat
 * @returns {number} 0–1 cohesion when group has peers
 */
function peerCategoryCohesion(peers, hfCat) {
  if (!Array.isArray(peers) || peers.length === 0) return 0.55;
  const set = new Set([normCatKey(hfCat)]);
  for (const p of peers) {
    if (p == null || typeof p !== "object" || Array.isArray(p)) continue;
    const a = /** @type {{ analysis?: { category?: unknown } | null }} */ (p).analysis;
    const c = a != null && typeof a === "object" && !Array.isArray(a) ? String(/** @type {{ category?: unknown }} */ (a).category ?? "") : "";
    if (c.trim()) set.add(normCatKey(c));
  }
  if (set.size <= 1) return 0.96;
  if (set.size === 2) return 0.74;
  return Math.max(0.38, 1 - (set.size - 1) * 0.17);
}

/**
 * @param {ClairaReasoningInput["batchContext"]} bc
 * @param {string | null} groupId
 * @param {string} hfCat
 * @returns {{ groupConsensusCategory: string | null, groupConfidence: number, voteRatio: number }}
 */
function computeGroupPrior(bc, groupId, hfCat) {
  if (!groupId || bc == null || !Array.isArray(bc.peers) || bc.peers.length === 0) {
    return { groupConsensusCategory: null, groupConfidence: 0.22, voteRatio: 0 };
  }
  /** @type {Map<string, number>} */
  const counts = new Map();
  const bump = (c) => {
    const k = normCatKey(c);
    if (!k || k === "review") return;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  bump(hfCat);
  for (const p of bc.peers) {
    if (p == null || typeof p !== "object" || Array.isArray(p)) continue;
    const a = /** @type {{ analysis?: { category?: unknown } | null }} */ (p).analysis;
    const c = a != null && typeof a === "object" && !Array.isArray(a) ? String(/** @type {{ category?: unknown }} */ (a).category ?? "") : "";
    bump(c);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const winner = sorted[0]?.[0] ?? "";
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const ratio = winner && total ? sorted[0][1] / total : 0;
  const cohesion = peerCategoryCohesion(bc.peers, hfCat);
  const groupConfidence = Number(
    Math.min(1, 0.32 * ratio + 0.52 * cohesion + (sorted.length <= 2 ? 0.12 : 0.04)).toFixed(4),
  );
  return { groupConsensusCategory: winner || null, groupConfidence, voteRatio: ratio };
}

/**
 * @param {{ groupStrength: number, feedbackStrength: number, signalAgreement: number }} p
 */
function computeContextFactor(p) {
  const g = Math.min(1, Math.max(0, p.groupStrength));
  const f = Math.min(1, Math.max(0, p.feedbackStrength));
  const s = Math.min(1, Math.max(0.35, p.signalAgreement));
  const v = Math.min(1.12, Math.max(0.86, 0.9 + 0.06 * s + 0.05 * g + 0.06 * f));
  return Number(v.toFixed(4));
}

/**
 * @param {{
 *   perceptionConfidence: number,
 *   validationConfidence: number,
 *   reasoningConfidence: number,
 *   learningConfidence: number,
 *   groupConfidence: number,
 * }} b
 * @param {{ feedbackStrength: number, groupCohesionStrength: number }} hooks
 */
function weightedConfidenceAdaptive(b, hooks) {
  const learningBoost = 1 + 0.35 * Math.min(1, Math.max(0, hooks.feedbackStrength));
  const groupBoost = 1 + 0.4 * Math.min(1, Math.max(0, hooks.groupCohesionStrength));
  let wP = 0.22;
  let wV = 0.22;
  let wR = 0.18;
  let wL = 0.18 * learningBoost;
  let wG = 0.2 * groupBoost;
  const sum = wP + wV + wR + wL + wG;
  wP /= sum;
  wV /= sum;
  wR /= sum;
  wL /= sum;
  wG /= sum;
  return Math.min(
    1,
    wP * b.perceptionConfidence +
      wV * b.validationConfidence +
      wR * b.reasoningConfidence +
      wL * b.learningConfidence +
      wG * b.groupConfidence,
  );
}

/**
 * Multi-signal intent (Section 9.5 + 16.1): seeds + surfaces + history; deterministic.
 * @param {{
 *   themes: string[],
 *   semanticTokens: string[],
 *   hierarchyPathHint: string | null,
 *   folderSeg: string[],
 *   dominantHistory: string[],
 *   groupType: string | null,
 *   groupId: string | null,
 *   peers: unknown[] | undefined,
 *   hfCategory: string,
 *   refinedCategory: string,
 *   hfLabels: string[],
 *   groupPrior: { groupConsensusCategory: string | null, groupConfidence: number } | null,
 * }} p
 * @returns {{
 *   inferredIntent: string,
 *   intentConfidence: number,
 *   categoryBoost: string | null,
 *   intentCandidates: Array<{ intent: string, score: number, categoryBoost: string | null, kind: string }>,
 *   intentSource: "inferred" | "learned" | "fallback",
 *   signalAgreement: number,
 * }}
 */
function inferIntentMultiSignal(p) {
  const themes = p.themes.map((x) => String(x).toLowerCase());
  const tokens = p.semanticTokens.map((x) => String(x).toLowerCase());
  const folder = p.folderSeg.map((x) => String(x).toLowerCase());
  const hist = p.dominantHistory.map((x) => String(x).toLowerCase());
  const hier = String(p.hierarchyPathHint ?? "").toLowerCase();
  const joined = `${themes.join(" ")} ${tokens.join(" ")} ${folder.join(" ")} ${hier}`.trim();
  const gt = String(p.groupType ?? "").toLowerCase();

  /** @type {{ id: string, categoryBoost: string | null, score: (s: string) => number }[]} */
  const seedBuckets = [
    {
      id: "ui",
      categoryBoost: "ui element",
      score: (s) => {
        let x = 0;
        if (/(^|[^a-z])(icon|button|glyph|toolbar|panel|interface|ui_element)([^a-z]|$)/i.test(s)) x += 0.34;
        if (/(^|[^a-z])ui([^a-z]|$)/i.test(themes.join(" "))) x += 0.28;
        if (/ui →|icons|buttons|panels/.test(hier)) x += 0.26;
        if (/icon_pack|filename_sequence/.test(gt) && /icon|ui/.test(s)) x += 0.14;
        for (const h of hist) {
          if (/ui|icon|button/.test(h)) x += 0.08;
        }
        return Math.min(1, x);
      },
    },
    {
      id: "game_asset",
      categoryBoost: "video game asset",
      score: (s) => {
        let x = 0;
        if (/(sprite|character|idle|npc|tile|anim|walk|run|game_asset|video game)/i.test(s)) x += 0.36;
        if (/game|sprite/.test(themes.join(" "))) x += 0.26;
        if (/game →|sprites|characters|backgrounds/.test(hier)) x += 0.26;
        if (/sprite_set|embedding_cluster/.test(gt) && /sprite|game|character/.test(s)) x += 0.14;
        for (const h of hist) {
          if (/game|video|sprite/.test(h)) x += 0.08;
        }
        return Math.min(1, x);
      },
    },
    {
      id: "finance",
      categoryBoost: "document",
      score: (s) => {
        let x = 0;
        if (/(invoice|receipt|tax|ledger|finance|statement|billing)/i.test(s)) x += 0.42;
        if (/finance|document/.test(themes.join(" "))) x += 0.22;
        for (const h of hist) {
          if (/invoice|receipt|document|tax/.test(h)) x += 0.1;
        }
        return Math.min(1, x);
      },
    },
    {
      id: "photography",
      categoryBoost: "photograph",
      score: (s) => {
        let x = 0;
        if (/(photo|photograph|portrait|camera|snapshot|landscape)/i.test(s)) x += 0.4;
        if (/photo|photography/.test(themes.join(" "))) x += 0.24;
        if (/photo_sequence/.test(gt)) x += 0.16;
        for (const h of hist) {
          if (/photo|image|portrait/.test(h)) x += 0.08;
        }
        return Math.min(1, x);
      },
    },
  ];

  const scoredSeeds = seedBuckets.map((b) => ({
    id: b.id,
    categoryBoost: b.categoryBoost,
    v: b.score(joined),
  }));
  scoredSeeds.sort((a, b) => b.v - a.v);
  const topSeed = scoredSeeds[0]?.v ?? 0;
  const secondSeed = scoredSeeds[1]?.v ?? 0;
  const signalAgreement = Number(Math.min(1, Math.max(0.38, topSeed / (topSeed + secondSeed + 0.001))).toFixed(4));

  /** @type {Array<{ intent: string, score: number, categoryBoost: string | null, kind: string }>} */
  const candidates = [];

  for (const b of seedBuckets) {
    const v = b.score(joined);
    const surface = String(b.categoryBoost ?? b.id)
      .trim()
      .toLowerCase();
    if (!surface) continue;
    candidates.push({
      intent: surface,
      score: v,
      categoryBoost: b.categoryBoost,
      kind: "seed",
    });
  }

  const hfSlug = normSlug(p.hfCategory);
  if (hfSlug && hfSlug !== "unknown" && hfSlug !== "misc") {
    const lab = String(p.hfCategory ?? "").trim().toLowerCase();
    let sc = 0.18;
    if (joined.includes(hfSlug.replace(/_/g, " "))) sc += 0.14;
    candidates.push({ intent: lab || hfSlug, score: Math.min(1, sc), categoryBoost: p.hfCategory, kind: "hf_surface" });
  }

  const coherent = stripGenericLabels(p.hfLabels ?? []);
  for (const lab of coherent) {
    const slug = normSlug(lab);
    if (slug.length < 2 || slug.length > 40) continue;
    const intentStr = String(lab).trim().toLowerCase();
    let sc = 0.11;
    if (joined.includes(slug) || joined.includes(intentStr)) sc += 0.17;
    candidates.push({
      intent: intentStr,
      score: Math.min(1, sc),
      categoryBoost: null,
      kind: "label_surface",
    });
  }

  hist.forEach((h, i) => {
    const slug = normSlug(h);
    if (!slug) return;
    candidates.push({
      intent: `intent_context_${slug}`,
      score: Number((0.12 + (hist.length - Math.min(i, hist.length - 1)) * 0.034).toFixed(4)),
      categoryBoost: h,
      kind: "learned_history",
    });
  });

  const gp = p.groupPrior;
  if (gp != null && gp.groupConsensusCategory) {
    const gk = normCatKey(gp.groupConsensusCategory);
    for (const c of candidates) {
      const boostCat = normCatKey(c.categoryBoost ?? "");
      const intentK = normSlug(c.intent);
      if (boostCat === gk || intentK.includes(gk.replace(/\s+/g, "_"))) {
        c.score = Number(Math.min(1, c.score + 0.11 * gp.groupConfidence).toFixed(4));
      }
    }
  }

  /** @type {Map<string, { intent: string, score: number, categoryBoost: string | null, kind: string }>} */
  const merged = new Map();
  for (const c of candidates) {
    const key = normSlug(c.intent) || c.intent;
    const prev = merged.get(key);
    if (!prev || c.score > prev.score) merged.set(key, { ...c, intent: c.intent });
  }
  const ranked = [...merged.values()].sort((a, b) => b.score - a.score || a.intent.localeCompare(b.intent));

  const top = ranked[0];
  const second = ranked[1];
  const conflict =
    top != null &&
    second != null &&
    top.score - second.score < 0.12 &&
    top.score > 0 &&
    second.score > 0.18;

  const supportingTokens = tokens.filter((t) => joined.includes(t)).length;
  const themeStrength = themes.length === 0 ? 0 : Math.min(1, themes.length / 4);
  const groupFactor = p.groupId != null && p.peers != null ? peerCategoryCohesion(p.peers, p.hfCategory) : 0.58;
  const topScore = top?.score ?? 0;

  let intentConfidence = Math.min(
    1,
    topScore * (0.52 + 0.22 * Math.min(1, supportingTokens / 5) + 0.18 * themeStrength) * (0.42 + 0.58 * groupFactor),
  );
  if (conflict) intentConfidence *= 0.64;

  const strong = intentConfidence >= 0.56 && topScore >= 0.34;
  const slug = normSlug(p.refinedCategory === "review" ? p.hfCategory : p.refinedCategory) || "unknown";

  if (!strong || !top) {
    const fbConf = Number(Math.min(1, 0.28 + 0.35 * themeStrength + 0.22 * Math.min(1, supportingTokens / 6)).toFixed(4));
    return {
      inferredIntent: `intent_category_${slug}`,
      intentConfidence: fbConf,
      categoryBoost: null,
      intentCandidates: ranked.slice(0, 14),
      intentSource: "fallback",
      signalAgreement,
    };
  }

  let intentSource = "inferred";
  if (top.kind === "learned_history") intentSource = "learned";

  return {
    inferredIntent: top.intent,
    intentConfidence: Number(intentConfidence.toFixed(4)),
    categoryBoost: top.categoryBoost,
    intentCandidates: ranked.slice(0, 14),
    intentSource,
    signalAgreement,
  };
}

/**
 * Unify group-level refinedCategory and naming; record cross-batch pattern (single pass, in-place).
 * @param {unknown[]} items
 * @returns {void}
 */
export function finalizeGroupClairaResults(items) {
  if (!Array.isArray(items) || items.length < 2) return;
  /** @type {Map<string, Record<string, unknown>[]>} */
  const byGroup = new Map();
  for (const it of items) {
    if (it == null || typeof it !== "object" || Array.isArray(it)) continue;
    const gid = /** @type {{ groupId?: unknown }} */ (it).groupId;
    if (gid == null || String(gid).trim() === "") continue;
    const k = String(gid);
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(/** @type {Record<string, unknown>} */ (it));
  }

  for (const [gid, rows] of byGroup) {
    if (rows.length < 2) continue;
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const r of rows) {
      const c = String(r.refinedCategory ?? "")
        .trim()
        .toLowerCase();
      if (!c || c === "review") continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const catPriority = (c) => {
      const order = ["video game asset", "ui element", "photograph", "document", "misc", "unknown"];
      const i = order.indexOf(c);
      return i === -1 ? 99 : i;
    };
    const sortedCounts = [...counts.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return catPriority(a[0]) - catPriority(b[0]);
    });
    const winner = sortedCounts[0]?.[0] ?? "";
    if (!winner) continue;

    const preCats = rows.map((r) => String(/** @type {{ refinedCategory?: unknown }} */ (r).refinedCategory ?? "").trim().toLowerCase());
    const hadCategoryConflict = preCats.some((c) => c && c !== winner.toLowerCase());

    const first = rows[0];
    const cr =
      first.clairaReasoning != null && typeof first.clairaReasoning === "object" && !Array.isArray(first.clairaReasoning)
        ? /** @type {Record<string, unknown>} */ (first.clairaReasoning)
        : {};
    const grpObj = cr.group != null && typeof cr.group === "object" && !Array.isArray(cr.group) ? cr.group : {};
    const seqBase =
      typeof /** @type {{ sequenceBase?: unknown }} */ (grpObj).sequenceBase === "string" &&
      String(/** @type {{ sequenceBase?: string }} */ (grpObj).sequenceBase).trim()
        ? String(/** @type {{ sequenceBase?: string }} */ (grpObj).sequenceBase).trim()
        : stemOnly(String(first.sourceRef ?? ""));
    const intentSlug = normSlug(String(first.inferredIntent ?? "group")).slice(0, 28) || "group";
    const themes = Array.isArray(cr.labelThemes) ? cr.labelThemes.map((x) => String(x)) : [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const ref = String(row.sourceRef ?? "");
      const ext = extOnly(ref) || ".png";
      const aid = String(row.assetId ?? "").replace(/\W/g, "").slice(-6) || String(i).padStart(2, "0");
      row.refinedCategory = winner;
      row.reviewRecommended = false;
      row.groupDecisionApplied = hadCategoryConflict;
      row.suggestedName = `${normSlug(seqBase)}_${intentSlug}_frame_${String(i + 1).padStart(2, "0")}_claira_${aid}${ext}`;
      const prevCr =
        row.clairaReasoning != null && typeof row.clairaReasoning === "object" && !Array.isArray(row.clairaReasoning)
          ? /** @type {Record<string, unknown>} */ (row.clairaReasoning)
          : {};
      row.clairaReasoning = {
        ...prevCr,
        phase: 16,
        groupDecision: {
          applied: true,
          categoryOverride: hadCategoryConflict,
          groupId: gid,
          unifiedCategory: winner,
        },
      };
      row.reasoningNotes = `${String(row.reasoningNotes ?? "")} · group decision unified`.replace(/^ · /, "").trim();
    }

    const gType =
      typeof /** @type {{ type?: unknown }} */ (grpObj).type === "string" && String(/** @type {{ type?: string }} */ (grpObj).type).trim()
        ? String(/** @type {{ type?: string }} */ (grpObj).type).trim()
        : null;
    recordGroupPattern({
      groupSignature: gid,
      dominantCategory: winner,
      semanticTokens: Array.isArray(cr.semanticTokens) ? cr.semanticTokens.map((x) => String(x)) : [],
      labelThemes: themes,
      groupType: gType,
    });
  }
}

/**
 * Default heuristic "reasoning" — deterministic, no network; refines names and can override Review when HF is strong.
 * @param {ClairaReasoningInput} input
 * @returns {ClairaReasoningResult}
 */
export function defaultWorkflowClairaReasoning(input) {
  const assetId = String(input.assetId ?? "");
  const sourceRef = String(input.sourceRef ?? "");
  const an = input.analysis;
  const hfCat = an != null ? String(an.category ?? "unknown") : "unknown";
  const labels = an != null && Array.isArray(an.labels) ? an.labels.map((x) => String(x)) : [];
  const conf = an != null && typeof an.confidence === "number" && Number.isFinite(an.confidence) ? an.confidence : null;

  const myEmb = getEmbeddings(an);

  const bc = input.batchContext;
  const { maxSim: batchMaxSim, coherentPeers } = batchEmbeddingStats(bc, assetId, myEmb);
  const folderSeg = folderSegmentsFromRef(sourceRef, bc?.cwd);

  const val = input.validation;
  const vs = val != null ? String(/** @type {{ validationStatus?: unknown }} */ (val).validationStatus ?? "") : "";
  const vAdj =
    val != null && typeof /** @type {{ adjustedConfidence?: unknown }} */ (val).adjustedConfidence === "number"
      ? /** @type {{ adjustedConfidence?: number }} */ (val).adjustedConfidence
      : null;
  const valSuggested =
    val != null && typeof /** @type {{ suggestedName?: unknown }} */ (val).suggestedName === "string"
      ? String(/** @type {{ suggestedName?: string }} */ (val).suggestedName)
      : "asset_01.png";
  const finalCat =
    val != null && typeof /** @type {{ finalCategory?: unknown }} */ (val).finalCategory === "string"
      ? String(/** @type {{ finalCategory?: unknown }} */ (val).finalCategory)
      : hfCat;
  const reviewOverride =
    val != null && /** @type {{ reviewOverride?: unknown }} */ (val).reviewOverride === true;
  const reviewFromVal = val != null && (reviewOverride || vs === "low" || finalCat === "review");

  const filename = basenameOnly(sourceRef);
  const extFromRef = extOnly(filename) || extOnly(sourceRef) || ".png";
  const stemForTokens = filename.includes(".") ? filename.slice(0, filename.lastIndexOf(".")) : filename;
  const seqParsed = parseSequenceStem(stemForTokens);

  const learned = findLearningMatch({ filename });
  const learnedStrong = learned != null && learned.strength === "strong";

  const dominantHistory = getDominantFeedbackCategories({ limit: 5 });

  const groupInfo = detectGroup(bc, assetId, sourceRef, hfCat, labels, myEmb);
  const groupPrior = computeGroupPrior(bc, groupInfo.groupId, hfCat);

  let reviewRecommended = reviewFromVal;
  let refinedCategory = finalCat !== "review" ? finalCat : hfCat;
  const notes = [];

  const { themes, inferredCategory } = interpretLabels(labels, hfCat, stemForTokens);
  if (inferredCategory && !/review/i.test(finalCat)) {
    refinedCategory = inferredCategory;
    notes.push(`inferred theme → ${inferredCategory}`);
  }

  const { subcategory: hierarchySub, pathHint: hierarchyPathHint } = hierarchyHints(
    refinedCategory,
    labels,
    folderSeg,
    stemForTokens,
  );
  if (hierarchyPathHint) notes.push(`hierarchy: ${hierarchyPathHint}`);

  const ambiguousHf =
    /^(misc|unknown)$/i.test(hfCat) || labels.some((l) => /unclassified|unknown/i.test(String(l)));

  const fnToks = tokenizeFilenameStem(stemForTokens);
  const labelToks = labelsToSemanticTokens(labels);
  const semanticTokensEarly = [...new Set([...fnToks, ...labelToks])].slice(0, 12);

  const feedbackStrengthCtx = learnedStrong ? 1 : learned != null ? 0.52 : 0;
  const signalAgreementCtx =
    bc != null && Array.isArray(bc.peers) && bc.peers.length > 0 ? peerCategoryCohesion(bc.peers, hfCat) : 0.58;
  const contextFactor = computeContextFactor({
    groupStrength: groupPrior.groupConfidence,
    feedbackStrength: feedbackStrengthCtx,
    signalAgreement: signalAgreementCtx,
  });
  const effectiveCosineThreshold = Number(Math.min(0.92, Math.max(0.72, 0.82 * contextFactor)).toFixed(4));

  const semanticMem = findSemanticMemoryMatch({
    semanticTokens: semanticTokensEarly,
    labelThemes: themes,
    embedding: myEmb,
    cosineThreshold: effectiveCosineThreshold,
  });
  const groupPat = findGroupPatternMatch({
    semanticTokens: semanticTokensEarly,
    labelThemes: themes,
    embedding: myEmb,
    groupType: groupInfo.groupType,
  });

  if (!learnedStrong && semanticMem != null && semanticMem.strength === "strong" && ambiguousHf) {
    refinedCategory = semanticMem.userCorrectedCategory;
    notes.push(`semantic memory (${semanticMem.semanticMatchScore.toFixed(2)}) → ${semanticMem.userCorrectedCategory}`);
  } else if (groupPat != null && ambiguousHf) {
    const pm = groupPat.patternMatchScore ?? groupPat.patternScore;
    notes.push(
      `cross-batch group pattern prior: ${groupPat.dominantCategory} (patternMatchScore ${pm.toFixed(2)}; no auto-route)`,
    );
  }

  const intentOut = inferIntentMultiSignal({
    themes,
    semanticTokens: semanticTokensEarly,
    hierarchyPathHint,
    folderSeg,
    dominantHistory,
    groupType: groupInfo.groupType,
    groupId: groupInfo.groupId,
    peers: bc?.peers,
    hfCategory: hfCat,
    refinedCategory,
    hfLabels: labels,
    groupPrior,
  });

  if (intentOut.categoryBoost && intentOut.intentConfidence >= 0.76 && ambiguousHf) {
    refinedCategory = intentOut.categoryBoost;
    notes.push(`intent ${intentOut.inferredIntent} (${intentOut.intentConfidence.toFixed(2)})`);
  }

  const semanticMatchScore =
    semanticMem != null
      ? semanticMem.semanticMatchScore
      : computeSemanticMatchScoreIntrinsic({
          semanticTokens: semanticTokensEarly,
          labelThemes: themes,
          embedding: myEmb,
        });

  const coherentNonGeneric = stripGenericLabels(labels);
  const labelCoherence = coherentNonGeneric.length >= 2;

  const strongHf =
    !ambiguousHf &&
    conf != null &&
    conf >= 0.88 &&
    labels.some((l) =>
      /document|photograph|photo|ui element|video game|game|sprite|character|invoice|receipt/i.test(String(l)),
    );

  const strongHfMulti =
    !ambiguousHf &&
    conf != null &&
    conf >= 0.85 &&
    labelCoherence &&
    coherentNonGeneric.every((l) => !/unclassified|unknown/i.test(l));

  const strongHfExpanded = strongHf || strongHfMulti;

  const batchCoherent =
    bc != null &&
    bc.batchAssetCount >= 2 &&
    batchMaxSim != null &&
    batchMaxSim >= 0.88 &&
    coherentPeers >= 1;

  if (reviewFromVal && strongHfExpanded) {
    refinedCategory = inferredCategory ?? hfCat;
    reviewRecommended = false;
    notes.push("Claira: strong HF + label coherence — lifted filename-only Review");
  } else if (reviewFromVal && learnedStrong && learned != null && !reviewOverride) {
    refinedCategory = learned.userCorrectedCategory;
    reviewRecommended = false;
    notes.push(`Claira: learned correction ×${learned.matchCount} — reduced Review`);
  } else if (reviewFromVal && batchCoherent && !reviewOverride && !ambiguousHf) {
    refinedCategory = inferredCategory ?? hfCat;
    reviewRecommended = false;
    notes.push("Claira: batch embedding coherence — reduced Review");
  } else if (
    reviewFromVal &&
    !reviewOverride &&
    ambiguousHf &&
    (semanticMem?.strength === "strong" || groupPat != null || intentOut.intentConfidence >= 0.8) &&
    refinedCategory !== "review" &&
    !/^(misc|unknown)$/i.test(refinedCategory)
  ) {
    reviewRecommended = false;
    notes.push("Claira: semantic memory / intent / group pattern — reduced Review");
  } else if (reviewFromVal) {
    refinedCategory = "review";
    notes.push("Claira: validation Review retained");
  } else {
    notes.push("Claira: aligned with validation + HF");
  }

  const perceptionConfidence = Math.min(1, conf ?? 0.42);
  const validationConfidence = Math.min(
    1,
    vAdj != null ? vAdj : vs === "high" ? 0.9 : vs === "low" ? 0.34 : 0.62,
  );
  let reasoningChannel = Math.min(1, 0.46 + (labelCoherence ? 0.18 : 0) + (hierarchyPathHint ? 0.12 : 0));
  if (
    intentOut.categoryBoost != null &&
    normCatKey(intentOut.categoryBoost) === normCatKey(refinedCategory) &&
    intentOut.intentConfidence >= 0.58
  ) {
    reasoningChannel = Math.min(1, reasoningChannel + 0.14);
  }

  const learnFromFilename =
    learnedStrong && learned != null
      ? Math.min(1, 0.52 + 0.12 * Math.min(5, learned.matchCount) + (learned.strength === "strong" ? 0.26 : 0.08))
      : 0;
  const learnFromSemanticStore = semanticMem != null ? Math.min(1, 0.28 + 0.62 * (semanticMem.semanticMatchScore ?? 0)) : 0;
  const patSc = groupPat != null ? (groupPat.patternMatchScore ?? groupPat.patternScore ?? 0) : 0;
  const learnFromPattern = groupPat != null ? Math.min(1, 0.22 + 0.78 * patSc) : 0;
  let learningConfidence = Number(Math.min(1, learnFromFilename + learnFromSemanticStore * 0.55 + learnFromPattern * 0.35).toFixed(4));

  const maxPeers = bc?.peers?.length ?? 0;
  const peerCohesionRatio = maxPeers > 0 ? Math.min(1, coherentPeers / maxPeers) : 0;
  const groupConfidence = Number(
    Math.min(
      1,
      (groupInfo.groupId != null ? 0.46 : 0.3) +
        (batchMaxSim != null ? batchMaxSim * 0.34 : 0) +
        0.2 * peerCohesionRatio,
    ).toFixed(4),
  );

  const peerCohForHooks = bc != null && Array.isArray(bc.peers) && bc.peers.length > 0 ? peerCategoryCohesion(bc.peers, hfCat) : 0.55;
  const feedbackStrengthHooks = Math.min(
    1,
    (learnedStrong ? 0.55 : 0) + (learned != null ? 0.22 : 0) + (semanticMem?.strength === "strong" ? 0.35 : semanticMem != null ? 0.12 : 0),
  );
  const groupCohesionHooks = Number(Math.min(1, 0.48 * peerCohForHooks + 0.52 * groupPrior.groupConfidence).toFixed(4));

  let reasoningConfidence = weightedConfidenceAdaptive(
    {
      perceptionConfidence,
      validationConfidence,
      reasoningConfidence: reasoningChannel,
      learningConfidence,
      groupConfidence,
    },
    { feedbackStrength: feedbackStrengthHooks, groupCohesionStrength: groupCohesionHooks },
  );

  if (learnedStrong && learned != null) {
    const bonus = 0.06 + Math.min(0.05, Math.max(0, (learned.matchCount - 2) * 0.012));
    reasoningConfidence = Math.min(1, reasoningConfidence + bonus);
    notes.push(`feedback history: strong match (weight +${bonus.toFixed(2)})`);
  }

  if (labelCoherence && !reviewRecommended) {
    reasoningConfidence = Math.min(1, reasoningConfidence + 0.02);
  }

  if (batchMaxSim != null && batchMaxSim >= 0.85) {
    reasoningConfidence = Math.min(1, reasoningConfidence + 0.03);
  }

  if (groupInfo.groupId != null) {
    reasoningConfidence = Math.min(1, reasoningConfidence + 0.02);
  }

  if (themes.length > 0) {
    notes.push(`label themes: ${themes.join(", ")}`);
  }

  if (reviewRecommended) {
    reasoningConfidence = Math.min(
      1,
      weightedConfidenceAdaptive(
        {
          perceptionConfidence,
          validationConfidence,
          reasoningConfidence: reasoningChannel * 0.85,
          learningConfidence: learningConfidence * 0.9,
          groupConfidence: groupConfidence * 0.88,
        },
        { feedbackStrength: feedbackStrengthHooks * 0.92, groupCohesionStrength: groupCohesionHooks * 0.9 },
      ) * 0.96,
    );
  }

  const confidenceBreakdown = {
    perceptionConfidence,
    validationConfidence,
    reasoningConfidence: reasoningChannel,
    learningConfidence,
    groupConfidence,
  };

  const confidenceAdjustment =
    conf != null && reasoningConfidence != null ? reasoningConfidence - conf : null;

  const refinedSlug = normSlug(refinedCategory === "review" ? hfCat : refinedCategory) || "asset";
  const semanticStem = buildSemanticStem(refinedSlug, fnToks, labelToks, 5, {
    groupType: groupInfo.groupType,
    sequenceBase: groupInfo.sequenceBase,
    numericSuffix: seqParsed.numericSuffix,
  });
  const shortId = assetId.replace(/\W/g, "").slice(-6) || "000001";
  const ext = extFromRef || ".png";

  const suggestedName =
    semanticStem && semanticStem !== "review"
      ? `${semanticStem}_claira_${shortId}${ext}`
      : `review_${shortId}_claira${ext}`;

  const alternatives = buildAlternativeCategories({
    ambiguousHf,
    hfCat,
    inferredCategory,
    refinedCategory: reviewRecommended ? "review" : refinedCategory,
    hierarchySub,
  });

  const reasoningExplanation = [
    `Primary classification: ${reviewRecommended ? "review" : refinedCategory}.`,
    ambiguousHf ? `HF category "${hfCat}" is ambiguous; alternatives considered: ${alternatives.slice(0, 3).join(", ") || "n/a"}.` : `HF confidence path is ${conf != null ? conf.toFixed(2) : "n/a"}.`,
    batchMaxSim != null ? `Max CLIP cosine similarity vs batch peers: ${batchMaxSim.toFixed(3)}.` : "No CLIP embeddings in batch for pairwise comparison.",
    groupInfo.groupId ? `Group ${groupInfo.groupId} (${groupInfo.groupType ?? "cluster"}) with ${bc?.batchAssetCount ?? 1} asset(s) in ingest.` : "No multi-asset group lock for this file.",
    groupPrior.groupConsensusCategory
      ? `Group prior consensus: ${groupPrior.groupConsensusCategory} (confidence ${groupPrior.groupConfidence.toFixed(2)}).`
      : "",
    hierarchyPathHint ? `Folder / name context: ${hierarchyPathHint}.` : "",
    dominantHistory.length ? `Historical feedback favors: ${dominantHistory.join(", ")}.` : "",
    `Intent: ${intentOut.inferredIntent} (${intentOut.intentSource}, confidence ${intentOut.intentConfidence.toFixed(2)}).`,
    `Semantic cosine threshold (effective): ${effectiveCosineThreshold.toFixed(3)} (contextFactor ${contextFactor.toFixed(3)}).`,
    semanticMem != null
      ? `Semantic memory score vs feedback store: ${semanticMem.semanticMatchScore.toFixed(3)} (${semanticMem.strength}).`
      : `Semantic match score (intrinsic signals): ${semanticMatchScore.toFixed(3)}.`,
    groupPat != null
      ? `Cross-batch group pattern prior: ${groupPat.dominantCategory} (patternMatchScore ${(groupPat.patternMatchScore ?? groupPat.patternScore).toFixed(3)}).`
      : "No cross-batch group pattern hit.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    refinedCategory: reviewRecommended ? "review" : refinedCategory,
    reasoningConfidence,
    confidenceAdjustment,
    reasoningNotes: notes.filter(Boolean).join(" · ") || "Claira reasoning",
    reviewRecommended,
    suggestedName: suggestedName || valSuggested,
    semanticSimilarityScore: batchMaxSim,
    semanticMatchScore,
    groupId: groupInfo.groupId,
    groupType: groupInfo.groupType,
    alternativeCategories: alternatives,
    reasoningExplanation,
    inferredIntent: intentOut.inferredIntent,
    intentConfidence: intentOut.intentConfidence,
    intentCandidates: intentOut.intentCandidates,
    intentSource: intentOut.intentSource,
    groupPrior,
    effectiveThresholds: { cosineSemantic: effectiveCosineThreshold, contextFactor },
    adaptiveWeights: { feedbackStrength: feedbackStrengthHooks, groupCohesionStrength: groupCohesionHooks },
    groupDecisionApplied: false,
    confidenceBreakdown,
    clairaReasoning: {
      provider: "default_workflow_claira",
      phase: 16,
      filename,
      hfLabels: labels,
      labelThemes: themes,
      semanticTokens: semanticStem.split("_").filter(Boolean),
      validationStatus: vs || null,
      feedbackLearning: learned
        ? { strength: learned.strength, matchCount: learned.matchCount, applied: learnedStrong }
        : null,
      semanticMemory: semanticMem,
      semanticMatchScore,
      groupPatternMatch: groupPat,
      groupPrior,
      effectiveThresholds: { cosineSemantic: effectiveCosineThreshold, contextFactor },
      adaptiveWeights: { feedbackStrength: feedbackStrengthHooks, groupCohesionStrength: groupCohesionHooks },
      intent: {
        id: intentOut.inferredIntent,
        confidence: intentOut.intentConfidence,
        candidates: intentOut.intentCandidates,
        source: intentOut.intentSource,
        signalAgreement: intentOut.signalAgreement,
      },
      confidenceBreakdown,
      hierarchySubcategory: hierarchySub,
      hierarchyHint: hierarchyPathHint,
      folderContext: folderSeg.slice(-3),
      dominantFeedbackCategories: dominantHistory,
      batchEmbedding: {
        maxPeerSimilarity: batchMaxSim,
        coherentPeerCount: coherentPeers,
        batchSize: bc?.batchAssetCount ?? 1,
      },
      clipEmbeddingsPresent: myEmb != null,
      group: groupInfo.groupId
        ? { id: groupInfo.groupId, type: groupInfo.groupType, sequenceBase: groupInfo.sequenceBase }
        : null,
      destinationRoot: bc?.destinationRoot ?? null,
    },
    active: true,
  };
}

/**
 * @param {string} s
 */
function normSlug(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

/**
 * @param {ClairaReasoningInput} input
 * @returns {Promise<ClairaReasoningResult>}
 */
export async function tryClairaReasoning(input) {
  const p = registered ?? {
    id: "default_workflow_claira",
    refineReasoning: defaultWorkflowClairaReasoning,
  };
  try {
    const out = await p.refineReasoning(input);
    if (out == null || typeof out !== "object") {
      return inactiveResult(input);
    }
    return /** @type {ClairaReasoningResult} */ ({
      ...out,
      active: out.active !== false,
    });
  } catch {
    return inactiveResult(input);
  }
}

/**
 * @param {ClairaReasoningInput} input
 * @returns {ClairaReasoningResult}
 */
function inactiveResult(input) {
  const val = input.validation;
  const hfCat = input.analysis != null ? String(input.analysis.category ?? "unknown") : "unknown";
  const suggested =
    val != null && typeof /** @type {{ suggestedName?: unknown }} */ (val).suggestedName === "string"
      ? String(/** @type {{ suggestedName?: string }} */ (val).suggestedName)
      : "asset_01.png";
  return {
    refinedCategory: hfCat,
    reasoningConfidence: null,
    confidenceAdjustment: null,
    reasoningNotes: "Claira reasoning unavailable — using validation / HF only",
    reviewRecommended:
      val != null &&
      (/** @type {{ reviewOverride?: unknown }} */ (val).reviewOverride === true ||
        String(/** @type {{ validationStatus?: unknown }} */ (val).validationStatus ?? "") === "low"),
    suggestedName: suggested,
    clairaReasoning: { skipped: true },
    active: false,
    semanticSimilarityScore: null,
    semanticMatchScore: null,
    groupId: null,
    groupType: null,
    alternativeCategories: [],
    reasoningExplanation: "Claira reasoning provider did not run; using classifier and validation only.",
    inferredIntent: `intent_category_${normSlug(hfCat) || "unknown"}`,
    intentConfidence: 0,
    intentCandidates: [],
    intentSource: "fallback",
    groupPrior: null,
    effectiveThresholds: { cosineSemantic: 0.82, contextFactor: 1 },
    adaptiveWeights: { feedbackStrength: 0, groupCohesionStrength: 0 },
    groupDecisionApplied: false,
    confidenceBreakdown: {
      perceptionConfidence: 0,
      validationConfidence: 0,
      reasoningConfidence: 0,
      learningConfidence: 0,
      groupConfidence: 0,
    },
  };
}

/**
 * Read-only view model for Claira reasoning (Phase 19 UI).
 * Supports pipeline rows from Phase 10 (`moduleResults.claira_reasoning.data.items[]`)
 * and any future flat embedding on the row.
 *
 * @param {unknown} pipelineRow
 * @returns {{
 *   assetLabel: string,
 *   hasPayload: boolean,
 *   refinedCategory: string | null,
 *   reasoningConfidence: number | null,
 *   signalAgreementScore: number | null,
 *   signalConflictLevel: string | null,
 *   signalState: string | null,
 *   effectiveThreshold: number | null,
 *   memoryInfluenceScore: number | null,
 *   weightTier: string | null,
 *   historicalConfidence: number | null,
 *   usageCount: number | null,
 *   successRate: number | null,
 *   intentCandidates: { label: string, score?: number | null }[],
 *   intentCanonical: string | null,
 *   alternativeCategoriesDetailed: unknown[],
 * }}
 */
export function buildReasoningViewModel(pipelineRow) {
  const r =
    pipelineRow != null && typeof pipelineRow === "object" && !Array.isArray(pipelineRow)
      ? /** @type {Record<string, unknown>} */ (pipelineRow)
      : /** @type {Record<string, unknown>} */ ({});

  const mrRaw = r.moduleResults ?? r.module_results;
  const mr = mrRaw != null && typeof mrRaw === "object" && !Array.isArray(mrRaw) ? /** @type {Record<string, unknown>} */ (mrRaw) : null;
  const crMod = mr?.claira_reasoning;
  const crBox = crMod != null && typeof crMod === "object" && !Array.isArray(crMod) ? /** @type {Record<string, unknown>} */ (crMod) : null;
  const data = crBox?.data != null && typeof crBox.data === "object" && !Array.isArray(crBox.data) ? /** @type {Record<string, unknown>} */ (crBox.data) : null;
  const items = data && Array.isArray(data.items) ? data.items : [];
  const item0 = items[0] != null && typeof items[0] === "object" && !Array.isArray(items[0]) ? /** @type {Record<string, unknown>} */ (items[0]) : /** @type {Record<string, unknown>} */ ({});

  const nestedRaw = item0.clairaReasoning ?? r.clairaReasoning;
  const nested =
    nestedRaw != null && typeof nestedRaw === "object" && !Array.isArray(nestedRaw)
      ? /** @type {Record<string, unknown>} */ (nestedRaw)
      : /** @type {Record<string, unknown>} */ ({});

  const assetLabel = String(r.rel ?? r.filePath ?? "").trim() || "(unknown asset)";

  const refinedCategory =
    pickStr(item0.refinedCategory) ?? pickStr(r.refinedCategory) ?? pickStr(nested.refinedCategory);

  const hasPayload = items.length > 0;

  return {
    assetLabel,
    hasPayload,
    refinedCategory,
    reasoningConfidence: pickNum(item0.reasoningConfidence, r.reasoningConfidence),
    signalAgreementScore: pickNum(item0.signalAgreementScore),
    signalConflictLevel: pickStr(item0.signalConflictLevel),
    signalState: pickStr(item0.signalState, nested.signalState),
    effectiveThreshold: pickNum(item0.effectiveThreshold),
    memoryInfluenceScore: pickNum(item0.memoryInfluenceScore, nested.memoryInfluenceScore),
    weightTier: pickStr(item0.weightTier, nested.weightTier),
    historicalConfidence: pickNum(item0.historicalConfidence, nested.historicalConfidence),
    usageCount: pickNum(item0.usageCount, nested.usageCount),
    successRate: pickNum(item0.successRate, nested.successRate),
    intentCandidates: normalizeIntentCandidates(item0.intentCandidates ?? nested.intentCandidates, 5),
    intentCanonical: pickStr(item0.intentCanonical, nested.intentCanonical),
    alternativeCategoriesDetailed: normalizeAlternatives(item0.alternativeCategoriesDetailed ?? nested.alternativeCategoriesDetailed),
  };
}

/** @param {unknown} v */
function pickStr(...candidates) {
  for (const v of candidates) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

/** @param {...unknown} candidates */
function pickNum(...candidates) {
  for (const v of candidates) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** @param {unknown} raw @param {number} max */
function normalizeIntentCandidates(raw, max) {
  if (!Array.isArray(raw)) return [];
  /** @type {{ label: string, score?: number | null }[]} */
  const out = [];
  for (const x of raw) {
    if (out.length >= max) break;
    if (typeof x === "string") {
      const t = x.trim();
      if (t) out.push({ label: t });
      continue;
    }
    if (x != null && typeof x === "object" && !Array.isArray(x)) {
      const o = /** @type {Record<string, unknown>} */ (x);
      const label =
        pickStr(o.label, o.intent, o.name, o.id) ??
        (typeof o.slug === "string" ? o.slug : null);
      if (label) {
        const score = pickNum(o.score, o.confidence);
        out.push(score != null ? { label, score } : { label });
      }
    }
  }
  return out;
}

/** @param {unknown} raw */
function normalizeAlternatives(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12);
}

/**
 * @param {unknown} pipelineRow
 */
export function pipelineRowFilename(pipelineRow) {
  const r =
    pipelineRow != null && typeof pipelineRow === "object" && !Array.isArray(pipelineRow)
      ? /** @type {Record<string, unknown>} */ (pipelineRow)
      : null;
  if (!r) return "unknown";
  if (typeof r.rel === "string" && r.rel.trim()) return r.rel.trim();
  const fp = typeof r.filePath === "string" ? r.filePath : "";
  if (fp.trim()) {
    const s = fp.replace(/\\/g, "/");
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1).trim() || s : s;
  }
  return "unknown";
}

/**
 * Build unique category options from refined + alternativeCategoriesDetailed (UI override).
 *
 * @param {ReturnType<typeof buildReasoningViewModel>} vm
 * @returns {{ suggested: string | null, choices: { value: string, source: "refined" | "alternative" }[] }}
 */
export function extractCategoryChoices(vm) {
  const suggested = vm.refinedCategory != null && String(vm.refinedCategory).trim() ? String(vm.refinedCategory).trim() : null;
  /** @type {{ value: string, source: "refined" | "alternative" }[]} */
  const choices = [];
  const seen = new Set();
  /**
   * @param {string} val
   * @param {"refined" | "alternative"} source
   */
  const push = (val, source) => {
    const v = String(val ?? "").trim();
    if (!v) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    choices.push({ value: v, source });
  };
  if (suggested) push(suggested, "refined");
  for (const alt of vm.alternativeCategoriesDetailed) {
    if (alt != null && typeof alt === "object" && !Array.isArray(alt)) {
      const o = /** @type {Record<string, unknown>} */ (alt);
      const c = o.category ?? o.refinedCategory ?? o.label;
      if (c != null) push(String(c), "alternative");
    } else if (typeof alt === "string") {
      push(alt, "alternative");
    }
  }
  return { suggested, choices };
}

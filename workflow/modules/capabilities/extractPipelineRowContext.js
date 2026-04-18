import { getDomainDefinition } from "./domainRegistry.js";

/**
 * Extract intent + category + paths from a pipeline result row (matches UI reasoningViewModel sources).
 * Session context supplies multi-file inputs: primaryFile, secondaryFile, fileList.
 *
 * @param {unknown} row
 * @param {string} [cwd]
 * @param {{
 *   allRows?: unknown[],
 *   rowIndex?: number,
 *   attachDomainMode?: string,
 *   attachPlanMode?: string,
 * }} [sessionContext]
 * @returns {{
 *   intentCandidates: Array<{ label: string, score?: number | null }>,
 *   refinedCategory: string | null,
 *   inputData: Record<string, unknown>,
 * }}
 */
export function extractPipelineRowContext(row, cwd = "", sessionContext = {}) {
  const r =
    row != null && typeof row === "object" && !Array.isArray(row)
      ? /** @type {Record<string, unknown>} */ (row)
      : {};

  const mrRaw = r.moduleResults ?? r.module_results;
  const mr = mrRaw != null && typeof mrRaw === "object" && !Array.isArray(mrRaw) ? /** @type {Record<string, unknown>} */ (mrRaw) : null;
  const crMod = mr?.claira_reasoning;
  const crBox = crMod != null && typeof crMod === "object" && !Array.isArray(crMod) ? /** @type {Record<string, unknown>} */ (crMod) : null;
  const data = crBox?.data != null && typeof crBox.data === "object" && !Array.isArray(crBox.data) ? /** @type {Record<string, unknown>} */ (crBox.data) : null;
  const items = data && Array.isArray(data.items) ? data.items : [];
  const item0 =
    items[0] != null && typeof items[0] === "object" && !Array.isArray(items[0])
      ? /** @type {Record<string, unknown>} */ (items[0])
      : /** @type {Record<string, unknown>} */ ({});

  const nestedRaw = r.clairaReasoning ?? r.claira_reasoning;
  const nested =
    nestedRaw != null && typeof nestedRaw === "object" && !Array.isArray(nestedRaw)
      ? /** @type {Record<string, unknown>} */ (nestedRaw)
      : {};

  const refinedCategory =
    pickStr(item0.refinedCategory, r.refinedCategory, nested.refinedCategory) ?? null;

  const rawIc = item0.intentCandidates ?? nested.intentCandidates ?? r.intentCandidates;
  /** @type {Array<{ label: string, score?: number | null }>} */
  const intentCandidates = [];
  if (Array.isArray(rawIc)) {
    for (const c of rawIc) {
      if (c != null && typeof c === "object" && !Array.isArray(c)) {
        const o = /** @type {Record<string, unknown>} */ (c);
        const label = typeof o.label === "string" ? o.label : "";
        if (label.trim()) {
          intentCandidates.push({
            label,
            score: typeof o.score === "number" && Number.isFinite(o.score) ? o.score : null,
          });
        }
      }
    }
  }

  const filePath = typeof r.filePath === "string" ? r.filePath.trim() : "";
  const rel = typeof r.rel === "string" ? r.rel.trim() : "";

  const reasoningConfidence =
    typeof item0.reasoningConfidence === "number"
      ? item0.reasoningConfidence
      : typeof r.reasoningConfidence === "number"
        ? r.reasoningConfidence
        : null;

  const allRows = Array.isArray(sessionContext.allRows) ? sessionContext.allRows : [];
  const rowIndex = typeof sessionContext.rowIndex === "number" && sessionContext.rowIndex >= 0 ? sessionContext.rowIndex : -1;

  /**
   * @param {unknown} rowObj
   */
  function pathFromRow(rowObj) {
    if (rowObj == null || typeof rowObj !== "object" || Array.isArray(rowObj)) return "";
    const o = /** @type {Record<string, unknown>} */ (rowObj);
    const fp = typeof o.filePath === "string" ? o.filePath.trim() : "";
    return fp;
  }

  const primaryFile = filePath;
  let secondaryFile = "";
  if (rowIndex >= 0 && allRows.length > rowIndex + 1) {
    secondaryFile = pathFromRow(allRows[rowIndex + 1]);
  }

  /** @type {string[]} */
  const fileList = [];
  const seen = new Set();
  for (const rowObj of allRows) {
    const p = pathFromRow(rowObj);
    if (p && !seen.has(p)) {
      seen.add(p);
      fileList.push(p);
    }
  }
  fileList.sort((a, b) => a.localeCompare(b));

  const attachDm =
    typeof sessionContext.attachDomainMode === "string" ? sessionContext.attachDomainMode.trim() : "";
  const domainMode =
    pickStr(
      typeof r.capabilityDomainMode === "string" ? r.capabilityDomainMode : null,
      typeof r.domainMode === "string" ? r.domainMode : null,
      attachDm || null,
    ) ?? "general";
  const domainDef = getDomainDefinition(domainMode);
  const attachPlan =
    typeof sessionContext.attachPlanMode === "string" ? sessionContext.attachPlanMode.trim() : "";
  const capabilityPlanModeStored =
    typeof r.capabilityPlanMode === "string" ? r.capabilityPlanMode.trim() : attachPlan || "single";

  return {
    intentCandidates,
    refinedCategory,
    inputData: {
      cwd: cwd || process.cwd(),
      primaryFile,
      secondaryFile,
      fileList,
      sourcePath: filePath,
      pathA: primaryFile,
      pathB: secondaryFile,
      relPath: rel,
      reasoningConfidence,
      domainMode,
      capabilityPlanMode: capabilityPlanModeStored,
      domainTagHints: Array.isArray(domainDef.tagHints) ? [...domainDef.tagHints] : [],
      rowSnapshot: {
        rel,
        refinedCategory,
      },
    },
  };
}

/** @param {...unknown} candidates */
function pickStr(...candidates) {
  for (const v of candidates) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

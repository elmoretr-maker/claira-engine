/**
 * Domain refinement data for pack templates (generator only; not classifier).
 * Persists merged boosts in templates/<slug>.repair-layer.json and merges at load time.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const MAX_REPAIR_ITERS = 5;

/**
 * @param {string} slug
 */
function repairJsonPath(slug) {
  return join(ROOT, "templates", `${slug}.repair-layer.json`);
}

/**
 * @param {string} slug
 */
function templateJsPath(slug) {
  return join(ROOT, "templates", `${slug}.js`);
}

/**
 * @param {string} slug
 */
export function loadRepairLayerJson(slug) {
  const p = repairJsonPath(slug);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    return j;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string[]>}
 */
function normalizeBoostMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) {
      out[k] = v.map((x) => String(x).trim()).filter(Boolean);
    }
  }
  return out;
}

/**
 * @param {string[]} arr
 */
function uniqLower(arr) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const s of arr) {
    const t = String(s).trim();
    if (!t) continue;
    const low = t.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(t);
  }
  return out;
}

/**
 * @param {string} slug
 */
function inferFlavor(slug) {
  const s = String(slug ?? "").toLowerCase();
  if (/med|health|clinic|patient|vet|dental|pharm|clinical/.test(s)) return "medical";
  if (/shop|store|commerce|retail|catalog|sku|merchant/.test(s)) return "ecommerce";
  if (/game|dev|asset|studio|sprite|texture/.test(s)) return "gamedev";
  if (/real|estate|property|realt|lease/.test(s)) return "realestate";
  if (/bank|financ|insur|invoice|ledger|tax|payment|fintech/.test(s)) return "financial";
  return "general";
}

/**
 * @param {string} catKey
 * @param {string} label
 * @param {string[]} structureWords
 * @param {string} flavor
 * @param {Set<string>} issueCodes
 */
function proposeKeywordBoosts(catKey, label, structureWords, flavor, issueCodes) {
  const unders = catKey.replace(/_/g, " ");
  const labelLow = label.toLowerCase();
  /** @type {string[]} */
  const out = [];
  const topKw = structureWords.slice(0, 8).map((w) => String(w).trim().toLowerCase()).filter(Boolean);
  for (const w of topKw) {
    out.push(`${w} ${labelLow}`, `${labelLow} ${w}`, `${w} ${unders}`, `${unders} ${w}`);
  }
  if (issueCodes.has("expected_elements") || issueCodes.has("weak_patterns")) {
    if (flavor === "medical") {
      out.push(
        `clinical ${unders}`,
        `encounter ${unders}`,
        `phi minimum necessary ${unders}`,
        `signed ${labelLow}`,
        `dated ${labelLow}`,
      );
    } else if (flavor === "ecommerce") {
      out.push(`sku ${unders}`, `variant ${unders}`, `listing quality ${unders}`, `merchant ${unders}`);
    } else if (flavor === "financial") {
      out.push(`ledger ${unders}`, `reconciliation ${unders}`, `audit trail ${unders}`, `payer ${unders}`);
    } else {
      out.push(`operational ${unders}`, `workflow ${unders}`, `controlled ${labelLow}`, `record retention ${unders}`);
    }
  }
  return uniqLower(out);
}

/**
 * @param {string} catKey
 * @param {string} label
 * @param {string} flavor
 * @param {Set<string>} issueCodes
 */
function proposePatternExpectedBoosts(catKey, label, flavor, issueCodes) {
  if (!issueCodes.has("weak_patterns") && !issueCodes.has("expected_elements")) return [];
  const unders = catKey.replace(/_/g, " ");
  /** @type {string[]} */
  const out = [];
  if (flavor === "medical") {
    out.push(
      `Category-specific clinical or administrative markers for “${label}” (encounter, auth, or order context)`,
      `Legible provider, site, or department cues tied to ${unders}`,
    );
  } else if (flavor === "ecommerce") {
    out.push(
      `Merchandising or catalog metadata block appropriate to “${label}” (attributes, channel, or compliance text)`,
      `SKU, variant, or fulfillment identifiers when present for ${unders}`,
    );
  } else if (flavor === "financial") {
    out.push(
      `Amounts, parties, and reference numbers consistent with ${unders} financial records`,
      `Posting or settlement metadata when applicable`,
    );
  } else {
    out.push(
      `Domain-specific headings or field groups that disambiguate “${label}” from similar categories`,
      `Operational identifiers (dates, codes, or owners) expected for ${unders}`,
    );
  }
  return out;
}

/**
 * @param {string} catKey
 * @param {string} label
 * @param {string} slug
 * @param {string} flavor
 * @param {Set<string>} issueCodes
 */
function proposeProcessActionBoosts(catKey, label, slug, flavor, issueCodes) {
  if (!issueCodes.has("missing_processes") && !issueCodes.has("weak_patterns")) return [];
  const unders = catKey.replace(/_/g, " ");
  /** @type {string[]} */
  const out = [];
  if (flavor === "medical") {
    out.push(
      `For **${label}**: verify encounter linkage and minimum-necessary disclosure before routing outside the clinical trust zone.`,
    );
  } else if (flavor === "ecommerce") {
    out.push(
      `For **${label}**: confirm catalog, channel, and policy text match the active merchant ruleset for ${slug}.`,
    );
  } else if (flavor === "financial") {
    out.push(
      `For **${label}**: reconcile identifiers and totals against source systems before archival (${unders}).`,
    );
  } else {
    out.push(
      `For **${label}**: apply org-specific validation for ${unders} before automated filing in ${slug}.`,
    );
  }
  return out;
}

/**
 * @param {Record<string, string[]>} cur
 * @param {string} cat
 * @param {string[]} add
 */
function mergeBoost(cur, cat, add) {
  const prev = Array.isArray(cur[cat]) ? cur[cat] : [];
  cur[cat] = uniqLower([...prev, ...add]);
}

/**
 * @param {ReturnType<typeof buildIndustryReport>} report
 */
export function repairTargetMet(report) {
  if (!report || typeof report !== "object") return false;
  const th = /** @type {{ highMin?: number }} */ (report).thresholds;
  const highMin = th && typeof th.highMin === "number" ? th.highMin : 80;
  const score = typeof report.overallScore === "number" ? report.overallScore : 0;
  return score >= highMin;
}

/**
 * Merge coverage gaps into repair-layer.json for this pack.
 * @param {string} rawSlug
 * @param {ReturnType<typeof buildIndustryReport>} report
 */
export function refineRepairLayerFromReport(rawSlug, report) {
  const slug = String(rawSlug ?? "")
    .trim()
    .toLowerCase();
  if (!slug || !/^[a-z0-9_-]+$/.test(slug)) return;

  const packDir = join(ROOT, "packs", slug);
  const structPath = join(packDir, "structure.json");
  /** @type {Record<string, string[]>} */
  let categories = {};
  if (existsSync(structPath)) {
    try {
      const structure = JSON.parse(readFileSync(structPath, "utf8"));
      categories =
        structure?.categories && typeof structure.categories === "object" && !Array.isArray(structure.categories)
          ? structure.categories
          : {};
    } catch {
      categories = {};
    }
  }

  const existing = loadRepairLayerJson(slug) || {};
  /** @type {Record<string, string[]>} */
  let keywordBoosts = normalizeBoostMap(existing.keywordBoosts);
  /** @type {Record<string, string[]>} */
  let patternExpectedBoosts = normalizeBoostMap(existing.patternExpectedBoosts);
  /** @type {Record<string, string[]>} */
  let processActionBoosts = normalizeBoostMap(existing.processActionBoosts);

  const flavor = inferFlavor(slug);
  const cats = Array.isArray(report.categories) ? report.categories : [];

  for (const row of cats) {
    if (!row || typeof row !== "object") continue;
    const catKey = typeof row.key === "string" ? row.key : "";
    if (!catKey) continue;
    const issues = Array.isArray(row.issues) ? row.issues : [];
    /** @type {Set<string>} */
    const codes = new Set();
    for (const iss of issues) {
      if (iss && typeof iss === "object" && "code" in iss) {
        const c = String(/** @type {{ code?: string }} */ (iss).code ?? "");
        if (c) codes.add(c);
      }
    }
    if (codes.size === 0) continue;

    const words = categories[catKey];
    const structureWords = Array.isArray(words) ? words.map((w) => String(w)) : [];
    const label = catKey
      .split("_")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

    mergeBoost(
      keywordBoosts,
      catKey,
      proposeKeywordBoosts(catKey, label, structureWords, flavor, codes),
    );
    mergeBoost(
      patternExpectedBoosts,
      catKey,
      proposePatternExpectedBoosts(catKey, label, flavor, codes),
    );
    mergeBoost(
      processActionBoosts,
      catKey,
      proposeProcessActionBoosts(catKey, label, slug, flavor, codes),
    );
  }

  const payload = {
    version: typeof existing.version === "number" ? existing.version + 1 : 1,
    updatedForPack: slug,
    keywordBoosts,
    patternExpectedBoosts,
    processActionBoosts,
  };
  writeFileSync(repairJsonPath(slug), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  ensureTemplateRepairMarker(slug);
}

/**
 * One-line marker so maintainers know refinements exist.
 * @param {string} slug
 */
export function ensureTemplateRepairMarker(slug) {
  const fp = templateJsPath(slug);
  if (!existsSync(fp)) return;
  const marker = `// @claira-repair-layer: templates/${slug}.repair-layer.json (auto-maintained)`;
  let text = readFileSync(fp, "utf8");
  if (text.includes("@claira-repair-layer")) return;
  if (text.startsWith("/**")) {
    const end = text.indexOf("*/");
    if (end !== -1) {
      text = text.slice(0, end + 2) + "\n\n" + marker + "\n" + text.slice(end + 2);
      writeFileSync(fp, text, "utf8");
      return;
    }
  }
  writeFileSync(fp, `${marker}\n\n${text}`, "utf8");
}

/**
 * Merge repair-layer.json boosts into a loaded template object (generator only).
 * @param {object} template
 * @param {string} slug
 */
export function mergeTemplateWithRepairJson(template, slug) {
  if (!template || typeof template !== "object") return template;
  const repair = loadRepairLayerJson(slug);
  if (!repair) return template;

  const kw = normalizeBoostMap(repair.keywordBoosts);
  const pe = normalizeBoostMap(repair.patternExpectedBoosts);
  const pa = normalizeBoostMap(repair.processActionBoosts);

  const origHints =
    typeof template.extraKeywordHints === "function" ? template.extraKeywordHints.bind(template) : null;
  const origPat =
    typeof template.patternStructure === "function" ? template.patternStructure.bind(template) : null;
  const origPi =
    typeof template.processIntel === "function" ? template.processIntel.bind(template) : null;

  return {
    ...template,
    extraKeywordHints(catKey, label) {
      const base = origHints ? origHints(catKey, label) : [];
      const b = kw[catKey];
      return [...base, ...(Array.isArray(b) ? b : [])];
    },
    patternStructure(catKey, label, keywords) {
      const base = origPat ? origPat(catKey, label, keywords) : {};
      const boost = pe[catKey];
      if (!boost || boost.length === 0) return base;
      const ex = Array.isArray(base.expected_elements) ? [...base.expected_elements] : [];
      return { ...base, expected_elements: [...ex, ...boost] };
    },
    processIntel(catKey, label, groupId, packSlug) {
      const base = origPi ? origPi(catKey, label, groupId, packSlug) : { purpose: "", actions: [] };
      const extra = pa[catKey];
      const actions = Array.isArray(base.actions) ? [...base.actions] : [];
      if (Array.isArray(extra)) {
        for (const a of extra) {
          const s = String(a).trim();
          if (s) actions.push(s);
        }
      }
      return { ...base, actions };
    },
  };
}

export { MAX_REPAIR_ITERS };

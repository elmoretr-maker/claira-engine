/**
 * Map patterns.json checks to risk signal severity (aligned with referenceAugmentation heuristics).
 * Used when recording single-scope corrections — does not modify classification.
 */

import { readActivePackIndustry } from "../interfaces/packReference.js";
import { readReferencePatterns } from "../interfaces/referenceAssets.js";

/**
 * @param {string} textLower
 * @param {string[]} phrases
 */
function countPhraseHits(textLower, phrases) {
  let n = 0;
  for (const raw of phrases) {
    const p = String(raw ?? "").trim().toLowerCase();
    if (p.length < 2) continue;
    if (/\s/.test(p) || p.includes("-")) {
      if (textLower.includes(p)) n += 1;
    } else if (new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(textLower)) {
      n += 1;
    }
  }
  return n;
}

/**
 * @param {object} classification
 */
function classificationSignalsLower(classification) {
  const parts = [];
  if (classification.second_label) parts.push(String(classification.second_label));
  if (Array.isArray(classification.softmaxTop3)) {
    for (const x of classification.softmaxTop3) {
      if (x?.id) parts.push(String(x.id));
    }
  }
  if (Array.isArray(classification.visualCosineTop3)) {
    for (const x of classification.visualCosineTop3) {
      if (x?.id) parts.push(String(x.id));
    }
  }
  return parts.join(" ").trim().toLowerCase();
}

/**
 * @param {string} phrase
 */
function fingerprintSlug(phrase) {
  const t = String(phrase ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return t || "element";
}

/**
 * @param {{
 *   predicted_label?: string | null,
 *   extractedText?: string | null,
 *   classification?: object | null,
 * }} input
 * @returns {{
 *   severity: "high" | "medium" | "low",
 *   reason: string,
 *   fingerprint: string,
 * }}
 */
export function inferPatternMismatchDetails(input) {
  const label = String(input.predicted_label ?? "").trim();
  if (!label || label.toLowerCase() === "unknown") {
    return { severity: "medium", reason: "pattern_uncertain", fingerprint: "pattern_uncertain" };
  }

  let industry;
  try {
    industry = readActivePackIndustry();
  } catch {
    return { severity: "medium", reason: "pattern_uncertain", fingerprint: "pattern_uncertain" };
  }
  if (!industry) {
    return { severity: "medium", reason: "pattern_uncertain", fingerprint: "pattern_uncertain" };
  }

  const patternsAll = readReferencePatterns(industry);
  const pattern =
    patternsAll && typeof patternsAll[label] === "object" && patternsAll[label] != null
      ? /** @type {Record<string, unknown>} */ (patternsAll[label])
      : null;
  if (!pattern) {
    return { severity: "medium", reason: "pattern_uncertain", fingerprint: "pattern_uncertain" };
  }

  const textRaw = input.extractedText != null ? String(input.extractedText) : "";
  const textLower = textRaw.trim().toLowerCase();
  const cls = input.classification && typeof input.classification === "object" ? input.classification : null;
  const clsSig = cls ? classificationSignalsLower(cls) : "";
  const haystack = clsSig ? `${textLower} ${clsSig}` : textLower;

  const keywords = Array.isArray(pattern.keywords) ? pattern.keywords.map((k) => String(k)) : [];
  const expected = Array.isArray(pattern.expected_elements)
    ? pattern.expected_elements.map((e) => String(e))
    : [];
  const traits = Array.isArray(pattern.visual_traits) ? pattern.visual_traits.map((t) => String(t)) : [];

  if (keywords.length < 2 && expected.length === 0 && traits.length === 0) {
    return { severity: "medium", reason: "pattern_uncertain", fingerprint: "pattern_uncertain" };
  }

  const meaningfulHaystack = haystack.length > 12;
  const someText = textLower.length > 8 || clsSig.length > 8;

  const kwHits = keywords.length ? countPhraseHits(textLower, keywords) : 0;
  const exHits = expected.length ? countPhraseHits(haystack, expected) : 0;
  const traitHits = traits.length ? countPhraseHits(haystack, traits) : 0;

  if (expected.length > 0 && exHits === 0 && meaningfulHaystack) {
    const fingerprint =
      expected.length === 1
        ? `missing_expected_${fingerprintSlug(expected[0])}`
        : "missing_expected_elements";
    return {
      severity: "high",
      reason: "missing_expected_elements",
      fingerprint,
    };
  }

  if (traits.length > 0 && traitHits === 0 && someText) {
    return {
      severity: "medium",
      reason: "weak_visual_traits",
      fingerprint: "no_visual_traits",
    };
  }

  if (keywords.length >= 2 && kwHits === 0 && textLower.length > 12) {
    return {
      severity: "low",
      reason: "keyword_mismatch",
      fingerprint: "keyword_mismatch",
    };
  }

  return { severity: "medium", reason: "pattern_uncertain", fingerprint: "pattern_uncertain" };
}

/**
 * @param {{
 *   predicted_label?: string | null,
 *   extractedText?: string | null,
 *   classification?: object | null,
 * }} input
 * @returns {"high" | "medium" | "low"}
 */
export function inferPatternMismatchSeverity(input) {
  return inferPatternMismatchDetails(input).severity;
}

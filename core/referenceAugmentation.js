/**
 * Post-classification augmentation using pack reference_assets (patterns, processes, document teasers).
 * Adjusts confidence/margin before decide() — does not replace classifier output or decide() logic.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { readActivePackIndustry } from "../interfaces/packReference.js";
import { getReferenceAssets, getReferenceAssetsRoot } from "../interfaces/referenceAssets.js";

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
 * @param {string} industry
 * @param {string} label
 */
function loadReferenceDocumentTeaser(industry, label) {
  const root = getReferenceAssetsRoot(industry);
  if (!root) return "";
  const cat = String(label ?? "").trim();
  if (!cat || cat.includes("..") || /[/\\]/.test(cat)) return "";
  const docDir = join(root, "documents", cat);
  if (!existsSync(docDir)) return "";
  /** @type {string[]} */
  const chunks = [];
  try {
    const names = readdirSync(docDir);
    for (const name of names) {
      const lower = name.toLowerCase();
      if (!lower.endsWith(".txt") && !lower.endsWith(".json")) continue;
      const p = join(docDir, name);
      try {
        chunks.push(readFileSync(p, "utf8").slice(0, 900));
      } catch {
        /* ignore */
      }
    }
  } catch {
    return "";
  }
  return chunks.join("\n").toLowerCase();
}

/**
 * @param {string} ocrLower
 * @param {string} teaserLower
 */
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

function documentTeaserBoostRatio(ocrLower, teaserLower) {
  if (!ocrLower || ocrLower.length < 8 || !teaserLower || teaserLower.length < 8) return 0;
  const stop = new Set(["the", "and", "for", "with", "this", "that", "from", "are", "was", "were"]);
  const words = ocrLower.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w));
  if (words.length === 0) return 0;
  let hit = 0;
  for (const w of words) {
    if (teaserLower.includes(w)) hit += 1;
  }
  return hit / words.length;
}

/**
 * @param {object} classification
 * @param {string | null | undefined} extractedText
 * @param {{ confidence: number, margin: number }} thresholds
 * @returns {object}
 */
export function augmentClassificationWithReferenceContext(classification, extractedText, thresholds) {
  if (!classification || typeof classification !== "object") return classification;

  const label = classification.predicted_label != null ? String(classification.predicted_label).trim() : "";
  if (!label || label.toLowerCase() === "unknown") {
    return classification;
  }

  let industry;
  try {
    industry = readActivePackIndustry();
  } catch {
    return classification;
  }
  if (!industry) return classification;

  let conf =
    typeof classification.confidence === "number" && Number.isFinite(classification.confidence)
      ? classification.confidence
      : 0;
  let margin =
    typeof classification.margin === "number" && Number.isFinite(classification.margin)
      ? classification.margin
      : 0;

  /** @type {string[]} */
  const logLines = [];
  /** @type {Record<string, unknown>} */
  const reference_context = {
    applied: false,
    industry,
    label,
  };

  try {
    const ref = getReferenceAssets(industry, label);
    const pattern =
      ref.patternForCategory && typeof ref.patternForCategory === "object"
        ? /** @type {Record<string, unknown>} */ (ref.patternForCategory)
        : null;
    const procRec =
      ref.processForCategory && typeof ref.processForCategory === "object"
        ? /** @type {{ review_required?: boolean, priority?: string }} */ (ref.processForCategory)
        : null;

    if ((ref.images?.length ?? 0) + (ref.documents?.length ?? 0) > 0) {
      reference_context.has_reference_assets = true;
    }

    const textRaw = extractedText != null ? String(extractedText) : "";
    const textLower = textRaw.trim().toLowerCase();
    const clsSig = classificationSignalsLower(classification);
    const haystack = clsSig ? `${textLower} ${clsSig}` : textLower;

    const keywords = pattern && Array.isArray(pattern.keywords) ? pattern.keywords.map((k) => String(k)) : [];
    const expected =
      pattern && Array.isArray(pattern.expected_elements)
        ? pattern.expected_elements.map((e) => String(e))
        : [];
    const traits =
      pattern && Array.isArray(pattern.visual_traits) ? pattern.visual_traits.map((t) => String(t)) : [];

    let patternMismatch = false;
    let patternBoost = false;

    if (pattern && textLower.length > 12 && keywords.length >= 2) {
      const kwHits = countPhraseHits(textLower, keywords);
      const exHits = expected.length ? countPhraseHits(haystack, expected) : 0;
      const traitHits = traits.length ? countPhraseHits(haystack, traits) : 0;
      const combinedSignal = kwHits + (exHits > 0 ? 1 : 0) + (traitHits > 0 ? 1 : 0);

      const minKw = Math.min(keywords.length, Math.max(2, Math.ceil(keywords.length * 0.35)));
      if (kwHits === 0 && keywords.length >= 3) {
        conf *= 0.9;
        margin *= 0.88;
        patternMismatch = true;
        reference_context.pattern_mismatch = true;
        reference_context.potential_conflict = true;
        console.log("Pattern mismatch detected");
        logLines.push("pattern_mismatch");
      } else if (kwHits >= minKw || (kwHits >= 1 && keywords.length <= 4)) {
        conf = Math.min(1, conf + 0.022);
        margin = Math.min(1, margin + 0.015);
        patternBoost = true;
        reference_context.pattern_boost = true;
      } else if (combinedSignal === 0 && keywords.length >= 4 && textLower.length > 40) {
        conf *= 0.94;
        margin *= 0.92;
        patternMismatch = true;
        reference_context.pattern_mismatch = true;
        reference_context.potential_conflict = true;
        console.log("Pattern mismatch detected");
        logLines.push("pattern_weak_signal");
      }
    }

    const teaser = loadReferenceDocumentTeaser(industry, label);
    const docRatio = documentTeaserBoostRatio(textLower, teaser);
    if (docRatio >= 0.12 && textLower.length > 10) {
      conf = Math.min(1, conf + 0.018);
      reference_context.reference_document_boost = true;
      logLines.push("doc_boost");
    }

    if (procRec?.review_required === true) {
      const wouldAuto = conf >= thresholds.confidence && margin >= thresholds.margin;
      if (wouldAuto) {
        conf = Math.min(conf, thresholds.confidence - 0.002);
        margin = Math.min(margin, thresholds.margin - 0.002);
        reference_context.process_forced_review = true;
        console.log("Process rule triggered review");
        logLines.push("process_review");
      } else {
        reference_context.process_review_sensitive = true;
        conf *= 0.97;
        margin *= 0.96;
        logLines.push("process_sensitivity");
      }
    }

    if (procRec?.priority === "high") {
      conf *= 0.988;
      margin *= 0.985;
      reference_context.high_priority_sensitivity = true;
      logLines.push("high_priority");
    }

    conf = Math.max(0, Math.min(1, conf));
    margin = Math.max(0, Math.min(1, margin));

    if (logLines.length > 0 || patternMismatch || patternBoost || reference_context.process_forced_review) {
      reference_context.applied = true;
      console.log("Reference validation applied");
    }

    return {
      ...classification,
      confidence: conf,
      margin,
      reference_context,
    };
  } catch (e) {
    console.warn("referenceAugmentation: skipped", e instanceof Error ? e.message : e);
    return classification;
  }
}

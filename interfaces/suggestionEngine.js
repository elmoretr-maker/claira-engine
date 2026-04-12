/**
 * End-of-session suggestions from exemption patterns, Express Pass rules, and session report.
 * Read-only — does not change classification, routing, validation, or moves.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getExemptionPatterns } from "../policies/patterns.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPRESS_PASS_PATH = join(__dirname, "..", "policies", "expressPass.json");
const SESSION_REPORT_PATH = join(__dirname, "..", "data", "session_report.json");

/** Min count on an Express Pass rule to surface “stable rule” insight. */
const RULE_CONFIDENCE_MIN_COUNT = 5;
/** Min unresolved session items to flag review pressure. */
const REVIEW_PRESSURE_MIN_UNRESOLVED = 5;

/**
 * @template T
 * @param {string} path
 * @param {T} fallback
 */
function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * @returns {{
 *   suggestions: Array<
 *     | { type: "promote_to_rule"; predicted: string; selected: string; count: number; message: string }
 *     | { type: "rule_confidence"; message: string }
 *     | { type: "review_pressure"; message: string }
 *   >
 * }}
 */
export function generateSuggestions() {
  /** @type {Array<Record<string, unknown>>} */
  const suggestions = [];

  const patterns = getExemptionPatterns(3);
  for (const p of patterns) {
    const n = p.count;
    suggestions.push({
      type: "promote_to_rule",
      predicted: p.predicted,
      selected: p.selected,
      count: n,
      message: `You've redirected this ${n} times. Apply as a rule?`,
    });
  }

  const express = loadJson(EXPRESS_PASS_PATH, { rules: [] });
  const rules = Array.isArray(express.rules) ? express.rules : [];
  let maxRuleCount = 0;
  for (const r of rules) {
    const c = Number(r?.count ?? 0);
    if (c > maxRuleCount) maxRuleCount = c;
  }
  if (maxRuleCount >= RULE_CONFIDENCE_MIN_COUNT) {
    suggestions.push({
      type: "rule_confidence",
      message: "This rule is frequently applied and stable.",
    });
  }

  const report = loadJson(SESSION_REPORT_PATH, { summary: {} });
  const unresolved = Number(report?.summary?.unresolvedCount ?? 0);
  if (unresolved >= REVIEW_PRESSURE_MIN_UNRESOLVED) {
    suggestions.push({
      type: "review_pressure",
      message: "High number of review items. Consider adjusting thresholds.",
    });
  }

  return { suggestions };
}

function formatSuggestionLine(s) {
  if (s.type === "promote_to_rule") {
    return `• ${s.message} (${s.predicted} → ${s.selected})`;
  }
  return `• ${s.message}`;
}

/**
 * Prints an end-of-session summary. Does not write files or apply rules.
 * @returns {ReturnType<typeof generateSuggestions>}
 */
export function runEndOfSessionReview() {
  const out = generateSuggestions();
  console.log("Claira Daily Review");
  console.log("");
  if (!out.suggestions.length) {
    console.log("No suggestions at this time.");
    console.log("");
    return out;
  }
  for (const s of out.suggestions) {
    console.log(formatSuggestionLine(s));
  }
  console.log("");
  return out;
}

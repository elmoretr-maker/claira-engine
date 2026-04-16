/**
 * Load optional workflow composition presets (JSON). Deterministic file order by name.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { REGISTERED_WORKFLOW_MODULE_IDS } from "../validation/workflowTemplateContract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESETS_DIR = __dirname;

const registered = new Set(REGISTERED_WORKFLOW_MODULE_IDS);

/**
 * @typedef {{
 *   presetId: string,
 *   matchKeywords: string[],
 *   modules: string[],
 *   moduleOptions?: Record<string, unknown>,
 * }} WorkflowPreset
 */

/**
 * @param {unknown} raw
 * @returns {WorkflowPreset}
 */
function parsePreset(raw, filename) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`workflow preset ${filename}: root must be an object`);
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  const presetId = typeof o.presetId === "string" ? o.presetId.trim() : "";
  if (!presetId) {
    throw new Error(`workflow preset ${filename}: presetId must be a non-empty string`);
  }
  if (!Array.isArray(o.matchKeywords) || o.matchKeywords.length === 0) {
    throw new Error(`workflow preset ${filename}: matchKeywords must be a non-empty array`);
  }
  const matchKeywords = o.matchKeywords
    .map((k) => String(k ?? "").trim().toLowerCase())
    .filter(Boolean);
  if (matchKeywords.length === 0) {
    throw new Error(`workflow preset ${filename}: matchKeywords must contain non-empty strings`);
  }
  if (!Array.isArray(o.modules) || o.modules.length === 0) {
    throw new Error(`workflow preset ${filename}: modules must be a non-empty array`);
  }
  const modules = o.modules.map((m) => String(m ?? "").trim()).filter(Boolean);
  for (const mid of modules) {
    if (!registered.has(mid)) {
      throw new Error(`workflow preset ${filename}: unknown module "${mid}"`);
    }
  }
  /** @type {WorkflowPreset} */
  const out = { presetId, matchKeywords, modules };
  if (o.moduleOptions != null) {
    if (typeof o.moduleOptions !== "object" || Array.isArray(o.moduleOptions)) {
      throw new Error(`workflow preset ${filename}: moduleOptions must be an object when present`);
    }
    out.moduleOptions = /** @type {Record<string, unknown>} */ (o.moduleOptions);
  }
  return out;
}

/**
 * @returns {WorkflowPreset[]}
 */
export function loadWorkflowPresets() {
  if (!existsSync(PRESETS_DIR)) return [];
  let names;
  try {
    names = readdirSync(PRESETS_DIR);
  } catch {
    return [];
  }
  const jsonFiles = names
    .filter((n) => n.endsWith(".json") && !n.startsWith("_"))
    .sort((a, b) => a.localeCompare(b));
  /** @type {WorkflowPreset[]} */
  const out = [];
  for (const fn of jsonFiles) {
    const path = join(PRESETS_DIR, fn);
    let raw;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`workflow preset ${fn}: invalid JSON (${msg})`);
    }
    out.push(parsePreset(raw, fn));
  }
  return out;
}

/**
 * @param {string} normalizedText
 * @param {WorkflowPreset[]} presets
 * @returns {WorkflowPreset | null}
 */
export function matchWorkflowPreset(normalizedText, presets) {
  const text = String(normalizedText ?? "").trim().toLowerCase();
  if (!text) return null;
  for (const p of presets) {
    const allMatch = p.matchKeywords.every((kw) => text.includes(kw));
    if (allMatch) return p;
  }
  return null;
}

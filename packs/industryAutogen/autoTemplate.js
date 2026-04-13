/**
 * Generate templates/<slug>.js for pack generator (not loaded by classifier).
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

/**
 * @param {{
 *   slug: string,
 *   displayName: string,
 *   documentTypes: string[],
 *   workflows: string[],
 * }} opts
 */
export function writeAutoIndustryTemplate(opts) {
  const slug = String(opts.slug ?? "").trim().toLowerCase();
  if (!slug || !/^[a-z0-9_-]+$/.test(slug)) throw new Error("Invalid slug for template");
  const displayName = String(opts.displayName ?? "").trim() || slug;
  const docTypes = Array.isArray(opts.documentTypes) ? opts.documentTypes : [];
  const workflows = Array.isArray(opts.workflows) ? opts.workflows : [];

  const dir = join(ROOT, "templates");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slug}.js`);

  const docLit = JSON.stringify(docTypes.slice(0, 28));
  const flowLit = JSON.stringify(workflows.slice(0, 28));
  const nameLit = JSON.stringify(displayName);

  const body = `/**
 * Auto-generated industry template for ${displayName.replace(/\*/g, "")}
 * Created by industry autogen — edit freely. Used only by dev/generate_pack_system.mjs.
 */
export const version = 1;

export function extraKeywordHints(catKey, label) {
  const k = catKey.toLowerCase();
  const industry = ${nameLit};
  const docHints = ${docLit};
  const flowHints = ${flowLit};
  const out = [];
  const base = label.toLowerCase();
  const unders = k.replace(/_/g, " ");
  for (const h of docHints) {
    if (typeof h !== "string" || !h.trim()) continue;
    const t = h.trim().toLowerCase().slice(0, 72);
    out.push(t, t + " " + unders, unders + " " + t);
  }
  for (const h of flowHints) {
    if (typeof h !== "string" || !h.trim()) continue;
    const t = h.trim().toLowerCase().slice(0, 72);
    out.push(t + " workflow", t + " process", unders + " " + t);
  }
  out.push(
    base,
    industry.toLowerCase(),
    base + " intake",
    base + " record",
    base + " document",
    base + " file",
    "scanned " + base,
    "signed " + base,
    "official " + base,
    "internal " + base,
    "reference number",
    "date stamp",
    "form fields",
    "attachment",
  );
  return out;
}

export function patternStructure(catKey, label, keywords) {
  return {
    expected_elements: [
      "primary title or subject for " + label,
      "legible body text or structured fields",
      "metadata region (dates, ids, or version) when applicable",
    ],
    optional_elements: [
      "signature or approval block",
      "attachments list or appendix",
      "stamps, logos, or watermarks",
    ],
    visual_traits: [
      "office paperwork or digital export",
      "scan or mobile photo capture",
      "consistent alignment and margins",
    ],
  };
}

export function processIntel(catKey, label, groupId, packSlug) {
  const industry = ${nameLit};
  const purpose =
    "Operational handling for **" +
    label +
    "** in **" +
    packSlug +
    "** (" +
    industry +
    "): validate, route, and archive per your org rules.";
  const actions = [
    "Confirm the item belongs in **" + label + "** before routing or filing.",
    "Cross-check extracted text against expected fields when OCR is available.",
    "Escalate low-confidence or conflicting signals to human review.",
    "Preserve audit context when moving between queues or systems.",
  ];
  return { purpose, actions };
}
`;

  writeFileSync(path, body, "utf8");
  return path;
}

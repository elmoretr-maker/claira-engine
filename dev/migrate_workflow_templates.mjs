/**
 * One-shot migration: normalize each pack's workflow_template.json to the strict contract.
 * Run from repo root: node dev/migrate_workflow_templates.mjs
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { assertWorkflowTemplateContract } from "../workflow/validation/workflowTemplateContract.js";
import { listIndustryPacks } from "../packs/listIndustryPacks.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_MODULES = ["entity_tracking", "asset_registry", "event_log"];

/**
 * @param {unknown} raw
 * @param {string} slug
 * @param {string} packLabel
 */
function buildStrictTemplate(raw, slug, packLabel) {
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? JSON.parse(JSON.stringify(raw))
      : {};

  const templateId =
    typeof base.templateId === "string" && base.templateId.trim()
      ? base.templateId.trim()
      : `${slug.replace(/[^a-z0-9_-]/gi, "_")}_workflow_v1`;

  const label =
    typeof base.label === "string" && base.label.trim()
      ? base.label.trim()
      : packLabel.trim() || slug;

  let modules = Array.isArray(base.modules)
    ? base.modules.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  if (modules.length === 0) modules = [...DEFAULT_MODULES];

  let moduleOptions =
    base.moduleOptions && typeof base.moduleOptions === "object" && !Array.isArray(base.moduleOptions)
      ? JSON.parse(JSON.stringify(base.moduleOptions))
      : {};

  if (modules.includes("entity_tracking")) {
    const et = moduleOptions.entity_tracking && typeof moduleOptions.entity_tracking === "object"
      ? moduleOptions.entity_tracking
      : {};
    const labels = et.labels && typeof et.labels === "object" ? et.labels : {};
    const singular =
      typeof labels.singular === "string" && labels.singular.trim() ? labels.singular.trim() : "Entity";
    const plural =
      typeof labels.plural === "string" && labels.plural.trim() ? labels.plural.trim() : "Entities";
    moduleOptions.entity_tracking = { ...et, labels: { singular, plural } };
  }

  const ui = moduleOptions.uiSections && typeof moduleOptions.uiSections === "object"
    ? moduleOptions.uiSections
    : {};
  moduleOptions.uiSections = {
    entities:
      typeof ui.entities === "string" && ui.entities.trim() ? ui.entities.trim() : moduleOptions.entity_tracking?.labels?.plural || "Entities",
    activity: typeof ui.activity === "string" && ui.activity.trim() ? ui.activity.trim() : "Activity",
    addData: typeof ui.addData === "string" && ui.addData.trim() ? ui.addData.trim() : "Add data",
  };

  const ml = moduleOptions.moduleLabels && typeof moduleOptions.moduleLabels === "object"
    ? moduleOptions.moduleLabels
    : {};
  /** @type {Record<string, string>} */
  const moduleLabels = { ...ml };
  const defaults = {
    entity_tracking: moduleOptions.entity_tracking?.labels?.plural || "Entities",
    asset_registry: "Data input",
    event_log: "Activity",
  };
  for (const mid of modules) {
    if (typeof moduleLabels[mid] !== "string" || !moduleLabels[mid].trim()) {
      const d = defaults[mid];
      if (!d) throw new Error(`migrate: no default moduleLabel for ${mid}`);
      moduleLabels[mid] = d;
    }
  }
  moduleOptions.moduleLabels = moduleLabels;

  const out = {
    ...base,
    templateId,
    label,
    modules,
    moduleOptions,
  };

  return out;
}

let fixed = 0;
let skipped = 0;

for (const p of listIndustryPacks()) {
  if (p.valid === false) continue;
  const tmplPath = join(ROOT, "packs", p.slug, "workflow_template.json");
  if (!existsSync(tmplPath)) {
    skipped++;
    continue;
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(tmplPath, "utf8"));
  } catch (e) {
    console.error(`SKIP ${tmplPath}: invalid JSON`, e);
    process.exitCode = 1;
    continue;
  }

  const hint = `packs/${p.slug}/workflow_template.json`;
  let needWrite = false;
  try {
    assertWorkflowTemplateContract(raw, hint);
  } catch {
    needWrite = true;
  }

  if (!needWrite) {
    skipped++;
    continue;
  }

  const strict = buildStrictTemplate(raw, p.slug, p.label);
  assertWorkflowTemplateContract(strict, hint);
  writeFileSync(tmplPath, `${JSON.stringify(strict, null, 2)}\n`, "utf8");
  console.log(`MIGRATED ${hint}`);
  fixed++;
}

let refFixed = 0;
for (const p of listIndustryPacks()) {
  if (p.valid === false) continue;
  const tmplPath = join(ROOT, "packs", p.slug, "workflow_template.json");
  if (!existsSync(tmplPath)) continue;
  const refPath = join(ROOT, "packs", p.slug, "reference.json");
  if (!existsSync(refPath)) continue;
  let ref;
  try {
    ref = JSON.parse(readFileSync(refPath, "utf8"));
  } catch {
    console.error(`SKIP ${refPath}: invalid JSON`);
    process.exitCode = 1;
    continue;
  }
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) continue;
  const ws = ref.pack && typeof ref.pack === "object" && !Array.isArray(ref.pack) ? ref.pack.workflowSource : undefined;
  if (ws === "prebuilt") {
    console.error(
      `INVARIANT packs/${p.slug}: workflow_template.json exists but pack.workflowSource is "prebuilt" — remove template or fix source tag.`,
    );
    process.exitCode = 1;
    continue;
  }
  if (ws === "generated") continue;
  if (!ref.pack || typeof ref.pack !== "object" || Array.isArray(ref.pack)) ref.pack = {};
  ref.pack.workflowSource = "generated";
  writeFileSync(refPath, `${JSON.stringify(ref, null, 2)}\n`, "utf8");
  console.log(`SET pack.workflowSource=generated → packs/${p.slug}/reference.json (workflow template present)`);
  refFixed++;
}

console.log(
  `Done. Template migrated: ${fixed}, ref workflowSource set: ${refFixed}, other skips: ${skipped}.`,
);

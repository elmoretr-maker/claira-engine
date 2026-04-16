/**
 * Build workflow_template.json from explicit user-selected modules only (no inference here).
 */

import {
  orderSelectedModulesForTemplate,
  validateWorkflowModuleSelection,
} from "../contracts/workflowRules.js";

/**
 * Presentation only — must not influence which modules are selected (selection is user-confirmed earlier).
 * @param {string} normalizedText
 * @returns {{ singular: string, plural: string }}
 */
function deriveEntityLabels(normalizedText) {
  const text = String(normalizedText ?? "").trim().toLowerCase();
  /** @type {Array<{ kw: string, singular: string, plural: string }>} */
  const rules = [
    { kw: "patient", singular: "Patient", plural: "Patients" },
    { kw: "client", singular: "Client", plural: "Clients" },
    { kw: "customer", singular: "Customer", plural: "Customers" },
    { kw: "member", singular: "Member", plural: "Members" },
    { kw: "user", singular: "User", plural: "Users" },
    { kw: "person", singular: "Person", plural: "People" },
  ];
  for (const r of rules) {
    if (text.includes(r.kw)) {
      return { singular: r.singular, plural: r.plural };
    }
  }
  return { singular: "Entity", plural: "Entities" };
}

/**
 * @param {string[]} modules
 * @param {string} normalizedText
 * @returns {Record<string, unknown>}
 */
function buildDefaultModuleOptions(modules, normalizedText) {
  const { singular, plural } = deriveEntityLabels(normalizedText);
  /** @type {Record<string, unknown>} */
  const mo = {
    uiSections: {
      entities: plural,
      activity: "Activity",
      addData: "Add data",
    },
    moduleLabels: {},
  };
  if (modules.includes("entity_tracking")) {
    mo.entity_tracking = {
      labels: { singular, plural },
    };
  }
  for (const mid of modules) {
    if (mid === "entity_tracking") {
      /** @type {Record<string, unknown>} */ (mo.moduleLabels)[mid] = plural;
    } else if (mid === "asset_registry") {
      /** @type {Record<string, unknown>} */ (mo.moduleLabels)[mid] = "Data input";
    } else if (mid === "event_log") {
      /** @type {Record<string, unknown>} */ (mo.moduleLabels)[mid] = "Activity";
    }
  }
  return mo;
}

/**
 * @param {{ industryName: string, buildIntent?: string, packSlug: string, selectedModules: string[] }} input
 * @returns {Record<string, unknown>}
 */
export function composeWorkflowFromUserSelection(input) {
  const industryName = String(input.industryName ?? "").trim();
  const buildIntent = String(input.buildIntent ?? "").trim();
  const packSlug = String(input.packSlug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "");
  const err = validateWorkflowModuleSelection(input.selectedModules);
  if (err) {
    throw new Error(err);
  }
  if (!industryName) {
    throw new Error("composeWorkflowFromUserSelection: industryName is required");
  }
  if (!packSlug) {
    throw new Error("composeWorkflowFromUserSelection: packSlug is required");
  }

  const modules = orderSelectedModulesForTemplate(input.selectedModules);
  const normalizedText = `${industryName} ${buildIntent}`.trim().toLowerCase();
  const moduleOptions = buildDefaultModuleOptions(modules, normalizedText);

  const templateId = `${packSlug}_composition_v1`;
  const label = industryName;

  /** @type {Record<string, unknown>} */
  const doc = {
    templateId,
    version: 1,
    label,
    modules,
    moduleOptions,
  };

  if (modules.includes("asset_registry")) {
    doc.eventTypes = [{ type: "image_ingested", label: "Image ingested" }];
  }

  return doc;
}

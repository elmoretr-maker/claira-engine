/**
 * Writes packs/<slug>/workflow_template.json from keyword + preset composition (generated packs only).
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { assertWorkflowTemplateContract } from "../../workflow/validation/workflowTemplateContract.js";
import { composeWorkflowFromUserSelection } from "../../workflow/composition/composeWorkflowFromBuildInput.js";

/**
 * @param {string} packDir — absolute path to packs/<slug>
 * @param {string} industryName
 * @param {string} [buildIntent]
 * @param {string} packSlug — pack folder slug (e.g. same as directory name)
 * @param {string[]} selectedModules — exact user-confirmed module ids
 */
export function writeComposedWorkflowTemplateForPack(packDir, industryName, buildIntent = "", packSlug, selectedModules) {
  const doc = composeWorkflowFromUserSelection({
    industryName,
    buildIntent,
    packSlug,
    selectedModules,
  });
  const outPath = join(packDir, "workflow_template.json");
  assertWorkflowTemplateContract(doc, outPath.replace(/\\/g, "/"));
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

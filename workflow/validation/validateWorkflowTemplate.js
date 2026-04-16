/**
 * Node entry: re-exports strict workflow template validation.
 */

export {
  assertWorkflowTemplateContract,
  REGISTERED_WORKFLOW_MODULE_IDS,
} from "./workflowTemplateContract.js";

import { assertWorkflowTemplateContract } from "./workflowTemplateContract.js";

/**
 * @param {unknown} template
 * @param {string} [sourceHint]
 */
export function validateWorkflowTemplate(template, sourceHint) {
  assertWorkflowTemplateContract(template, sourceHint);
}

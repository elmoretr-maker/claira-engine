/**
 * Internal UI route metadata — maps workflow module IDs to their ordered widget IDs.
 * Used by the output switch when routing to the internal presentation path.
 *
 * Widget order is deterministic: consumers render in the declared order.
 * This is the single source of truth for internal UI routing.
 */

/**
 * Ordered widget IDs per module for internal UI rendering.
 * Any module not listed here falls back to an empty widget list.
 *
 * @type {Record<string, string[]>}
 */
export const INTERNAL_UI_WIDGET_ORDER_BY_MODULE = Object.freeze({
  image_input: ["asset_upload"],
  basic_classifier: ["classifier_result"],
  structured_output: ["structured_card"],
  simple_presentation: ["ack_bar", "deliverable_card"],
  asset_validation: ["validation_report"],
  claira_reasoning: ["reasoning_trace"],
  asset_router: ["router_summary"],
  asset_mover: ["mover_log"],
  entity_tracking: ["entity_list", "entity_create"],
  asset_registry: ["attach_input"],
  event_log: ["event_timeline"],
});

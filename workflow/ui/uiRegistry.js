/**
 * Module → UI registry. Maps workflow module ids to lazy React widgets (no pipeline, no cross-module imports).
 */

import { lazy } from "react";

/**
 * @typedef {{ Component: import("react").LazyExoticComponent<import("react").ComponentType<any>> }} WidgetEntry
 */

/** @type {Record<string, { widgets: Record<string, WidgetEntry>, screens: Record<string, WidgetEntry> }>} */
export const workflowUiRegistry = {
  entity_tracking: {
    widgets: {
      entity_list: {
        Component: lazy(() => import("../../ui/workflow/widgets/EntityTrackingEntityListWidget.jsx")),
      },
      entity_create: {
        Component: lazy(() => import("../../ui/workflow/widgets/EntityTrackingCreateFormWidget.jsx")),
      },
    },
    screens: {},
  },
  asset_registry: {
    widgets: {
      attach_input: {
        Component: lazy(() => import("../../ui/workflow/widgets/AssetRegistryAttachWidget.jsx")),
      },
    },
    screens: {},
  },
  event_log: {
    widgets: {
      event_timeline: {
        Component: lazy(() => import("../../ui/workflow/widgets/EventLogTimelineWidget.jsx")),
      },
    },
    screens: {},
  },
};

/**
 * @param {string} moduleId
 * @param {string} widgetId
 * @returns {WidgetEntry | null}
 */
export function getWorkflowWidgetEntry(moduleId, widgetId) {
  const m = workflowUiRegistry[moduleId];
  if (!m?.widgets) return null;
  return m.widgets[widgetId] ?? null;
}

/** Default widget order per module for the temporary two-column layout. */
export const defaultWidgetOrderByModule = {
  entity_tracking: ["entity_list", "entity_create"],
  asset_registry: ["attach_input"],
  event_log: ["event_timeline"],
};

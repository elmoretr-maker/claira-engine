/**
 * TEST ONLY — validation harness. Safe to delete with workflow/modules/test_modules/.
 */

export const testDispatchModule = {
  id: "test_dispatch",
  label: "TEST ONLY: dispatch",
  description: "Validation — dispatches entity_tracking.add then reports dispatched: true.",
  capabilities: ["test"],
  modulePipelineType: "tracking",
  consumes: ["entity"],
  produces: [{ kind: "entity", mode: "extend" }],
  expectedContextVersion: 2,
  state: {
    initialize: () => ({}),
    selectors: {
      /** @param {Record<string, unknown>} s */
      noop: (s) => s,
    },
    reducers: {
      /** @param {Record<string, unknown>} s */
      noop: (s) => s,
    },
  },
  health: {
    check: () => ({ status: "healthy", issues: [] }),
  },
  ui: { components: [] },
  execute: (context) => {
    context.dispatch("entity_tracking", "add", { id: "test-validation-entity", label: "from test_dispatch" });
    return { dispatched: true };
  },
};

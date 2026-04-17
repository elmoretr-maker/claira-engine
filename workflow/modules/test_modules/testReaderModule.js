/**
 * TEST ONLY — validation harness. Safe to delete with workflow/modules/test_modules/.
 */

export const testReaderModule = {
  id: "test_reader",
  label: "TEST ONLY: reader",
  description: "Validation — reads entity_tracking slice count via getState + selectors.",
  capabilities: ["test"],
  modulePipelineType: "aggregation",
  consumes: ["entity"],
  produces: [{ kind: "aggregate", mode: "derive" }],
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
    const et = /** @type {{ state: { selectors: { getAll: (s: unknown) => unknown[] } } }} */ (
      context.getModule("entity_tracking")
    );
    const slice = context.getState().moduleRuntimeState?.["entity_tracking"];
    const list = et.state.selectors.getAll(slice);
    return { entityCount: list.length };
  },
};

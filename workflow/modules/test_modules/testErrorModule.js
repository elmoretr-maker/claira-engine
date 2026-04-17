/**
 * TEST ONLY — validation harness (failure path). Safe to delete with workflow/modules/test_modules/.
 */

export const testErrorModule = {
  id: "test_error",
  label: "TEST ONLY: error",
  description: "Validation — execute throws intentional failure.",
  capabilities: ["test"],
  modulePipelineType: "tracking",
  consumes: ["entity"],
  produces: [{ kind: "analysis", mode: "create" }],
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
  execute: () => {
    throw new Error("intentional failure");
  },
};

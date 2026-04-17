/**
 * TEST ONLY — validation harness. Safe to delete with workflow/modules/test_modules/.
 * Do not use in production workflows.
 */

export const testPassModule = {
  id: "test_pass",
  label: "TEST ONLY: pass",
  description: "Determinism validation — returns a fixed payload.",
  capabilities: ["test"],
  modulePipelineType: "input",
  consumes: [],
  produces: [{ kind: "entity", mode: "create" }],
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
  execute: () => ({ message: "pass" }),
};

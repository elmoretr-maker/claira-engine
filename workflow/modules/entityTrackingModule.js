/**
 * Entity Tracking — registry module (contract + isolated state + read-only health).
 */

/** @typedef {{ id: string, label: string, updatedAt?: number }} EntityRow */

/** @typedef {{ entities: EntityRow[] }} EntityTrackingSlice */

export const entityTrackingModule = {
  id: "entity_tracking",
  label: "Entity Tracking",
  description: "Track people or items",
  capabilities: ["create_entity", "update_entity", "list_entities"],
  modulePipelineType: "tracking",
  consumes: [],
  produces: [{ kind: "entity", mode: "create" }],
  expectedContextVersion: 2,

  state: {
    /** @returns {EntityTrackingSlice} */
    initialize: () => ({ entities: [] }),
    selectors: {
      /** @param {EntityTrackingSlice} s */
      getAll: (s) => (Array.isArray(s?.entities) ? s.entities : []),
    },
    reducers: {
      /**
       * @param {EntityTrackingSlice} s
       * @param {{ id?: string, label?: string }} payload
       */
      add: (s, payload) => {
        const id = String(payload?.id ?? "").trim();
        const label = String(payload?.label ?? id).trim();
        if (!id) return s;
        const entities = [...(s.entities ?? [])];
        entities.push({ id, label, updatedAt: Date.now() });
        return { ...s, entities };
      },
      /**
       * @param {EntityTrackingSlice} s
       * @param {{ id?: string, label?: string }} payload
       */
      update: (s, payload) => {
        const id = String(payload?.id ?? "").trim();
        if (!id) return s;
        const nextLabel = payload?.label != null ? String(payload.label) : undefined;
        const entities = (s.entities ?? []).map((e) =>
          e.id === id
            ? {
                ...e,
                ...(nextLabel !== undefined ? { label: nextLabel } : {}),
                updatedAt: Date.now(),
              }
            : e,
        );
        return { ...s, entities };
      },
    },
  },

  health: {
    /** @param {EntityTrackingSlice} s */
    check: (s) => {
      const list = Array.isArray(s?.entities) ? s.entities : [];
      const ids = list.map((e) => e.id);
      const unique = new Set(ids);
      if (ids.length !== unique.size) {
        return { status: "warning", issues: ["Duplicate entity ids in module store"] };
      }
      return { status: "healthy", issues: [] };
    },
  },

  ui: {
    components: [],
  },

  /**
   * Read-only snapshot of entity slice for execution output; use context.dispatch to mutate.
   * @param {{ getModule: (id: string) => unknown, moduleState: unknown, getState: () => unknown, dispatch: Function }} context
   */
  execute: (context) => {
    const mod = /** @type {{ state: { selectors: { getAll: (s: unknown) => unknown[] } } }} */ (
      context.getModule("entity_tracking")
    );
    const list = mod.state.selectors.getAll(context.moduleState);
    return {
      kind: "entity_tracking",
      count: list.length,
      entities: list,
    };
  },
};

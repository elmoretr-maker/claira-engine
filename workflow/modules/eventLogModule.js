/**
 * Event Log — registry module (contract + isolated state + read-only health).
 */

/** @typedef {{ id: string, label: string, at: number, entityId?: string }} EventRow */

/** @typedef {{ events: EventRow[] }} EventLogSlice */

export const eventLogModule = {
  id: "event_log",
  label: "Event Log",
  description: "Track activity over time",
  capabilities: ["add_event", "list_events"],
  modulePipelineType: "tracking",
  consumes: ["entity"],
  produces: [{ kind: "event", mode: "create" }],
  expectedContextVersion: 2,

  state: {
    /** @returns {EventLogSlice} */
    initialize: () => ({ events: [] }),
    selectors: {
      /** Chronological timeline (immutable sort). */
      timeline: (s) =>
        [...(Array.isArray(s?.events) ? s.events : [])].sort((a, b) => a.at - b.at),
    },
    reducers: {
      /**
       * @param {EventLogSlice} s
       * @param {{ id?: string, label?: string, at?: number, entityId?: string }} payload
       */
      add: (s, payload) => {
        const id = String(payload?.id ?? "").trim();
        const label = String(payload?.label ?? "").trim();
        if (!id || !label) return s;
        const at = typeof payload?.at === "number" && Number.isFinite(payload.at) ? payload.at : Date.now();
        const entityId = payload?.entityId != null ? String(payload.entityId).trim() : "";
        const row = /** @type {EventRow} */ ({
          id,
          label,
          at,
          ...(entityId ? { entityId } : {}),
        });
        return { ...s, events: [...(s.events ?? []), row] };
      },
    },
  },

  health: {
    /** @param {EventLogSlice} s */
    check: (s) => {
      const events = Array.isArray(s?.events) ? s.events : [];
      const ids = events.map((e) => e.id);
      if (ids.length !== new Set(ids).size) {
        return { status: "warning", issues: ["Duplicate event ids in module store"] };
      }
      return { status: "healthy", issues: [] };
    },
  },

  ui: {
    components: [],
  },

  /**
   * @param {{ getModule: (id: string) => unknown, moduleState: unknown, getState: () => unknown, dispatch: Function }} context
   */
  execute: (context) => {
    const mod = /** @type {{ state: { selectors: { timeline: (s: unknown) => unknown[] } } }} */ (
      context.getModule("event_log")
    );
    const timeline = mod.state.selectors.timeline(context.moduleState);
    return {
      kind: "event_log",
      count: timeline.length,
      timeline,
    };
  },
};

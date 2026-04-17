/**
 * MVP — Structured output: aggregates analyses into a versioned deliverable (list + summary).
 * Phase 7: richer per-item fields; schema remains claira.deliverable.v2 (backward compatible superset).
 */

/**
 * @typedef {{
 *   schema: string,
 *   summary: string,
 *   items: Array<DeliverableItemV2>,
 *   aggregate: {
 *     assetCount: number,
 *     byCategory: Record<string, number>,
 *     byLabel: Record<string, number>,
 *   },
 *   intelligenceMeta?: { providerWasActive: boolean },
 * }} DeliverableDocV2
 */

/**
 * @typedef {{
 *   analysisId: string,
 *   assetId: string,
 *   sourceRef: string,
 *   category: string,
 *   labels: string[],
 *   confidence: number | null,
 *   modelHint: string,
 *   modelSource: string,
 *   features: Record<string, unknown>,
 *   embeddings: number[] | null,
 * }} DeliverableItemV2
 */

/** @typedef {{ deliverable: DeliverableDocV2 | null }} StructuredOutputSlice */

function buildAggregate(items) {
  /** @type {Record<string, number>} */
  const byCategory = {};
  /** @type {Record<string, number>} */
  const byLabel = {};
  for (const it of items) {
    const c = it.category || "unknown";
    byCategory[c] = (byCategory[c] ?? 0) + 1;
    const labels = Array.isArray(it.labels) ? it.labels : [];
    for (const L of labels) {
      const key = String(L);
      byLabel[key] = (byLabel[key] ?? 0) + 1;
    }
  }
  return { assetCount: items.length, byCategory, byLabel };
}

export const structuredOutputModule = {
  id: "structured_output",
  label: "Structured output",
  description: "Aggregate classifier output into a structured deliverable list.",
  capabilities: ["materialize", "aggregate"],
  modulePipelineType: "output",
  consumes: ["analysis"],
  produces: [{ kind: "deliverable", mode: "create" }],
  expectedContextVersion: 2,

  state: {
    /** @returns {StructuredOutputSlice} */
    initialize: () => ({ deliverable: null }),
    selectors: {
      /** @param {StructuredOutputSlice} s */
      getDeliverable: (s) => (s?.deliverable != null && typeof s.deliverable === "object" ? s.deliverable : null),
    },
    reducers: {
      /**
       * @param {StructuredOutputSlice} s
       * @param {DeliverableDocV2 | null} payload
       */
      setDeliverable: (s, payload) => {
        if (payload == null || typeof payload !== "object") return { ...s, deliverable: null };
        const p = /** @type {DeliverableDocV2} */ (payload);
        const items = Array.isArray(p.items)
          ? p.items.map((it) => ({
              ...it,
              labels: Array.isArray(it.labels) ? [...it.labels] : [],
              features:
                it.features != null && typeof it.features === "object" && !Array.isArray(it.features)
                  ? { ...it.features }
                  : {},
              embeddings:
                it.embeddings === null || it.embeddings === undefined
                  ? null
                  : Array.isArray(it.embeddings)
                    ? [...it.embeddings]
                    : null,
            }))
          : [];
        return {
          ...s,
          deliverable: {
            schema: p.schema,
            summary: p.summary,
            items,
            aggregate: {
              assetCount: p.aggregate?.assetCount ?? 0,
              byCategory: { ...p.aggregate?.byCategory },
              byLabel: { ...p.aggregate?.byLabel },
            },
            ...(p.intelligenceMeta != null && typeof p.intelligenceMeta === "object"
              ? { intelligenceMeta: { ...p.intelligenceMeta } }
              : {}),
          },
        };
      },
    },
  },

  health: {
    check: (s) =>
      s?.deliverable != null
        ? { status: "healthy", issues: [] }
        : { status: "warning", issues: ["No deliverable yet"] },
  },

  ui: { components: [] },

  /**
   * @param {{ getModule: (id: string) => unknown, moduleState: unknown, getState: () => unknown, dispatch: Function }} context
   */
  execute: (context) => {
    const st = /** @type {{ moduleRuntimeState?: Record<string, unknown> }} */ (context.getState());
    const classifier = st.moduleRuntimeState?.basic_classifier;
    const raw = /** @type {{ analyses?: unknown }} */ (classifier)?.analyses;
    const analyses = Array.isArray(raw) ? raw : [];

    /** @type {DeliverableItemV2[]} */
    const items = [];
    let providerWasActive = false;

    for (const a of analyses) {
      if (a == null || typeof a !== "object" || Array.isArray(a)) continue;
      const o = /** @type {Record<string, unknown>} */ (a);
      const modelSource = String(o.modelSource ?? "heuristic");
      if (modelSource !== "heuristic") providerWasActive = true;

      const labels = Array.isArray(o.labels) ? o.labels.map((x) => String(x)) : [];
      const feats =
        o.features != null && typeof o.features === "object" && !Array.isArray(o.features)
          ? /** @type {Record<string, unknown>} */ ({ ...o.features })
          : {};
      const emb = o.embeddings;
      const embeddings =
        emb === null || emb === undefined
          ? null
          : Array.isArray(emb)
            ? emb.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : 0))
            : null;

      items.push({
        analysisId: String(o.id ?? ""),
        assetId: String(o.assetId ?? ""),
        sourceRef: String(o.sourceRef ?? ""),
        category: String(o.category ?? "unknown"),
        labels,
        confidence: typeof o.confidence === "number" && Number.isFinite(o.confidence) ? o.confidence : null,
        modelHint: String(o.modelHint ?? "heuristic:v1"),
        modelSource,
        features: feats,
        embeddings,
      });
    }

    const cats = [...new Set(items.map((i) => i.category))].sort();
    const summary =
      items.length === 0 ? "empty" : `${items.length} asset(s): ${cats.join(", ")}`;

    const deliverable = /** @type {DeliverableDocV2} */ ({
      schema: "claira.deliverable.v2",
      summary,
      items,
      aggregate: buildAggregate(items),
      intelligenceMeta: { providerWasActive },
    });

    context.dispatch("structured_output", "setDeliverable", deliverable);
    const mod = /** @type {{ state: { selectors: { getDeliverable: (s: unknown) => unknown } } }} */ (
      context.getModule("structured_output")
    );
    return {
      kind: "structured_output",
      deliverable: mod.state.selectors.getDeliverable(context.moduleState),
    };
  },
};

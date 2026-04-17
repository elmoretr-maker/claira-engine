/**
 * MVP — Image ingestion (input): records image references as assets tied to one entity (multi-asset capable).
 */

/** @typedef {{ id: string, label: string }} EntityRow */
/** @typedef {{ id: string, ref: string, entityId: string }} AssetRow */
/** @typedef {{ entities: EntityRow[], assets: AssetRow[] }} ImageInputSlice */

function stableHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

function stableEntityIdFromPaths(paths, label) {
  const key = [...paths].sort().join("|") + "\0" + label;
  return `ent_${stableHash(key)}`;
}

function assetIdFor(path, entityId) {
  return `asset_${stableHash(`${entityId}\0${path}`)}`;
}

/**
 * Normalize ingest payload to a list of non-empty paths.
 * Supports `paths: string[]` and legacy `imagePath: string`.
 * @param {{ paths?: unknown, imagePath?: unknown }} payload
 * @returns {string[]}
 */
function normalizePaths(payload) {
  if (Array.isArray(payload?.paths)) {
    return payload.paths.map((p) => String(p ?? "").trim()).filter(Boolean);
  }
  const one = String(payload?.imagePath ?? "").trim();
  return one ? [one] : [];
}

export const imageInputModule = {
  id: "image_input",
  label: "Image ingestion",
  description: "Accept image references and create linked asset records for one entity.",
  capabilities: ["ingest_image", "ingest_multi_asset"],
  modulePipelineType: "input",
  consumes: [],
  produces: [
    { kind: "asset", mode: "create" },
    { kind: "entity", mode: "create" },
  ],
  expectedContextVersion: 2,

  state: {
    /** @returns {ImageInputSlice} */
    initialize: () => ({ entities: [], assets: [] }),
    selectors: {
      /** @param {ImageInputSlice} s */
      snapshot: (s) => ({
        entities: Array.isArray(s?.entities) ? s.entities : [],
        assets: Array.isArray(s?.assets) ? s.assets : [],
      }),
    },
    reducers: {
      /**
       * @param {ImageInputSlice} s
       * @param {{ paths?: string[], imagePath?: string, entityLabel?: string }} payload
       */
      ingest: (s, payload) => {
        const paths = normalizePaths(payload ?? {});
        if (paths.length === 0) return s;
        const label =
          typeof payload?.entityLabel === "string" && payload.entityLabel.trim()
            ? payload.entityLabel.trim()
            : "Ingest target";
        const entityId = stableEntityIdFromPaths(paths, label);
        const entity = /** @type {EntityRow} */ ({ id: entityId, label });
        /** @type {AssetRow[]} */
        const assets = paths.map((ref) => ({
          id: assetIdFor(ref, entityId),
          ref,
          entityId,
        }));
        return {
          entities: [entity],
          assets,
        };
      },
    },
  },

  health: {
    /** @param {ImageInputSlice} s */
    check: (s) => {
      const assets = Array.isArray(s?.assets) ? s.assets : [];
      const ids = assets.map((a) => a.id);
      return ids.length === new Set(ids).size
        ? { status: "healthy", issues: [] }
        : { status: "warning", issues: ["Duplicate asset ids"] };
    },
  },

  ui: { components: [] },

  /**
   * @param {{ getModule: (id: string) => unknown, moduleState: unknown, getState: () => unknown, dispatch: Function }} context
   */
  execute: (context) => {
    const mod = /** @type {{ state: { selectors: { snapshot: (s: unknown) => unknown } } }} */ (
      context.getModule("image_input")
    );
    return {
      kind: "image_input",
      ...mod.state.selectors.snapshot(context.moduleState),
    };
  },
};

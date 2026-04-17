/**
 * Asset Registry — registry module (contract + isolated state + read-only health).
 */

/** @typedef {{ id: string, ref: string, name?: string }} AssetRow */

/** @typedef {{ assets: AssetRow[] }} AssetRegistrySlice */

export const assetRegistryModule = {
  id: "asset_registry",
  label: "Asset Registry",
  description: "Store file references",
  capabilities: ["add_asset", "list_assets"],
  modulePipelineType: "tracking",
  consumes: ["entity"],
  produces: [{ kind: "asset", mode: "create" }],
  expectedContextVersion: 2,

  state: {
    /** @returns {AssetRegistrySlice} */
    initialize: () => ({ assets: [] }),
    selectors: {
      /** @param {AssetRegistrySlice} s */
      listAssets: (s) => (Array.isArray(s?.assets) ? s.assets : []),
    },
    reducers: {
      /**
       * @param {AssetRegistrySlice} s
       * @param {{ id?: string, ref?: string, name?: string }} payload
       */
      add: (s, payload) => {
        const id = String(payload?.id ?? "").trim();
        const ref = String(payload?.ref ?? "").trim();
        if (!id || !ref) return s;
        const name = payload?.name != null ? String(payload.name) : undefined;
        const row = /** @type {AssetRow} */ ({ id, ref, ...(name !== undefined ? { name } : {}) });
        return { ...s, assets: [...(s.assets ?? []), row] };
      },
    },
  },

  health: {
    /** @param {AssetRegistrySlice} s */
    check: (s) => {
      const assets = Array.isArray(s?.assets) ? s.assets : [];
      const refs = assets.map((a) => a.ref);
      if (refs.length !== new Set(refs).size) {
        return { status: "warning", issues: ["Duplicate file references in module store"] };
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
    const mod = /** @type {{ state: { selectors: { listAssets: (s: unknown) => unknown[] } } }} */ (
      context.getModule("asset_registry")
    );
    const assets = mod.state.selectors.listAssets(context.moduleState);
    return {
      kind: "asset_registry",
      count: assets.length,
      assets,
    };
  },
};

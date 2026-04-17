/**
 * Phase 9/10 — Apply routing decisions to files (dry-run by default in browser; Node applies real moves via dynamic import).
 */

/**
 * @param {...string} parts
 * @returns {string}
 */
function joinUrlPath(...parts) {
  const segs = [];
  for (const p of parts) {
    const s = String(p ?? "")
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "");
    if (s) segs.push(s);
  }
  return segs.join("/");
}

/**
 * @param {string} p
 * @returns {string}
 */
function baseName(p) {
  const s = String(p).replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * @param {unknown} st
 * @returns {{ dryRun: boolean, destinationRoot: string }}
 */
function moverConfigFromState(st) {
  const raw =
    st != null && typeof st === "object" && "runtimePipelineConfig" in st
      ? /** @type {{ runtimePipelineConfig?: unknown }} */ (st).runtimePipelineConfig
      : null;
  const am =
    raw != null && typeof raw === "object" && !Array.isArray(raw) && "asset_mover" in raw
      ? /** @type {{ asset_mover?: unknown }} */ (raw).asset_mover
      : null;
  const cwdDefault =
    typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".";
  if (am != null && typeof am === "object" && am !== null) {
    const o = /** @type {{ dryRun?: unknown, destinationRoot?: unknown, cwd?: unknown }} */ (am);
    return {
      dryRun: o.dryRun !== false,
      destinationRoot:
        typeof o.destinationRoot === "string" && o.destinationRoot.trim()
          ? o.destinationRoot.trim()
          : "Assets",
      cwd: typeof o.cwd === "string" && o.cwd.trim() ? o.cwd.trim() : cwdDefault,
    };
  }
  return { dryRun: true, destinationRoot: "Assets", cwd: cwdDefault };
}

/**
 * @typedef {{
 *   assetId: string,
 *   sourceRef: string,
 *   destinationSimulated: string,
 *   dryRun: boolean,
 *   duplicateResolution?: string,
 * }} MoveLogEntry
 */

/**
 * @typedef {{
 *   kind: string,
 *   message: string,
 *   assetId: string,
 *   destinationSimulated: string,
 * }} MoveEventEntry
 */

/** @typedef {{
 *   config: { dryRun: boolean, destinationRoot: string, cwd?: string },
 *   moveLog: MoveLogEntry[],
 *   eventsEmitted: MoveEventEntry[],
 *   simulatedAssetRefs: Record<string, string>,
 *   fsOperationLog?: string[],
 * }} AssetMoverSlice */

export const assetMoverModule = {
  id: "asset_mover",
  label: "Asset mover",
  description: "Relocate assets per routing plan; default dry-run logs intended moves and duplicate handling.",
  capabilities: ["relocate", "dry_run_move"],
  modulePipelineType: "output",
  consumes: ["asset", "deliverable"],
  produces: [
    { kind: "event", mode: "create" },
    { kind: "asset", mode: "extend" },
  ],
  expectedContextVersion: 2,

  state: {
    /** @returns {AssetMoverSlice} */
    initialize: () => ({
      config: { dryRun: true, destinationRoot: "Assets", cwd: "." },
      moveLog: [],
      eventsEmitted: [],
      simulatedAssetRefs: {},
      fsOperationLog: [],
    }),
    selectors: {
      /** @param {AssetMoverSlice} s */
      snapshot: (s) => ({
        config: s?.config ?? { dryRun: true, destinationRoot: "Assets", cwd: "." },
        moveLog: Array.isArray(s?.moveLog) ? s.moveLog : [],
        eventsEmitted: Array.isArray(s?.eventsEmitted) ? s.eventsEmitted : [],
        simulatedAssetRefs:
          s?.simulatedAssetRefs != null && typeof s.simulatedAssetRefs === "object" && !Array.isArray(s.simulatedAssetRefs)
            ? { ...s.simulatedAssetRefs }
            : {},
        fsOperationLog: Array.isArray(s?.fsOperationLog) ? s.fsOperationLog : [],
      }),
    },
    reducers: {
      /**
       * @param {AssetMoverSlice} s
       * @param {Partial<AssetMoverSlice>} payload
       */
      applyResult: (s, payload) => {
        if (payload == null || typeof payload !== "object") return s;
        const p = /** @type {Partial<AssetMoverSlice>} */ (payload);
        return {
          ...s,
          ...(p.config != null && typeof p.config === "object"
            ? {
                config: {
                  dryRun: p.config.dryRun !== false,
                  destinationRoot:
                    typeof p.config.destinationRoot === "string" && p.config.destinationRoot.trim()
                      ? p.config.destinationRoot.trim()
                      : "Assets",
                  cwd:
                    typeof p.config.cwd === "string" && p.config.cwd.trim()
                      ? p.config.cwd.trim()
                      : s.config?.cwd ?? ".",
                },
              }
            : {}),
          moveLog: Array.isArray(p.moveLog) ? p.moveLog.map((x) => ({ ...x })) : s.moveLog,
          eventsEmitted: Array.isArray(p.eventsEmitted) ? p.eventsEmitted.map((x) => ({ ...x })) : s.eventsEmitted,
          simulatedAssetRefs:
            p.simulatedAssetRefs != null && typeof p.simulatedAssetRefs === "object" && !Array.isArray(p.simulatedAssetRefs)
              ? { ...p.simulatedAssetRefs }
              : s.simulatedAssetRefs,
          fsOperationLog: Array.isArray(p.fsOperationLog) ? [...p.fsOperationLog] : s.fsOperationLog ?? [],
        };
      },
    },
  },

  health: {
    check: (s) =>
      Array.isArray(s?.moveLog) && s.moveLog.length > 0
        ? { status: "healthy", issues: [] }
        : { status: "warning", issues: ["No moves recorded"] },
  },

  ui: { components: [] },

  /**
   * @param {{ getModule: (id: string) => unknown, moduleState: unknown, getState: () => unknown, dispatch: Function }} context
   */
  execute: async (context) => {
    const st = /** @type {{ moduleRuntimeState?: Record<string, unknown> }} */ (context.getState());
    const moverCfg = moverConfigFromState(context.getState());
    const isBrowser =
      typeof globalThis !== "undefined" &&
      typeof /** @type {{ window?: unknown }} */ (globalThis).window !== "undefined" &&
      /** @type {{ window?: unknown }} */ (globalThis).window === globalThis;
    let effectiveDryRun = moverCfg.dryRun;
    if (isBrowser) effectiveDryRun = true;

    const inputSlice = st.moduleRuntimeState?.image_input;
    const assetsRaw = /** @type {{ assets?: unknown }} */ (inputSlice)?.assets;
    const assets = Array.isArray(assetsRaw) ? assetsRaw : [];

    const routerSlice = st.moduleRuntimeState?.asset_router;
    const routing = /** @type {{ routing?: { items?: unknown } } | null } */ (routerSlice)?.routing;
    const routeItems = routing != null && Array.isArray(routing.items) ? routing.items : [];

    /** @type {Map<string, { destinationRelPath: string, userRenamedTo?: string }>} */
    const routeByAsset = new Map();
    for (const it of routeItems) {
      if (it == null || typeof it !== "object" || Array.isArray(it)) continue;
      const o = /** @type {{ assetId?: unknown, destinationRelPath?: unknown, userRenamedTo?: unknown }} */ (it);
      const aid = String(o.assetId ?? "");
      const dest = String(o.destinationRelPath ?? "").trim();
      const rename =
        typeof o.userRenamedTo === "string" && o.userRenamedTo.trim() ? baseName(String(o.userRenamedTo).trim()) : undefined;
      if (aid && dest) routeByAsset.set(aid, { destinationRelPath: dest, ...(rename ? { userRenamedTo: rename } : {}) });
    }

    /** @type {Record<string, number>} */
    const destCounts = {};

    /** @type {MoveLogEntry[]} */
    const moveLog = [];
    /** @type {MoveEventEntry[]} */
    const eventsEmitted = [];
    /** @type {Record<string, string>} */
    const simulatedAssetRefs = {};

    for (const row of assets) {
      if (row == null || typeof row !== "object" || Array.isArray(row)) continue;
      const asset = /** @type {{ id?: unknown, ref?: unknown, entityId?: unknown }} */ (row);
      const assetId = String(asset.id ?? "");
      const sourceRef = String(asset.ref ?? "");
      if (!assetId || !sourceRef) continue;

      const r = routeByAsset.get(assetId);
      if (r == null) continue;

      const base = r.userRenamedTo != null && String(r.userRenamedTo).trim() ? String(r.userRenamedTo).trim() : baseName(sourceRef);
      const relFolder = r.destinationRelPath;
      const keyStem = joinUrlPath(moverCfg.destinationRoot, relFolder, base);

      destCounts[keyStem] = (destCounts[keyStem] ?? 0) + 1;
      const n = destCounts[keyStem];
      let fileName = base;
      /** @type {string | undefined} */
      let duplicateResolution;
      if (n > 1) {
        const dot = base.lastIndexOf(".");
        const stem = dot > 0 ? base.slice(0, dot) : base;
        const ext = dot > 0 ? base.slice(dot) : "";
        fileName = `${stem}_${n - 1}${ext}`;
        duplicateResolution = `suffix_${n - 1}`;
      }

      const destinationSimulated = joinUrlPath(moverCfg.destinationRoot, relFolder, fileName);

      moveLog.push({
        assetId,
        sourceRef,
        destinationSimulated,
        dryRun: effectiveDryRun,
        ...(duplicateResolution ? { duplicateResolution } : {}),
      });

      simulatedAssetRefs[assetId] = destinationSimulated;

      eventsEmitted.push({
        kind: "asset_mover.file_relocated",
        message: effectiveDryRun
          ? `[dry-run] would move → ${destinationSimulated}`
          : `moved → ${destinationSimulated}`,
        assetId,
        destinationSimulated,
      });
    }

    /** @type {string[]} */
    const fsOperationLog = [];
    const isNode =
      typeof process !== "undefined" && typeof /** @type {{ versions?: { node?: string } }} */ (process).versions?.node === "string";

    if (!effectiveDryRun && isNode && moveLog.length > 0) {
      try {
        const href = new URL("../../watcher/assetMoverReal.mjs", import.meta.url).href;
        const { applyRealAssetMovesFromLog } = await import(/* @vite-ignore */ href);
        const out = applyRealAssetMovesFromLog({
          cwd: moverCfg.cwd,
          moveLog,
          onLog: (line) => {
            fsOperationLog.push(line);
          },
        });
        for (const row of out.applied) {
          eventsEmitted.push({
            kind: "asset_mover.fs_applied",
            message: `${row.from} -> ${row.to}`,
            assetId: row.assetId,
            destinationSimulated: row.to,
          });
        }
        for (const err of out.errors) {
          eventsEmitted.push({
            kind: "asset_mover.fs_error",
            message: err,
            assetId: "",
            destinationSimulated: "",
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        fsOperationLog.push(`[asset_mover] real move import/apply failed: ${msg}`);
        eventsEmitted.push({
          kind: "asset_mover.fs_error",
          message: msg,
          assetId: "",
          destinationSimulated: "",
        });
      }
    }

    context.dispatch("asset_mover", "applyResult", {
      config: { ...moverCfg, dryRun: effectiveDryRun },
      moveLog,
      eventsEmitted,
      simulatedAssetRefs,
      fsOperationLog,
    });

    const mod = /** @type {{ state: { selectors: { snapshot: (s: unknown) => unknown } } }} */ (
      context.getModule("asset_mover")
    );
    return {
      kind: "asset_mover",
      .../** @type {object} */ (mod.state.selectors.snapshot(context.moduleState)),
    };
  },
};

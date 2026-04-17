/**
 * Phase 10 — Watch a drop folder (default `New_Arrival`), debounce events, then run the full workflow pipeline.
 */

import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import { isSupportedImageFilename } from "../../adapters/supportedImages.js";

/**
 * @param {string} absPath
 * @param {Set<string>} out
 * @returns {Promise<void>}
 */
async function collectImagesUnder(absPath, out) {
  let st;
  try {
    st = await fsPromises.stat(absPath);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (isSupportedImageFilename(absPath)) out.add(path.resolve(absPath));
    return;
  }
  if (!st.isDirectory()) return;
  const entries = await fsPromises.readdir(absPath, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(absPath, e.name);
    if (e.isDirectory()) {
      await collectImagesUnder(full, out);
    } else if (e.isFile() && isSupportedImageFilename(e.name)) {
      out.add(path.resolve(full));
    }
  }
}

/**
 * @typedef {{
 *   cwd?: string,
 *   watchFolder?: string,
 *   destinationRoot?: string,
 *   autoProcess?: boolean,
 *   dryRun?: boolean,
 *   debounceMs?: number,
 *   onLog?: (line: string) => void,
 *   runPipeline?: (imagePaths: string[]) => Promise<unknown>,
 * }} FolderWatcherConfig
 */

/**
 * @param {FolderWatcherConfig} userConfig
 * @returns {{ stop: () => Promise<void>, watcher: import('chokidar').FSWatcher }}
 */
export function startFolderWatcher(userConfig = {}) {
  const cwd =
    typeof userConfig.cwd === "string" && userConfig.cwd.trim()
      ? path.resolve(userConfig.cwd.trim())
      : process.cwd();
  const watchRel = String(userConfig.watchFolder ?? "New_Arrival").trim() || "New_Arrival";
  const destinationRoot =
    String(userConfig.destinationRoot ?? "Assets").trim() || "Assets";
  const autoProcess = userConfig.autoProcess !== false;
  const dryRun = userConfig.dryRun === true;
  const debounceMs =
    typeof userConfig.debounceMs === "number" && userConfig.debounceMs >= 0
      ? userConfig.debounceMs
      : 450;

  const log =
    typeof userConfig.onLog === "function" ? userConfig.onLog : (line) => console.log(line);

  const absWatch = path.resolve(cwd, watchRel);
  fs.mkdirSync(absWatch, { recursive: true });

  const runPipeline =
    typeof userConfig.runPipeline === "function"
      ? userConfig.runPipeline
      : async (imagePaths) => {
          const { runAssetOrchestrationWatchPipeline } = await import(
            "../../engines/asset-orchestration-engine/runtime/runWatchPipeline.mjs"
          );
          return runAssetOrchestrationWatchPipeline({
            cwd,
            imagePaths,
            destinationRoot,
            dryRun,
          });
        };

  /** @type {Set<string>} */
  const pending = new Set();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let debounceTimer = null;
  let lastBatchKey = "";
  let lastBatchAt = 0;

  const flush = async () => {
    debounceTimer = null;
    const roots = [...pending];
    pending.clear();
    if (!autoProcess || roots.length === 0) return;

    /** @type {Set<string>} */
    const images = new Set();
    for (const r of roots) {
      await collectImagesUnder(r, images);
    }
    const imagePaths = [...images].sort();
    if (imagePaths.length === 0) return;

    const batchKey = imagePaths.join("\0");
    const now = Date.now();
    if (batchKey === lastBatchKey && now - lastBatchAt < 1800) {
      log(`[folderWatcher] skip duplicate batch (${imagePaths.length} image(s))`);
      return;
    }
    lastBatchKey = batchKey;
    lastBatchAt = now;

    log(`[folderWatcher] ${imagePaths.length} image(s) ready under ${absWatch}`);
    try {
      await runPipeline(imagePaths);
      log(`[folderWatcher] pipeline finished for ${imagePaths.length} file(s)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`[folderWatcher] pipeline error: ${msg}`);
    }
  };

  const scheduleFlush = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      flush().catch((e) => log(`[folderWatcher] flush error: ${e instanceof Error ? e.message : String(e)}`));
    }, debounceMs);
  };

  const watcher = chokidar.watch(absWatch, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
    depth: 30,
  });

  watcher.on("add", (p) => {
    pending.add(path.resolve(String(p)));
    scheduleFlush();
  });
  watcher.on("addDir", (p) => {
    pending.add(path.resolve(String(p)));
    scheduleFlush();
  });
  watcher.on("error", (err) => log(`[folderWatcher] watcher error: ${err instanceof Error ? err.message : String(err)}`));

  log(`[folderWatcher] watching ${absWatch} → destinationRoot=${destinationRoot} dryRun=${dryRun}`);

  return {
    watcher,
    stop: async () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      await watcher.close();
    },
  };
}

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  (async () => {
    const { loadRootEnv } = await import("../../server/loadRootEnv.mjs");
    loadRootEnv();

    const watchFolder = process.env.WATCH_FOLDER ?? "New_Arrival";
    const destinationRoot = process.env.DESTINATION_ROOT ?? "Assets";
    const autoProcess = process.env.AUTO_PROCESS !== "false";
    const dryRun = process.env.DRY_RUN === "true";
    const debounceMs = process.env.WATCH_DEBOUNCE_MS ? Number(process.env.WATCH_DEBOUNCE_MS) : undefined;

    startFolderWatcher({
      cwd: process.cwd(),
      watchFolder,
      destinationRoot,
      autoProcess,
      dryRun,
      ...(debounceMs != null && !Number.isNaN(debounceMs) ? { debounceMs } : {}),
    });

    console.log("[folderWatcher] running (Ctrl+C to stop)");
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

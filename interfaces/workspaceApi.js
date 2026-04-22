/**
 * Workspace API — isolated FS + sync (browser via Vite __claira/run).
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import {
  deriveWorkspaceScope,
  ensureContextDirs,
  getContextRoot,
  isPathInsideContext,
  sanitizeSegment,
} from "../engineWorkspace/workspacePaths.js";
import { scanProductFiles } from "../engineWorkspace/productScan.js";
import { loadStore, normRel } from "../engineWorkspace/metadataStore.js";
import { runSync, WorkspaceSyncError } from "../engineWorkspace/syncEngine.js";
import { loadGeneratorReadModel } from "../engineWorkspace/generatorConsumption.js";

/**
 * @param {{ accountId?: string, mode?: string, industry?: string }} input
 */
function parseContext(input = {}) {
  const rawAccount =
    typeof input.accountId === "string" && input.accountId.trim() ? input.accountId.trim() : "";
  const accountId = rawAccount ? sanitizeSegment(rawAccount) : "local";
  if (rawAccount && !accountId) {
    return {
      ok: false,
      error: "I can only use letters, numbers, dashes, and underscores in an account id—please adjust it.",
    };
  }
  const modeRaw = String(input.mode ?? "simulation").toLowerCase();
  const mode = modeRaw === "live" ? "live" : "simulation";
  const industry = sanitizeSegment(typeof input.industry === "string" ? input.industry : "");
  if (!industry) {
    return { ok: false, error: "I need an industry selected before I can open a workspace for you." };
  }
  const contextRoot = getContextRoot(accountId, /** @type {"live"|"simulation"} */ (mode), industry);
  const scope = deriveWorkspaceScope(resolve(contextRoot));
  if (!scope || scope.accountId !== accountId || scope.mode !== mode || scope.industry !== industry) {
    return {
      ok: false,
      error: "I couldn’t match this request to a single workspace folder—check industry and mode, then try again.",
    };
  }
  const { claira } = ensureContextDirs(contextRoot);
  return { ok: true, accountId, mode, industry, contextRoot, clairaDir: claira };
}

/**
 * @param {{ accountId?: string, mode?: string, industry?: string }} [input]
 */
export function workspaceScanApi(input = {}) {
  const ctx = parseContext(input);
  if (!ctx.ok) return ctx;
  const store = loadStore(ctx.clairaDir);
  const { items, categories } = scanProductFiles(ctx.contextRoot);
  const rows = items.map((it) => {
    const k = normRel(it.relPath);
    const id = store.pathToId[k] ?? "";
    const rec = id ? store.items[id] : null;
    return {
      id,
      relPath: k,
      category: it.category,
      basename: it.basename,
      attributes: rec?.attributes ?? {},
      needsReconcile: !id,
    };
  });
  return {
    ok: true,
    accountId: ctx.accountId,
    mode: ctx.mode,
    industry: ctx.industry,
    contextRoot: ctx.contextRoot,
    categories,
    items: rows,
    syncGeneration: store.syncGeneration,
  };
}

/**
 * @param {{ accountId?: string, mode?: string, industry?: string, operations?: unknown[] }} [input]
 */
export function workspaceSyncApi(input = {}) {
  const ctx = parseContext(input);
  if (!ctx.ok) return ctx;
  const operations = Array.isArray(input.operations) ? input.operations : [];
  try {
    const out = runSync(ctx.contextRoot, ctx.clairaDir, /** @type {import("../engineWorkspace/syncEngine.js").SyncOperation[]} */ (operations));
    const storeAfter = loadStore(ctx.clairaDir);
    return {
      ok: true,
      accountId: ctx.accountId,
      mode: ctx.mode,
      industry: ctx.industry,
      summary: out.summary,
      removedOrphanIds: out.removedOrphanIds ?? [],
      reconciledOnly: Boolean(out.reconciledOnly),
      syncGeneration: storeAfter.syncGeneration,
    };
  } catch (e) {
    if (e instanceof WorkspaceSyncError) {
      /** @type {Record<string, string>} */
      const itemErrors = {};
      for (const err of e.errors) {
        if (!err.itemId) continue;
        const line = err.fix ? `${err.message} — ${err.fix}` : err.message;
        const prev = itemErrors[err.itemId];
        itemErrors[err.itemId] = prev ? `${prev} | ${line}` : line;
      }
      return {
        ok: false,
        error: e.message,
        errors: e.errors,
        itemErrors,
        accountId: ctx.accountId,
        mode: ctx.mode,
        industry: ctx.industry,
      };
    }
    const rawMsg = e instanceof Error ? e.message : String(e);
    const friendly =
      rawMsg.startsWith("I ") || rawMsg.startsWith("I couldn") || rawMsg.startsWith("I don’t")
        ? rawMsg
        : `I couldn’t finish your update—here’s what went wrong: ${rawMsg}`;
    return {
      ok: false,
      error: friendly,
      errors: [
        {
          opIndex: 0,
          message: friendly,
          fix: "Tap Refresh, check the highlighted rows if any, then try Update again.",
        },
      ],
      accountId: ctx.accountId,
      mode: ctx.mode,
      industry: ctx.industry,
    };
  }
}

/**
 * Copy bytes into simulation workspace inbox only (never touch originals elsewhere).
 * @param {{ accountId?: string, industry?: string, files?: Array<{ name: string, base64: string }> }} input
 */
export function workspaceSimulationIngestApi(input = {}) {
  if (String(input.mode ?? "").toLowerCase() === "live") {
    return {
      ok: false,
      error:
        "Copy ingest is only for practice (simulation). Switch to practice mode, or add files directly under your live workspace folder.",
    };
  }
  const ctx = parseContext({ ...input, mode: "simulation" });
  if (!ctx.ok) return ctx;
  const files = Array.isArray(input.files) ? input.files : [];
  if (files.length === 0) return { ok: false, error: "I didn’t receive any files to copy—pick one or more, then try again." };
  if (files.length > 100) {
    return { ok: false, error: "That’s more than 100 files at once—I need you to split it into smaller batches." };
  }
  const inbox = join(ctx.contextRoot, "inbox");
  mkdirSync(inbox, { recursive: true });
  let n = 0;
  let skippedOversized = 0;
  let skippedEmpty = 0;
  for (const f of files) {
    const name = typeof f?.name === "string" ? f.name.replace(/[/\\]/g, "_").slice(0, 200) : "file.bin";
    const b64 = typeof f?.base64 === "string" ? f.base64 : "";
    const i = b64.indexOf("base64,");
    const raw = Buffer.from(i >= 0 ? b64.slice(i + 7) : b64, "base64");
    if (raw.length > 40 * 1024 * 1024) {
      skippedOversized += 1;
      continue;
    }
    if (raw.length === 0) {
      skippedEmpty += 1;
      continue;
    }
    const dest = join(inbox, name || `upload_${Date.now()}`);
    writeFileSync(dest, raw);
    if (!isPathInsideContext(ctx.contextRoot, dest)) {
      return {
        ok: false,
        error:
          "I couldn’t save a file outside your practice workspace—that path isn’t allowed. Nothing was copied.",
        skippedOversized,
        skippedEmpty,
      };
    }
    n += 1;
  }
  if (n === 0) {
    const parts = [];
    if (skippedOversized) parts.push(`${skippedOversized} over 40 MB`);
    if (skippedEmpty) parts.push(`${skippedEmpty} empty`);
    return {
      ok: false,
      error:
        parts.length > 0
          ? `I couldn’t copy any files (${parts.join("; ")}). Try smaller, non-empty files, or fewer at once.`
          : "I couldn’t copy anything from that selection.",
      skippedOversized,
      skippedEmpty,
    };
  }
  try {
    runSync(ctx.contextRoot, ctx.clairaDir, []);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      copied: n,
      accountId: ctx.accountId,
      industry: ctx.industry,
    };
  }
  return {
    ok: true,
    copied: n,
    skippedOversized,
    skippedEmpty,
    accountId: ctx.accountId,
    industry: ctx.industry,
    syncGeneration: loadStore(ctx.clairaDir).syncGeneration,
  };
}

/**
 * @param {{ accountId?: string, mode?: string, industry?: string }} [input]
 */
export function workspaceGeneratorSnapshotApi(input = {}) {
  const ctx = parseContext(input);
  if (!ctx.ok) return ctx;
  const model = loadGeneratorReadModel(ctx.clairaDir, {
    industry: ctx.industry,
    includeTemplateFallback: true,
  });
  if (!model.ok) {
    return {
      ok: false,
      code: model.code,
      error: model.error,
      accountId: ctx.accountId,
      mode: ctx.mode,
      industry: ctx.industry,
    };
  }
  return {
    ok: true,
    accountId: ctx.accountId,
    mode: ctx.mode,
    industry: ctx.industry,
    syncGeneration: model.store.syncGeneration,
    snapshot: model.snapshot,
    manifest: model.manifest,
    templateFallback: model.templateFallback,
    paths: model.paths,
  };
}

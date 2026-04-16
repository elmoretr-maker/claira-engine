/**
 * asset_registry module — backs onto workflow/trainer/assetStore for persistence (transition).
 */

import { appendTrainerAsset } from "../trainer/assetStore.js";
import { forEachIngestibleImageRow } from "./ingestRowWalk.js";

/**
 * @param {import("../moduleHost/sealedEngineOutput.js").SealedEngineOutput} snapshot
 * @param {{ entityId?: string, cwd?: string, executionId?: string }} ctx
 */
export function postPipelineAssetRegistry(snapshot, ctx) {
  const entityId = String(ctx?.entityId ?? "").trim();
  if (!entityId) return;

  const cwd = ctx.cwd ? String(ctx.cwd) : "";

  forEachIngestibleImageRow(snapshot, ({ filePath, classificationSummary, pipelineRowType }) => {
    appendTrainerAsset(entityId, {
      filePath,
      cwd: cwd || undefined,
      classificationSummary,
      pipelineRowType,
    });
  });
}

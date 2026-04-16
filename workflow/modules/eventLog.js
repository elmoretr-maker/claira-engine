/**
 * event_log module — backs onto workflow/trainer/eventStore for persistence (transition).
 */

import { appendTrainerEvent } from "../trainer/eventStore.js";
import { forEachIngestibleImageRow } from "./ingestRowWalk.js";

const ASSET_INGESTED = "image_ingested";

/**
 * @param {import("../moduleHost/sealedEngineOutput.js").SealedEngineOutput} snapshot
 * @param {{ entityId?: string, executionId?: string }} ctx
 */
export function postPipelineEventLog(snapshot, ctx) {
  const entityId = String(ctx?.entityId ?? "").trim();
  if (!entityId) return;

  forEachIngestibleImageRow(snapshot, ({ filePath, classificationSummary }) => {
    appendTrainerEvent(entityId, ASSET_INGESTED, {
      filePath,
      classificationSummary,
    });
  });
}

/**
 * Phase 7 slice validation: entity workflow, pipeline attach, stored classification, timeline.
 * Temporarily writes a strict packs/<active>/workflow_template.json, restores previous contents after.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readActivePackIndustry } from "../interfaces/packReference.js";
import { assertWorkflowTemplateContract } from "../workflow/validation/workflowTemplateContract.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const STRICT_FIXTURE_TEMPLATE = {
  templateId: "trainer_progress_v1",
  version: 1,
  label: "Progress tracking",
  modules: ["entity_tracking", "asset_registry", "event_log"],
  moduleOptions: {
    entity_tracking: {
      labels: { singular: "Client", plural: "Clients" },
    },
    uiSections: {
      entities: "Clients",
      activity: "Activity",
      addData: "Add data",
    },
    moduleLabels: {
      entity_tracking: "Clients",
      asset_registry: "Data input",
      event_log: "Activity",
    },
  },
  eventTypes: [{ type: "image_ingested", label: "Image ingested" }],
};

const slug = readActivePackIndustry();
if (!slug) {
  console.error("FAIL: no active pack (set config/active_pack.json industry).");
  process.exit(1);
}

const tmplPath = join(ROOT, "packs", slug, "workflow_template.json");
const had = existsSync(tmplPath);
const prev = had ? readFileSync(tmplPath, "utf8") : null;

const refPath = join(ROOT, "packs", slug, "reference.json");
if (!existsSync(refPath)) {
  console.error(`FAIL: missing ${refPath}`);
  process.exit(1);
}
const refPrev = readFileSync(refPath, "utf8");
let refObj;
try {
  refObj = JSON.parse(refPrev);
} catch {
  console.error("FAIL: reference.json is not valid JSON");
  process.exit(1);
}
if (!refObj || typeof refObj !== "object" || Array.isArray(refObj)) {
  console.error("FAIL: reference.json root must be an object");
  process.exit(1);
}
const packMeta = refObj.pack && typeof refObj.pack === "object" && !Array.isArray(refObj.pack) ? refObj.pack : {};
refObj.pack = { ...packMeta, workflowSource: "generated" };

assertWorkflowTemplateContract(STRICT_FIXTURE_TEMPLATE, `packs/${slug}/workflow_template.json`);
writeFileSync(tmplPath, `${JSON.stringify(STRICT_FIXTURE_TEMPLATE, null, 2)}\n`, "utf8");
writeFileSync(refPath, `${JSON.stringify(refObj, null, 2)}\n`, "utf8");

try {
  const { devAssertSealedEngineOutputImmutable } = await import("../workflow/moduleHost/sealedEngineOutput.js");
  devAssertSealedEngineOutputImmutable();

  const api = await import("../interfaces/api.js");
  const created = api.createTrainerClientApi({ displayName: "Phase7 validate" });
  if (!created.ok) throw new Error(created.error || "createTrainerClient failed");
  const clientId = created.client.id;

  const png = join(ROOT, "packs", "game-dev", "reference_assets", "images", "props", "synthetic_01.png");
  if (!existsSync(png)) throw new Error(`missing fixture image: ${png}`);

  const out = await api.processData(
    [
      {
        type: "image",
        data: { filePath: png },
        metadata: { source: "phase7_validate", originalName: "synthetic_01.png" },
      },
    ],
    { cwd: ROOT, workflowContext: { entityId: clientId } },
  );

  if (!Array.isArray(out.results) || out.results.length === 0) {
    throw new Error("expected pipeline results");
  }

  const snap = api.getTrainerClientApi({ entityId: clientId });
  if (!snap.ok) throw new Error(snap.error || "getTrainerClient failed");
  if (!Array.isArray(snap.assets) || snap.assets.length === 0) {
    throw new Error("expected stored assets");
  }
  if (!Array.isArray(snap.events) || !snap.events.some((e) => e && e.type === "image_ingested")) {
    throw new Error("expected image_ingested event");
  }
  const summary = snap.assets[0]?.classificationSummary;
  if (!summary || typeof summary !== "object") {
    throw new Error("expected classificationSummary on asset");
  }

  console.log("PASS phase7_validate", {
    pack: slug,
    clientId,
    assetCount: snap.assets.length,
    eventCount: snap.events.length,
    classificationKeys: Object.keys(summary),
  });
} finally {
  writeFileSync(refPath, refPrev, "utf8");
  if (prev !== null) writeFileSync(tmplPath, prev, "utf8");
  else {
    try {
      unlinkSync(tmplPath);
    } catch {
      /* ignore */
    }
  }
}

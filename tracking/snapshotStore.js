/**
 * Snapshots under tracking/snapshots/<entityId>/*.json
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { extractMeasurementsFromImage } from "./measurementExtract.js";
import { normalizeTrackingImage, safeUnlink } from "./imageNormalize.js";
import { ENTITIES_DIR, IMAGES_DIR, SNAPSHOTS_DIR, ensureTrackingDirs } from "./paths.js";
import { hydrateSnapshot } from "./snapshotShape.js";

/**
 * @param {string} entityId
 */
function entityExists(entityId) {
  return existsSync(join(ENTITIES_DIR, `${entityId}.json`));
}

/**
 * @param {string} entityId
 * @param {{ imageBase64?: string, manualMetrics?: Record<string, number>, categoryKey?: string, industrySlug?: string }} opts
 */
export async function addTrackingSnapshot(entityId, opts = {}) {
  ensureTrackingDirs();
  const eid = String(entityId ?? "").trim();
  if (!eid.startsWith("e_")) {
    return { ok: false, error: "Invalid entity id." };
  }
  if (!entityExists(eid)) {
    return { ok: false, error: "Entity not found." };
  }

  const snapId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const entitySnapDir = join(SNAPSHOTS_DIR, eid);
  mkdirSync(entitySnapDir, { recursive: true });

  /** @type {string | null} */
  let imagePath = null;
  const b64 = typeof opts.imageBase64 === "string" ? opts.imageBase64.trim() : "";
  /** @type {Record<string, unknown>} */
  let extractedSignals = {};

  if (b64) {
    const buf = Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const imgEntityDir = join(IMAGES_DIR, eid);
    mkdirSync(imgEntityDir, { recursive: true });
    const fname = `${snapId}.png`;
    const absFinal = join(imgEntityDir, fname);
    const absRaw = join(imgEntityDir, `${snapId}.raw.tmp`);
    writeFileSync(absRaw, buf);

    let normMeta;
    try {
      normMeta = await normalizeTrackingImage(absRaw, absFinal);
    } catch {
      safeUnlink(absRaw);
      return { ok: false, error: "Could not normalize image." };
    }
    safeUnlink(absRaw);
    imagePath = join("images", eid, fname).replace(/\\/g, "/");

    extractedSignals = await extractMeasurementsFromImage(
      absFinal,
      String(opts.categoryKey ?? ""),
      String(opts.industrySlug ?? ""),
      normMeta,
    );
  }

  const manual = opts.manualMetrics && typeof opts.manualMetrics === "object" ? opts.manualMetrics : {};

  /** @type {Record<string, unknown>} */
  const snapshot = {
    id: snapId,
    entityId: eid,
    timestamp: new Date().toISOString(),
    rawData: {
      imagePath,
      manualMetrics: manual,
    },
    extractedSignals,
  };
  writeFileSync(join(entitySnapDir, `${snapId}.json`), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  const hydrated = hydrateSnapshot(snapshot);
  return { ok: true, snapshot: hydrated ?? snapshot };
}

/**
 * @param {string} entityId
 */
export function listSnapshotsForEntity(entityId) {
  ensureTrackingDirs();
  const eid = String(entityId ?? "").trim();
  const dir = join(SNAPSHOTS_DIR, eid);
  if (!existsSync(dir)) return { ok: true, snapshots: [] };
  /** @type {unknown[]} */
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const h = s && typeof s === "object" ? hydrateSnapshot(s) : null;
      if (h) out.push(h);
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => ts(/** @type {{ timestamp?: string }} */ (a)) - ts(/** @type {{ timestamp?: string }} */ (b)));
  return { ok: true, snapshots: out };
}

/**
 * @param {{ timestamp?: string }} x
 */
function ts(x) {
  const t = Date.parse(String(x?.timestamp ?? ""));
  return Number.isFinite(t) ? t : 0;
}

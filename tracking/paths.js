import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Root directory for user-local tracking data (this module lives under /tracking). */
export const TRACKING_ROOT = __dirname;
export const ENTITIES_DIR = join(TRACKING_ROOT, "entities");
export const SNAPSHOTS_DIR = join(TRACKING_ROOT, "snapshots");
export const IMAGES_DIR = join(TRACKING_ROOT, "images");

export function ensureTrackingDirs() {
  for (const d of [ENTITIES_DIR, SNAPSHOTS_DIR, IMAGES_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

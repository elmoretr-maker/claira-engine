/**
 * Trainer workflow runtime paths (data/ is gitignored).
 */

import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TRAINER_ROOT = join(__dirname, "..", "..");
export const TRAINER_DATA_DIR = join(TRAINER_ROOT, "workflow", "trainer", "data");
export const TRAINER_CLIENTS_DIR = join(TRAINER_DATA_DIR, "clients");

export function ensureTrainerDataDirs() {
  mkdirSync(TRAINER_CLIENTS_DIR, { recursive: true });
}

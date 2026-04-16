/**
 * Phase 5: processData temp lifecycle — review rows keep a real file path under cwd/temp/claira_ingest_hold.
 */
import { readFileSync, existsSync, unlinkSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { processData } from "../interfaces/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const png = join(ROOT, "references", "props", "barrel.png");

const buf = readFileSync(png);
const item = {
  type: "image",
  data: { filePath: null, buffer: buf, url: null },
  metadata: { source: "phase5", originalName: "holdtest.png" },
};

const out = await processData([item], { cwd: ROOT, runtimeContext: {} });
const row = out.results[0];
const fp =
  row && typeof row === "object" && "filePath" in row && typeof row.filePath === "string"
    ? row.filePath
    : null;

const holdOk = fp != null && fp.includes("temp") && fp.includes("claira_ingest_hold");
const fileOk = fp != null && existsSync(fp);

console.log("Phase 5 processData row.filePath:", fp);
console.log("Path looks like ingest hold:", holdOk);
console.log("File exists after return:", fileOk);

const moved = row && typeof row === "object" && row.moved_to != null;
const reviewish =
  row &&
  typeof row === "object" &&
  (row.priority != null || row.reason != null || (row.place_card && row.place_card.decision === "review"));

if (row && typeof row === "object" && "ingest_hold_error" in row && row.ingest_hold_error != null) {
  console.error("FAIL: unexpected ingest_hold_error on happy path", row.ingest_hold_error);
  process.exit(1);
}

console.log("Row moved_to:", moved ? row.moved_to : null);
console.log("Review-ish row:", reviewish);

if (moved) {
  console.log("SKIP file existence (file was moved from temp, no hold copy expected).");
  process.exit(0);
}

if (!fileOk) {
  console.error("FAIL: review path should persist a copy under temp/claira_ingest_hold");
  process.exit(1);
}

try {
  unlinkSync(fp);
} catch {
  /* ignore */
}

console.log("Phase 5 validation PASS");
process.exit(0);

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetDeduplicationModule } from "../workflow/modules/capabilities/assetDeduplicationModule.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, "fixtures", "capabilities");
const buf = Buffer.from("same-bytes");

function assert(n, c) {
  if (!c) {
    console.error(`FAIL: ${n}`);
    process.exit(1);
  }
  console.log(`ok: ${n}`);
}

fs.mkdirSync(dir, { recursive: true });
const f1 = path.join(dir, "dup1.bin");
const f2 = path.join(dir, "dup2.bin");
fs.writeFileSync(f1, buf);
fs.writeFileSync(f2, buf);

const ctx = { intentCandidates: [], refinedCategory: null, inputData: { cwd: dir } };
const out = await assetDeduplicationModule.run({ paths: [f1, f2], cwd: dir }, ctx);
assert("duplicate group", Array.isArray(out.groups) && out.groups.length >= 1);

console.log("testAssetDeduplication: passed");

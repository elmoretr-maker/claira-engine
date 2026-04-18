import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { metadataExtractorModule } from "../workflow/modules/capabilities/metadataExtractorModule.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, "fixtures", "capabilities");
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function assert(n, c) {
  if (!c) {
    console.error(`FAIL: ${n}`);
    process.exit(1);
  }
  console.log(`ok: ${n}`);
}

fs.mkdirSync(dir, { recursive: true });
const p = path.join(dir, "meta.png");
fs.writeFileSync(p, PNG_1x1);

const out = await metadataExtractorModule.run(
  { sourcePath: p, cwd: dir },
  { intentCandidates: [], refinedCategory: null, inputData: { cwd: dir, sourcePath: p } },
);
assert("has dimensions", out.width === 1 && out.height === 1);
assert("has format", typeof out.format === "string");

console.log("testMetadataExtractor: passed");

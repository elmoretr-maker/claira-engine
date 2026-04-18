/**
 * Run: node dev/testImageDiff.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { imageDiffModule } from "../workflow/modules/capabilities/imageDiffModule.js";

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
const a = path.join(dir, "diff_a.png");
const b = path.join(dir, "diff_b.png");
fs.writeFileSync(a, PNG_1x1);
fs.writeFileSync(b, PNG_1x1);

const ctx = { intentCandidates: [], refinedCategory: null, inputData: { cwd: dir } };
const same = await imageDiffModule.run({ pathA: a, pathB: b, cwd: dir }, ctx);
assert("identical → difference ~0", typeof same?.differenceScore === "number" && same.differenceScore === 0);

const altPng = await sharp({
  create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
})
  .png()
  .toBuffer();
fs.writeFileSync(b, altPng);
const diff = await imageDiffModule.run({ pathA: a, pathB: b, cwd: dir }, ctx);
assert("different → score > 0", typeof diff?.differenceScore === "number" && diff.differenceScore > 0);

console.log("testImageDiff: passed");

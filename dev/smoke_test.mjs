/**
 * Smoke: analyze → placeCard → applyDecision → placeCard with learning_hint + session ledger
 * Run from package root: `node dev/smoke_test.mjs`
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  analyze,
  applyDecision,
  generatePlaceCard,
  generateSessionReport,
  loadEngineConfig,
  resetSessionLedger,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportPath = join(__dirname, "../data/session_report.json");

function vec3(x, y, z) {
  return new Float32Array([x, y, z]);
}

resetSessionLedger();

const byLabel = new Map([
  ["terrain", [vec3(1, 0, 0)]],
  ["prop", [vec3(0, 1, 0)]],
]);

const r1 = await analyze({
  inputEmbedding: vec3(0.9, 0.1, 0),
  referenceEmbeddingsByLabel: byLabel,
});
const pc1 = await generatePlaceCard(r1);
if (!pc1.placeCard || pc1.placeCard.predicted_label !== "terrain") {
  console.error("FAIL classify", pc1);
  process.exit(1);
}
if (pc1.placeCard.learning_hint) {
  console.error("FAIL unexpected hint before correction", pc1.placeCard);
  process.exit(1);
}

await applyDecision({
  predicted_label: "terrain",
  selected_label: "prop",
  confidence: 0.7,
});
await applyDecision({
  predicted_label: "terrain",
  selected_label: "prop",
  confidence: 0.71,
});
await applyDecision({
  predicted_label: "terrain",
  selected_label: "prop",
  confidence: 0.5,
  scope: "single",
});

const pc2 = await generatePlaceCard(r1);
const h = pc2.placeCard?.learning_hint;
if (!h || h.seen !== 2) {
  console.error("FAIL learning_hint after two global corrections (single scope should not add)", pc2);
  process.exit(1);
}

const cfg = loadEngineConfig();
cfg.categories.terrain = "/mutated";
if (cfg.categories.terrain === "/mutated") {
  const cfg2 = loadEngineConfig();
  if (cfg2.categories.terrain === "/mutated") {
    console.error("FAIL config should be immutable copy on reload");
    process.exit(1);
  }
}

const rep = generateSessionReport();
if (!rep.summary || rep.summary.totalProcessed !== 1) {
  console.error("FAIL session summary.totalProcessed", rep.summary);
  process.exit(1);
}
if (rep.summary.repeatedCorrectionPairs !== 1) {
  console.error("FAIL repeatedCorrectionPairs", rep.summary);
  process.exit(1);
}
if (!Array.isArray(rep.unresolvedItems) || !Array.isArray(rep.issues)) {
  console.error("FAIL report shape", rep);
  process.exit(1);
}
if (!existsSync(reportPath)) {
  console.error("FAIL session_report.json not written", reportPath);
  process.exit(1);
}
const disk = JSON.parse(readFileSync(reportPath, "utf8"));
if (disk.generatedAt !== rep.generatedAt) {
  console.error("FAIL disk report mismatch");
  process.exit(1);
}

console.log("claira-engine smoke OK");

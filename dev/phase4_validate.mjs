/**
 * Phase 4 reliability: learning paths, explicit failures, no silent drops.
 * Run: node dev/phase4_validate.mjs
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { applyDecision } from "../index.js";
import { persistReferenceLearning } from "../learning/addUserReference.js";
import { tunnelUploadStaged } from "../interfaces/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const gun = join(ROOT, "references", "weapons", "gun.png");
if (!existsSync(gun)) {
  console.error("need references/weapons/gun.png");
  process.exit(1);
}

const LABEL = "phase4test";
const COR_LABEL = "phase4cor";
const tmp = join(ROOT, "temp", "phase4_validate");
mkdirSync(tmp, { recursive: true });
const a = join(tmp, `a_${Date.now()}.png`);
const b = join(tmp, `b_${Date.now()}.png`);
copyFileSync(gun, a);
copyFileSync(gun, b);
const userLabelDir = join(ROOT, "references", "user", LABEL);
const userCorDir = join(ROOT, "references", "user", COR_LABEL);

try {
  const r1 = persistReferenceLearning(a, LABEL);
  const r2 = persistReferenceLearning(a, LABEL);
  if (!r1.ok) {
    console.error("FAIL first persist", r1);
    process.exit(1);
  }
  if (!r2.ok || !r2.skipped || r2.reason !== "duplicate_recent") {
    console.error("FAIL dedupe second persist", r2);
    process.exit(1);
  }
  console.log("TEST dedupe OK");

  const noFile = await applyDecision({
    predicted_label: "terrain",
    selected_label: COR_LABEL,
    scope: "global",
  });
  if (noFile.applied !== false || noFile.error !== "no_local_file") {
    console.error("FAIL global correction without filePath", noFile);
    process.exit(1);
  }
  console.log("TEST global correction no filePath → explicit error OK");

  const bad = await applyDecision({
    predicted_label: "terrain",
    selected_label: COR_LABEL,
    scope: "global",
    filePath: join(tmp, "nonexistent_file_xyz.png"),
  });
  if (bad.applied !== false || bad.error !== "not_found") {
    console.error("FAIL applyDecision missing file", bad);
    process.exit(1);
  }
  console.log("TEST missing file → not_found OK");

  const txtPath = join(tmp, "bad.txt");
  writeFileSync(txtPath, "x");
  const badExt = await applyDecision({
    predicted_label: "terrain",
    selected_label: COR_LABEL,
    scope: "global",
    filePath: txtPath,
  });
  if (badExt.applied !== false || badExt.error !== "unsupported_image_ext") {
    console.error("FAIL bad extension", badExt);
    process.exit(1);
  }
  console.log("TEST unsupported_image_ext OK");

  const corr = await applyDecision({
    predicted_label: "terrain",
    selected_label: COR_LABEL,
    scope: "global",
    filePath: b,
  });
  if (corr.applied !== true || !corr.referenceLearning?.ok) {
    console.error("FAIL global correction with valid file", corr);
    process.exit(1);
  }
  console.log("TEST global correction success OK");

  const ok = await applyDecision({
    predicted_label: LABEL,
    selected_label: LABEL,
    scope: "global",
    filePath: b,
  });
  if (ok.applied !== true || !ok.referenceLearning?.ok) {
    console.error("FAIL confirmation applyDecision", ok);
    process.exit(1);
  }
  console.log("TEST confirmation success OK");

  const tunnelBad = tunnelUploadStaged(LABEL, [{ name: "n.txt", base64: Buffer.from("x").toString("base64") }], {
    uploadTag: { type: "reference", category: LABEL },
  });
  if (tunnelBad.ok !== false || !Array.isArray(tunnelBad.referenceLearningFailures)) {
    console.error("FAIL tunnel should report referenceLearningFailures", tunnelBad);
    process.exit(1);
  }
  if (!tunnelBad.referenceLearningFailures.some((f) => f.reason === "unsupported_image_ext")) {
    console.error("FAIL tunnel failure reason", tunnelBad);
    process.exit(1);
  }
  console.log("TEST tunnel reference explicit failure OK");

  console.log("Phase 4 reliability validation PASS");
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    if (existsSync(userLabelDir)) rmSync(userLabelDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    if (existsSync(userCorDir)) rmSync(userCorDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Phase 2 validation: fresh loadRooms() on every route (no cachedRooms).
 * Restores rooms/prop/room.config.json after mutation.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { buildDestinations } from "../routing/router.js";
import { loadIndustryPack } from "../packs/loadIndustryPack.js";
import { runProcessFolderPipeline } from "../interfaces/processFolderPipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PROP_CFG = join(ROOT, "rooms", "prop", "room.config.json");

function bdProp() {
  return buildDestinations(
    {
      predicted_label: "prop",
      visualCosineTop3: [{ id: "prop", cosine: 0.95 }],
      confidence: 0.95,
    },
    {},
  );
}

console.log("=== TEST 1 — ROOM CHANGE (buildDestinations, same Node process) ===");
const d0 = bdProp().proposed_destination;
const raw = readFileSync(PROP_CFG, "utf8");
const cfg = JSON.parse(raw);
const origDest = cfg.destination;
cfg.destination = "assets/props_PHASE2_VERIFY";
writeFileSync(PROP_CFG, JSON.stringify(cfg, null, 2) + "\n", "utf8");
const d1 = bdProp().proposed_destination;
cfg.destination = origDest;
writeFileSync(PROP_CFG, JSON.stringify(cfg, null, 2) + "\n", "utf8");
const d2 = bdProp().proposed_destination;

console.log("before mutation:", d0);
console.log("after mutation: ", d1);
console.log("after restore: ", d2);
const test1Pass =
  d0 === "assets/props" && d1 === "assets/props_PHASE2_VERIFY" && d2 === "assets/props";
console.log("TEST 1 router reload PASS:", test1Pass);

console.log("\n=== TEST 1b — processFolder twice after room change (same process) ===");
/** Temporary room so game-dev CLIP label `characters` resolves to a destination (removed after test). */
const TEMP_ROOM_DIR = join(ROOT, "rooms", "_phase2_validate_char");
const TEMP_ROOM_CFG = join(TEMP_ROOM_DIR, "room.config.json");
const charImg = join(
  ROOT,
  "packs",
  "game-dev",
  "reference_assets",
  "images",
  "characters",
  "synthetic_01.png",
);
if (!existsSync(charImg)) throw new Error("missing characters synthetic image");

mkdirSync(TEMP_ROOM_DIR, { recursive: true });
writeFileSync(
  TEMP_ROOM_CFG,
  JSON.stringify(
    {
      name: "characters",
      destination: "assets/phase2_before",
      allow_auto: true,
      require_review_threshold: 0.5,
    },
    null,
    2,
  ) + "\n",
);

const testDirA = join(ROOT, "_phase2_val_a");
const testDirB = join(ROOT, "_phase2_val_b");
mkdirSync(testDirA, { recursive: true });
mkdirSync(testDirB, { recursive: true });
copyFileSync(charImg, join(testDirA, "x.png"));
copyFileSync(charImg, join(testDirB, "x.png"));

await loadIndustryPack("game-dev");
const outA = await runProcessFolderPipeline(testDirA, { cwd: ROOT, runtimeContext: {} });
const pcA = outA.results[0]?.place_card;
const destA = pcA && typeof pcA === "object" ? pcA.proposed_destination : null;
const labelA = pcA && typeof pcA === "object" ? (pcA.predicted_label ?? pcA.routing_label) : null;

const charCfg = JSON.parse(readFileSync(TEMP_ROOM_CFG, "utf8"));
charCfg.destination = "assets/phase2_after";
writeFileSync(TEMP_ROOM_CFG, JSON.stringify(charCfg, null, 2) + "\n", "utf8");

const outB = await runProcessFolderPipeline(testDirB, { cwd: ROOT, runtimeContext: {} });
const pcB = outB.results[0]?.place_card;
const destB = pcB && typeof pcB === "object" ? pcB.proposed_destination : null;
const labelB = pcB && typeof pcB === "object" ? (pcB.predicted_label ?? pcB.routing_label) : null;

rmSync(TEMP_ROOM_DIR, { recursive: true, force: true });

console.log("run A predicted / proposed_destination:", labelA, destA);
console.log("run B predicted / proposed_destination:", labelB, destB);
const test1bPass =
  labelA === "characters" &&
  labelB === "characters" &&
  destA === "assets/phase2_before" &&
  destB === "assets/phase2_after";
console.log("TEST 1b full pipeline sees new room dest PASS:", test1bPass);
if (!test1bPass) {
  console.log(
    "If labels differ from `characters`, CLIP/pack drift — inspect run A/B rows above.",
  );
}

console.log("\n=== TEST 2 — PACK SWITCH (routing still reads current rooms) ===");
await loadIndustryPack("game-dev");
const bdGame = buildDestinations(
  { predicted_label: "prop", visualCosineTop3: [{ id: "prop", cosine: 0.9 }], confidence: 0.9 },
  {},
);
await loadIndustryPack("ecommerce");
const bdEco = buildDestinations(
  { predicted_label: "prop", visualCosineTop3: [{ id: "prop", cosine: 0.9 }], confidence: 0.9 },
  {},
);
console.log("After game-dev load — prop destination:", bdGame.proposed_destination);
console.log("After ecommerce load — prop destination:", bdEco.proposed_destination);
const test2Pass = bdGame.proposed_destination === bdEco.proposed_destination;
console.log(
  "TEST 2 same room files (expected): destinations match:",
  test2Pass,
  "(pack switch does not duplicate ghost rooms)",
);

console.log("\n=== TEST 3 — MULTIPLE RUN CONSISTENCY (buildDestinations × 5) ===");
const outs = [];
for (let i = 0; i < 5; i++) {
  outs.push(bdProp().proposed_destination);
}
console.log("5 runs:", outs);
const test3Pass = outs.every((x) => x === outs[0]);
console.log("TEST 3 all equal:", test3Pass);

const allPass = test1Pass && test1bPass && test2Pass && test3Pass;
console.log("\n=== OVERALL ===");
console.log("Phase 2 validation:", allPass ? "PASS" : "FAIL");
await loadIndustryPack("game-dev");
console.log("(restored active pack: game-dev)");
process.exit(allPass ? 0 : 1);

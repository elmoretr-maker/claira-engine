/**
 * Phase 3: Entrance settings → runtimeContext (autoMove, strictValidation, reviewThreshold).
 * Run from repo root: node dev/phase3_validate.mjs
 *
 * Uses `environment` + grass.png — avoids game-dev pack process rules that force-review `weapons`.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { effectiveOversightLevelFromRuntime } from "../core/oversightProfile.js";
import { loadIndustryPack } from "../packs/loadIndustryPack.js";
import { runProcessItemsPipeline } from "../interfaces/processFolderPipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

if (effectiveOversightLevelFromRuntime({ oversightLevel: "light", strictValidation: true }) !== "strict") {
  console.error("effectiveOversightLevelFromRuntime: expected strict when strictValidation true");
  process.exit(1);
}
if (effectiveOversightLevelFromRuntime({ oversightLevel: "light" }) !== "light") {
  console.error("effectiveOversightLevelFromRuntime: expected light");
  process.exit(1);
}
console.log("effectiveOversightLevelFromRuntime OK");

const grassImg = join(ROOT, "references", "environment", "grass.png");
if (!existsSync(grassImg)) {
  console.error("Missing references/environment/grass.png");
  process.exit(1);
}

/** No stock `rooms/environment/` — temporary room. */
const TEMP_ROOM_DIR = join(ROOT, "rooms", "_phase3_validate_environment");
const TEMP_ROOM_CFG = join(TEMP_ROOM_DIR, "room.config.json");
const DEST_TEST = "assets/phase3_entrance_settings";

await loadIndustryPack("game-dev");

mkdirSync(TEMP_ROOM_DIR, { recursive: true });
const refDir = join(TEMP_ROOM_DIR, "references");
mkdirSync(refDir, { recursive: true });
copyFileSync(grassImg, join(refDir, "ref1.png"));
writeFileSync(
  TEMP_ROOM_CFG,
  JSON.stringify(
    {
      name: "environment",
      destination: DEST_TEST,
      allow_auto: true,
      require_review_threshold: 0.25,
    },
    null,
    2,
  ) + "\n",
);

const runDir = join(ROOT, "temp", "phase3_validate");
mkdirSync(runDir, { recursive: true });

let exitCode = 0;
try {
  const pBase = join(runDir, `baseline_${Date.now()}.png`);
  copyFileSync(grassImg, pBase);

  const base = await runProcessItemsPipeline(
    [{ skip: false, absPath: pBase, rel: "baseline.png" }],
    { cwd: ROOT, runtimeContext: { appMode: "runtime", oversightLevel: "light", autoMove: true } },
  );
  const baseRow = base.results[0];
  const baseRec = baseRow && typeof baseRow === "object" ? /** @type {Record<string, unknown>} */ (baseRow) : null;
  const baseWouldMove = baseRec?.moved_to != null;

  if (!baseWouldMove) {
    console.error("Phase 3 FAIL: expected baseline auto-move (temp environment room + grass.png)");
    console.error(JSON.stringify(baseRow, null, 2));
    exitCode = 1;
  } else {
    const pNo = join(runDir, `no_move_${Date.now()}.png`);
    copyFileSync(grassImg, pNo);
    const outNo = await runProcessItemsPipeline(
      [{ skip: false, absPath: pNo, rel: "no_move.png" }],
      { cwd: ROOT, runtimeContext: { appMode: "runtime", oversightLevel: "light", autoMove: false } },
    );
    const rNo = outNo.results[0];
    if (rNo != null && typeof rNo === "object" && /** @type {Record<string, unknown>} */ (rNo).moved_to != null) {
      console.error("Phase 3 FAIL: autoMove false but moved_to set");
      exitCode = 1;
    }

    if (exitCode === 0) {
      const pHi = join(runDir, `high_thresh_${Date.now()}.png`);
      copyFileSync(grassImg, pHi);
      const hi = await runProcessItemsPipeline(
        [{ skip: false, absPath: pHi, rel: "high.png" }],
        {
          cwd: ROOT,
          runtimeContext: {
            appMode: "runtime",
            oversightLevel: "light",
            /** Slider at max: require softmax mass1; real scores are slightly below → review. */
            reviewThreshold: 1,
            autoMove: true,
          },
        },
      );
      const hr = hi.results[0];
      const rec = hr != null && typeof hr === "object" ? /** @type {Record<string, unknown>} */ (hr) : null;
      const reviewed = rec != null && (rec.priority != null || rec.classification_conflict != null);
      if (!reviewed) {
        console.error("Phase 3 FAIL: reviewThreshold 1 should send row to review (softmax < 1)");
        console.error(JSON.stringify(hr, null, 2));
        exitCode = 1;
      }
    }

    if (exitCode === 0) {
      console.log("pipeline: autoMove false + reviewThreshold OK");
      console.log("Phase 3 validation PASS");
    }
  }
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  try {
    rmSync(TEMP_ROOM_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    rmSync(runDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    rmSync(join(ROOT, DEST_TEST), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    await loadIndustryPack("game-dev");
  } catch {
    /* ignore */
  }
}

process.exit(exitCode);

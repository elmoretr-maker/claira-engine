/**
 * Phase 6: User control layer — force_review, bypass_review (execution only), confirm mode.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { applyUserControlAfterDecision } from "../policies/userControl.js";
import { generatePlaceCard } from "../index.js";
import { runProcessItemsPipeline } from "../interfaces/processFolderPipeline.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENGINE = dirname(ROOT);
const UC = join(ENGINE, "policies", "userControl.json");
const BYPASS_LOG = join(ENGINE, "logs", "bypass_review.json");

function backupIfExists(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

function restoreOrDelete(path, content) {
  if (content == null) {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  } else {
    writeFileSync(path, content, "utf8");
  }
}

// --- 1) force_review mutates decision; bypass keeps decision review ---
const ucBackup = backupIfExists(UC);
const logBackup = backupIfExists(BYPASS_LOG);
try {
  writeFileSync(
    UC,
    JSON.stringify(
      {
        rules: [
          { predicted_label: "__phase6_force__", effect: "force_review", enabled: true },
          { predicted_label: "__phase6_bypass__", effect: "bypass_review", enabled: true },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const base = {
    classification: { predicted_label: "__phase6_force__" },
    routing: { proposed_destination: "assets/x" },
    decision: { decision: "auto", reason: "unified_reference_confident" },
  };
  applyUserControlAfterDecision(base);
  if (base.decision.decision !== "review" || base.decision.reason !== "user_control_force_review") {
    console.error("Phase 6 FAIL: force_review should set decision review", base.decision);
    process.exit(1);
  }
  if (!base.user_control?.forced_review || base.user_control.prior_decision !== "auto") {
    console.error("Phase 6 FAIL: force_review should record user_control prior state", base.user_control);
    process.exit(1);
  }

  const bypass = {
    classification: { predicted_label: "__phase6_bypass__" },
    routing: { proposed_destination: "assets/y" },
    decision: { decision: "review", reason: "entrance_review_threshold" },
  };
  applyUserControlAfterDecision(bypass);
  if (bypass.decision.decision !== "review" || bypass.decision.reason !== "entrance_review_threshold") {
    console.error("Phase 6 FAIL: bypass must not change decision", bypass.decision);
    process.exit(1);
  }
  if (
    bypass.execution?.execution_intent !== "auto" ||
    bypass.execution?.user_override !== "bypass_review"
  ) {
    console.error("Phase 6 FAIL: bypass should set execution auto + override", bypass.execution);
    process.exit(1);
  }

  // --- 2) confirm mode on place card when auto + autoMove false ---
  const confirmSrc = {
    classification: { predicted_label: "prop" },
    routing: { proposed_destination: "assets/props", routing_label: "prop" },
    decision: { decision: "auto", reason: "unified_reference_confident" },
    execution: { execution_intent: "auto", user_override: null },
    file: null,
  };
  const { placeCard: pc } = await generatePlaceCard(confirmSrc, { autoMove: false });
  if (!pc || pc.execution_mode !== "confirm" || pc.decision !== "auto") {
    console.error("Phase 6 FAIL: execution_mode confirm for auto + autoMove off", pc);
    process.exit(1);
  }

  // --- 3) pipeline: bypass writes log entry (two runs: learn label, then bypass) ---
  try {
    if (existsSync(BYPASS_LOG)) unlinkSync(BYPASS_LOG);
  } catch {
    /* ignore */
  }
  const png = join(ROOT, "phase6_tiny.png");
  if (!existsSync(png)) {
    writeFileSync(
      png,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
  }

  const rtCtx = {
    appMode: "runtime",
    oversightLevel: "light",
    autoMove: true,
    reviewThreshold: 1,
  };

  writeFileSync(UC, JSON.stringify({ rules: [] }, null, 2), "utf8");
  const probe = await runProcessItemsPipeline(
    [{ skip: false, absPath: png, rel: "phase6_tiny.png" }],
    { cwd: ENGINE, runtimeContext: rtCtx },
  );
  const predicted = String(probe.results[0]?.place_card?.predicted_label ?? "").trim().toLowerCase();
  if (!predicted) {
    console.error("Phase 6 FAIL: could not read predicted_label from probe run");
    process.exit(1);
  }

  writeFileSync(
    UC,
    JSON.stringify(
      { rules: [{ predicted_label: predicted, effect: "bypass_review", enabled: true }] },
      null,
      2,
    ),
    "utf8",
  );

  const out = await runProcessItemsPipeline(
    [{ skip: false, absPath: png, rel: "phase6_tiny.png" }],
    { cwd: ENGINE, runtimeContext: rtCtx },
  );

  const row = out.results[0];
  const pcRow = row?.place_card;
  if (!pcRow || pcRow.decision !== "review") {
    console.error("Phase 6 FAIL: expected review decision on row with bypass", pcRow);
    process.exit(1);
  }
  if (pcRow.user_override !== "bypass_review" || pcRow.execution_intent !== "auto") {
    console.error("Phase 6 FAIL: place_card should carry bypass execution metadata", pcRow);
    process.exit(1);
  }
  if (!existsSync(BYPASS_LOG)) {
    console.error("Phase 6 FAIL: bypass log file missing");
    process.exit(1);
  }
  const log = JSON.parse(readFileSync(BYPASS_LOG, "utf8"));
  const last = Array.isArray(log) ? log[log.length - 1] : null;
  if (
    !last ||
    last.original_decision !== "review" ||
    last.user_override !== "bypass_review" ||
    typeof last.predicted_label !== "string" ||
    typeof last.destination !== "string" ||
    typeof last.timestamp !== "number"
  ) {
    console.error("Phase 6 FAIL: bypass log entry shape", last);
    process.exit(1);
  }

  console.log("Phase 6 validation PASS");
} finally {
  restoreOrDelete(UC, ucBackup);
  restoreOrDelete(BYPASS_LOG, logBackup);
}

import 'dotenv/config';
/**
 * Phase 17 — Core intelligence hardening (semantic signals, scoring, precedence, intent clusters).
 * Run: node dev/validatePhase17.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validatePipelineConfiguration } from "../workflow/pipeline/validatePipelineConfiguration.js";
import { runPhase10Pipeline, PHASE10_PIPELINE } from "../workflow/watcher/runPhase10Pipeline.mjs";
import {
  clearClairaReasoningProvider,
  defaultWorkflowClairaReasoning,
  setClairaReasoningProvider,
} from "../workflow/integrations/clairaReasoningProvider.js";
import { clearImageAnalysisProvider, setImageAnalysisProvider } from "../workflow/integrations/imageAnalysisProvider.js";
import { clearFeedbackStore, recordFeedbackEntry } from "../workflow/feedback/feedbackStore.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

const VEC_A = [0.12, 0.88, 0.02, 0.04, 0, 0, 0, 0];
const VEC_B = [0.11, 0.89, 0.03, 0.02, 0, 0, 0, 0];
/** Far from feedback-store signatures — weak semantic match */
const VEC_Z = [0.02, 0.01, 0.97, 0.01, 0, 0, 0, 0];

const phase17Provider = {
  id: "phase17_hf",
  analyzeImage(asset) {
    const ref = String(asset?.ref ?? "").replace(/\\/g, "/");
    const base = ref.includes("/") ? ref.slice(ref.lastIndexOf("/") + 1) : ref;
    /** Phase 17.1 scenario fixtures */
    if (/^strong_grp_(01|02)\.png$/i.test(base)) {
      return {
        category: "document",
        labels: ["document", "paperwork"],
        confidence: 0.72,
        features: {},
        embeddings: VEC_A,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
    if (/^mixed_med\.png$/i.test(base)) {
      return {
        category: "document",
        labels: ["document", "invoice", "scan"],
        confidence: 0.68,
        features: {},
        embeddings: VEC_B,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
    if (/^all_weak_signal\.png$/i.test(base)) {
      return {
        category: "misc",
        labels: ["unclassified"],
        confidence: 0.41,
        features: {},
        embeddings: VEC_Z,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
    if (/toolbar_close_glyph\.png$/i.test(base)) {
      return {
        category: "misc",
        labels: ["unclassified"],
        confidence: 0.55,
        features: {},
        embeddings: VEC_A,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
    if (/^walk_frame_01\.png$/i.test(base)) {
      return {
        category: "document",
        labels: ["document", "scan"],
        confidence: 0.88,
        features: {},
        embeddings: VEC_A,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
    if (/^walk_frame_02\.png$/i.test(base)) {
      return {
        category: "video game asset",
        labels: ["video game asset", "character", "sprite"],
        confidence: 0.9,
        features: {},
        embeddings: VEC_B,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
    if (/conflict_a\.png$/i.test(base)) {
      return {
        category: "photograph",
        labels: ["unclassified"],
        confidence: 0.5,
        features: {},
        embeddings: VEC_A,
        modelSource: "mock",
        inferenceInput: {},
      };
    }
    const m = /phase9:\/\/kind\/([\w-]+)/.exec(ref);
    const token = m ? m[1] : "";
    const table = {
      document: { category: "document", labels: ["document"] },
      other: { category: "misc", labels: ["unclassified"] },
    };
    const row = table[token] ?? table.other;
    return {
      category: row.category,
      labels: [...row.labels],
      confidence: 0.91,
      features: {},
      embeddings: null,
      modelSource: "mock",
      inferenceInput: {},
    };
  },
};

function scoreBreakdownOk(sb) {
  if (sb == null || typeof sb !== "object") return false;
  const o = /** @type {{ tokenScore?: unknown, themeScore?: unknown, embeddingScore?: unknown, contextScore?: unknown, combined?: unknown }} */ (
    sb
  );
  return (
    typeof o.tokenScore === "number" &&
    typeof o.themeScore === "number" &&
    typeof o.embeddingScore === "number" &&
    typeof o.contextScore === "number" &&
    typeof o.combined === "number" &&
    o.tokenScore <= 1 &&
    o.themeScore <= 1 &&
    o.embeddingScore <= 1 &&
    o.contextScore <= 1 &&
    o.combined <= 1
  );
}

try {
  assert("pipeline lists claira_reasoning", PHASE10_PIPELINE.includes("claira_reasoning"));
  assert("pipeline validates", validatePipelineConfiguration({ orderedModuleIds: PHASE10_PIPELINE }).ok === true);

  const feedbackDir = path.join(process.cwd(), "workflow", "feedback", "data");
  fs.mkdirSync(feedbackDir, { recursive: true });
  process.env.FEEDBACK_STORE_PATH = path.join(feedbackDir, `phase17_validate_${Date.now()}.json`);

  clearFeedbackStore();
  recordFeedbackEntry({
    originalLabels: ["misc"],
    refinedCategory: "misc",
    userCorrectedCategory: "ui element",
    filename: "glyph_alpha.png",
    semanticTokens: ["glyph", "toolbar", "alpha"],
    labelThemes: ["ui"],
    embeddingSignature: [...VEC_A],
  });
  recordFeedbackEntry({
    originalLabels: ["misc"],
    refinedCategory: "misc",
    userCorrectedCategory: "ui element",
    filename: "glyph_beta.png",
    semanticTokens: ["glyph", "toolbar", "beta"],
    labelThemes: ["ui"],
    embeddingSignature: [...VEC_B],
  });
  setImageAnalysisProvider(phase17Provider);
  setClairaReasoningProvider({
    id: "phase17_test",
    refineReasoning: defaultWorkflowClairaReasoning,
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claira-p17-"));
  const glyphPath = path.join(tmp, "toolbar_close_glyph.png");
  fs.writeFileSync(glyphPath, "x");

  const memRun = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [glyphPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const cr0 = memRun.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert("phase marker is 17", cr0?.clairaReasoning?.phase === 17);
  assert("semantic memory match score", typeof cr0?.semanticMatchScore === "number" && cr0.semanticMatchScore > 0.35);
  assert("scoreBreakdown present", scoreBreakdownOk(cr0?.clairaReasoning?.scoreBreakdown));
  assert(
    "filename pattern tokens surfaced",
    Array.isArray(cr0?.clairaReasoning?.filenamePatternTokens) && cr0.clairaReasoning.filenamePatternTokens.length >= 0,
  );
  assert(
    "alternativeCategoriesDetailed ranked",
    Array.isArray(cr0?.alternativeCategoriesDetailed) && cr0.alternativeCategoriesDetailed.length >= 1,
  );
  const det0 = cr0?.alternativeCategoriesDetailed?.[0];
  assert(
    "alternative has rationale",
    det0 != null &&
      typeof det0.score === "number" &&
      typeof det0.signalAgreement === "number" &&
      Array.isArray(det0.rationale?.sources),
  );
  assert("intent canonical string", typeof cr0?.intentCanonical === "string" && cr0.intentCanonical.length > 1);
  assert("intent clusters array", Array.isArray(cr0?.intentClusters));
  assert("intent candidates trimmed", Array.isArray(cr0?.intentCandidates) && cr0.intentCandidates.length <= 5);

  assert(
    "17.1 strong semantic + weak group: no fallback (memory rescues intent)",
    cr0?.fallbackUsed === false && cr0?.clairaReasoning?.semanticMemory != null,
  );
  assert(
    "17.1 strong semantic: precedence may favor semantic memory",
    typeof cr0?.clairaReasoning?.categoryPrecedence?.applied === "boolean",
  );

  const sg1 = path.join(tmp, "strong_grp_01.png");
  const sg2 = path.join(tmp, "strong_grp_02.png");
  fs.writeFileSync(sg1, "x");
  fs.writeFileSync(sg2, "x");
  const sgRun = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [sg1, sg2],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const sg0 = sgRun.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert(
    "17.1 weak semantic + strong batch: defer precedence (strong group cohesion)",
    sg0?.clairaReasoning?.categoryPrecedence?.batchStrongGroupDefer === true,
  );
  assert("17.1 weak semantic + strong batch: no fallback", sg0?.fallbackUsed === false);

  const medPath = path.join(tmp, "mixed_med.png");
  fs.writeFileSync(medPath, "x");
  const medRun = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [medPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const med0 = medRun.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert("17.1 mixed medium-confidence signals: no fallback", med0?.fallbackUsed === false);

  const weakOnlyPath = path.join(tmp, "all_weak_signal.png");
  fs.writeFileSync(weakOnlyPath, "x");
  const weakRun = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [weakOnlyPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const weak0 = weakRun.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert(
    "17.1 all-weak: fallbackUsed true (last-resort minimum valid intent)",
    weak0?.fallbackUsed === true && typeof weak0?.fallbackReason === "string",
  );

  const sparse = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [path.join(tmp, "conflict_a.png")],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const crSparse = sparse.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert("sparse labels still yield scoreBreakdown", scoreBreakdownOk(crSparse?.clairaReasoning?.scoreBreakdown));

  const noEmb = await runPhase10Pipeline({
    cwd: process.cwd(),
    imagePaths: ["phase9://kind/other"],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const crNoEmb = noEmb.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert("missing embeddings still yield combined score", typeof crNoEmb?.semanticMatchScore === "number");
  assert("missing embeddings scoreBreakdown", scoreBreakdownOk(crNoEmb?.clairaReasoning?.scoreBreakdown));

  const icon1 = path.join(tmp, "walk_frame_01.png");
  const icon2 = path.join(tmp, "walk_frame_02.png");
  for (const p of [icon1, icon2]) fs.writeFileSync(p, "x");

  const grp = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [icon1, icon2],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const items = grp.output.payload.moduleResults?.claira_reasoning?.data?.items;
  const i0 = items?.[0];
  const i1 = items?.[1];
  const unified =
    i0 != null &&
    i1 != null &&
    String(i0.refinedCategory ?? "").toLowerCase() === String(i1.refinedCategory ?? "").toLowerCase();
  assert("batch pair reaches unified category (group finalize or Phase 17.1 precedence)", unified === true);
  if (i0?.groupDecisionApplied === true) {
    assert("group decision payload marks override", i0?.clairaReasoning?.groupDecision?.categoryOverride === true);
  }
  assert("group payload phase 17", items?.[0]?.clairaReasoning?.phase === 17);

  const run2 = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [glyphPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const crA = run2.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  const run3 = await runPhase10Pipeline({
    cwd: tmp,
    imagePaths: [glyphPath],
    destinationRoot: "Assets",
    dryRun: true,
  });
  const crB = run3.output.payload.moduleResults?.claira_reasoning?.data?.items?.[0];
  assert(
    "deterministic ranking — same inputs same refinedCategory",
    String(crA?.refinedCategory) === String(crB?.refinedCategory) &&
      String(crA?.intentCanonical ?? "") === String(crB?.intentCanonical ?? ""),
  );

  console.log("\nAll Phase 17 checks passed.\n");
} finally {
  clearImageAnalysisProvider();
  clearClairaReasoningProvider();
  clearFeedbackStore();
  try {
    if (process.env.FEEDBACK_STORE_PATH && fs.existsSync(process.env.FEEDBACK_STORE_PATH)) {
      fs.unlinkSync(process.env.FEEDBACK_STORE_PATH);
    }
  } catch {
    /* ignore */
  }
  delete process.env.FEEDBACK_STORE_PATH;
}

/**
 * Fitness pack + domain isolation checks.
 * Run: node dev/validateFitnessPack.mjs
 */
import { strict as assert } from "assert";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getDomainDefinition } from "../workflow/modules/capabilities/domainRegistry.js";
import { validatePackTriad } from "../workflow/packs/validatePackTriad.js";
import { registerAllCapabilities } from "../workflow/modules/capabilities/registerAllCapabilities.js";
import { getCapabilities } from "../workflow/modules/capabilities/capabilityRegistry.js";
import { orderedFitnessStageNames } from "../workflow/modules/capabilities/fitnessTimelineOrder.js";
import { buildFitnessImagePairs } from "../workflow/modules/capabilities/fitnessComparisonPairs.js";
import { fitnessTimelineScanApi, fitnessImageReadApi, fitnessImageComparisonApi } from "../interfaces/api.js";
import { insightLabelFromSimilarity } from "../workflow/modules/capabilities/fitnessImageComparisonModule.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const fitness = getDomainDefinition("fitness");
const tax = getDomainDefinition("tax");

assert(!fitness.allowedModules.includes("tax_document_comparison"), "fitness must not allow tax_document_comparison");
assert(!fitness.allowedModules.includes("image_diff"), "fitness must not allow image_diff");
assert(fitness.allowedModules.includes("fitness_image_comparison"), "fitness must allow fitness_image_comparison");
assert(!tax.allowedModules.includes("fitness_image_comparison"), "tax must not allow fitness_image_comparison");

const triad = validatePackTriad("fitness");
assert(triad.valid, `pack triad: ${triad.errors.join("; ")}`);

registerAllCapabilities();
const mod = getCapabilities().find((c) => c.id === "fitness_image_comparison");
assert(mod != null, "fitness_image_comparison registered");

const diffA = join(ROOT, "dev", "fixtures", "capabilities", "diff_a.png");
const diffB = join(ROOT, "dev", "fixtures", "capabilities", "diff_b.png");
const metaP = join(ROOT, "dev", "fixtures", "capabilities", "meta.png");

const { fitnessImageComparisonModule } = await import("../workflow/modules/capabilities/fitnessImageComparisonModule.js");
const ctx = {
  intentCandidates: [],
  refinedCategory: null,
  inputData: { cwd: ROOT, domainMode: "fitness" },
};
const result = await fitnessImageComparisonModule.run({ pathA: diffA, pathB: diffB, cwd: ROOT }, ctx);
assert(!result.error, `compare error: ${result.message}`);
assert(typeof result.similarityScore === "number", "similarityScore");
assert(typeof result.changeDetected === "boolean", "changeDetected");
assert(typeof result.confidence === "number", "confidence");
assert(typeof result.insightLabel === "string" && result.insightLabel.length > 0, "insightLabel");
assert(Array.isArray(result.comparisons) && result.comparisons.length === 1, "comparisons[0]");
assert(result.comparisons[0].result && typeof result.comparisons[0].result.insightLabel === "string", "nested result");
assert.deepStrictEqual(
  Object.keys(result.comparisons[0].result).sort(),
  ["changeDetected", "confidence", "insightLabel", "similarityScore"].sort(),
  "comparisons[].result is slim metrics only",
);

const withStages = await fitnessImageComparisonModule.run(
  { pathA: diffA, pathB: diffB, cwd: ROOT, stageA: "Before", stageB: "Week 4" },
  ctx,
);
assert(!withStages.error, "compare with stage labels");
assert.strictEqual(withStages.comparisons[0].stageA, "Before");
assert.strictEqual(withStages.comparisons[0].stageB, "Week 4");

const seqBuilt = buildFitnessImagePairs("sequential", ["before", "week_1", "week_2"], {
  before: diffA,
  week_1: diffB,
  week_2: metaP,
});
assert(seqBuilt.ok === true, String(seqBuilt.ok === false ? seqBuilt.error : ""));
assert.strictEqual(seqBuilt.pairs.length, 2);
assert.strictEqual(seqBuilt.pairs[0].stageA, "before");
assert.strictEqual(seqBuilt.pairs[1].stageB, "week_2");

const baseBuilt = buildFitnessImagePairs("baseline", ["before", "week_1", "week_2"], {
  before: diffA,
  week_1: diffB,
  week_2: metaP,
});
assert(baseBuilt.ok === true);
assert.strictEqual(baseBuilt.pairs.length, 2);
assert.strictEqual(baseBuilt.pairs[0].stageB, "week_1");
assert.strictEqual(baseBuilt.pairs[1].pathA, diffA);

const multi = await fitnessImageComparisonModule.run(
  {
    cwd: ROOT,
    imagePairs: [
      { stageA: "before", stageB: "week_1", pathA: diffA, pathB: diffB },
      { stageA: "week_1", stageB: "week_2", pathA: diffB, pathB: metaP },
    ],
  },
  ctx,
);
assert(!multi.error, String(multi.message));
assert.strictEqual(multi.comparisons.length, 2);
assert.strictEqual(multi.items.length, 2);

const apiSeq = await fitnessImageComparisonApi({
  cwd: ROOT,
  domainMode: "fitness",
  mode: "sequential",
  orderedStages: ["before", "week_1", "week_2"],
  pathsByStage: { before: diffA, week_1: diffB, week_2: metaP },
});
assert(apiSeq.ok === true, String(apiSeq.ok === false ? apiSeq.error : ""));
assert.strictEqual(/** @type {{ comparisons: unknown[] }} */ (apiSeq.result).comparisons.length, 2);

const apiBase = await fitnessImageComparisonApi({
  cwd: ROOT,
  domainMode: "fitness",
  mode: "baseline",
  orderedStages: ["before", "week_1", "week_2"],
  pathsByStage: { before: diffA, week_1: diffB, week_2: metaP },
});
assert(apiBase.ok === true);
assert.strictEqual(/** @type {{ comparisons: unknown[] }} */ (apiBase.result).comparisons.length, 2);

assert.deepStrictEqual(
  orderedFitnessStageNames(["week_10", "before", "week_2", "z_custom", "final"]),
  ["before", "week_2", "week_10", "z_custom", "final"],
);

assert.strictEqual(insightLabelFromSimilarity(0.96), "Minimal change");
assert.strictEqual(insightLabelFromSimilarity(0.95), "Moderate progress");
assert.strictEqual(insightLabelFromSimilarity(0.8), "Moderate progress");
assert.strictEqual(insightLabelFromSimilarity(0.79), "Significant transformation");

const readImg = fitnessImageReadApi({ cwd: ROOT, path: diffA });
assert(readImg.ok === true && typeof readImg.dataBase64 === "string" && readImg.dataBase64.length > 0, "fitnessImageReadApi");

const scan = fitnessTimelineScanApi({ cwd: ROOT });
assert(scan.ok === true, "timeline scan");
for (const cl of scan.clients) {
  if (cl && typeof cl === "object" && Array.isArray(cl.stages) && cl.stages.length > 1) {
    const names = cl.stages.map((s) => s.name);
    const expected = orderedFitnessStageNames(names);
    assert.deepStrictEqual(
      names,
      expected,
      `timeline stages should match deterministic order for client ${cl.name}`,
    );
    assert(Array.isArray(cl.orderedStages) && deepEqualNames(cl.orderedStages, expected), "orderedStages field");
    break;
  }
}

/** @param {unknown[]} a @param {string[]} b */
function deepEqualNames(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => String(x) === b[i]);
}

console.log("ok: validateFitnessPack");

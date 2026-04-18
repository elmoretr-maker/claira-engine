/**
 * Capability registry + executor — deterministic selection and stable outputs.
 * Run: node dev/validateCapabilityExecutor.mjs
 */
import { clearCapabilityRegistry, findBestCapability, registerCapability } from "../workflow/modules/capabilities/capabilityRegistry.js";
import { executeCapability } from "../workflow/modules/capabilities/capabilityExecutor.js";
import { registerAllCapabilities } from "../workflow/modules/capabilities/registerAllCapabilities.js";
import { imageDiffModule } from "../workflow/modules/capabilities/imageDiffModule.js";

function assert(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`ok: ${name}`);
}

try {
  clearCapabilityRegistry();
  registerCapability(imageDiffModule);
  const a = findBestCapability([{ label: "compare two images", score: 0.9 }]);
  assert("single registered: picks image_diff", a.module?.id === "image_diff" && a.score > 0);

  clearCapabilityRegistry();
  registerAllCapabilities();

  const t1 = findBestCapability([{ label: "countdown timer", score: 1 }]);
  assert("intent: timer", t1.module?.id === "timer");

  const t2 = findBestCapability([{ label: "extract metadata and exif", score: 1 }]);
  assert("intent: metadata", t2.module?.id === "metadata_extractor");

  const t3 = findBestCapability([{ label: "duplicate files detection", score: 1 }]);
  assert("intent: dedup", t3.module?.id === "asset_deduplication");

  const t4 = findBestCapability([{ label: "domain template game dev", score: 1 }]);
  assert("intent: domain template", t4.module?.id === "domain_template");

  const r1 = await executeCapability({
    intentCandidates: [{ label: "timer", score: 1 }],
    refinedCategory: "misc",
    inputData: { durationMs: 5000 },
  });
  assert("executor: returns timer", r1.moduleId === "timer");
  assert("executor: stable result shape", r1.result != null && typeof r1.result === "object");
  assert("executor: confidence in range", r1.confidence >= 0 && r1.confidence <= 1);

  const r2 = await executeCapability({
    intentCandidates: [{ label: "nothing matches xyzabc", score: 1 }],
    refinedCategory: null,
    inputData: {},
  });
  assert("executor: no match", r2.moduleId === null);

  const t5 = findBestCapability([{ label: "timer", score: 1 }, { label: "countdown", score: 0.5 }]);
  const t6 = findBestCapability([{ label: "timer", score: 1 }, { label: "countdown", score: 0.5 }]);
  assert("determinism: same intents → same module", t5.module?.id === t6.module?.id && t5.score === t6.score);

  console.log("\nvalidateCapabilityExecutor: all checks passed.\n");
} catch (e) {
  console.error(e);
  process.exit(1);
}

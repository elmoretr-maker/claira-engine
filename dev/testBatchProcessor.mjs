import { batchProcessorModule } from "../workflow/modules/capabilities/batchProcessorModule.js";

function assert(n, c) {
  if (!c) {
    console.error(`FAIL: ${n}`);
    process.exit(1);
  }
  console.log(`ok: ${n}`);
}

const out = batchProcessorModule.run(
  { paths: ["/tmp/a.png", "/tmp/b.png"], cwd: "/" },
  {
    intentCandidates: [],
    refinedCategory: "texture",
    inputData: { cwd: "/" },
  },
);
assert("simulation", out.simulation === true && Array.isArray(out.operations) && out.operations.length === 2);

console.log("testBatchProcessor: passed");

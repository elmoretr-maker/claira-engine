import { reviewModule } from "../workflow/modules/capabilities/reviewModule.js";

function assert(n, c) {
  if (!c) {
    console.error(`FAIL: ${n}`);
    process.exit(1);
  }
  console.log(`ok: ${n}`);
}

const low = reviewModule.run(
  { reviewThreshold: 0.9, reasoningConfidence: 0.3 },
  { intentCandidates: [], refinedCategory: null, inputData: { reasoningConfidence: 0.3 } },
);
assert("low conf requires review", low.requiresReview === true);

const high = reviewModule.run(
  { reviewThreshold: 0.5, reasoningConfidence: 0.9 },
  { intentCandidates: [], refinedCategory: null, inputData: { reasoningConfidence: 0.9 } },
);
assert("high conf ok", high.requiresReview === false);

console.log("testReview: passed");

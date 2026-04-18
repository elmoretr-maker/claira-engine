import { timerModule } from "../workflow/modules/capabilities/timerModule.js";

function assert(n, c) {
  if (!c) {
    console.error(`FAIL: ${n}`);
    process.exit(1);
  }
  console.log(`ok: ${n}`);
}

const a = timerModule.run({ durationMs: 12000 }, { intentCandidates: [], refinedCategory: null, inputData: {} });
const b = timerModule.run({ durationMs: 12000 }, { intentCandidates: [], refinedCategory: null, inputData: {} });
assert("deterministic", JSON.stringify(a) === JSON.stringify(b));
assert("duration", a.durationMs === 12000);

console.log("testTimer: passed");

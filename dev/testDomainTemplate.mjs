import { domainTemplateModule } from "../workflow/modules/capabilities/domainTemplateModule.js";

function assert(n, c) {
  if (!c) {
    console.error(`FAIL: ${n}`);
    process.exit(1);
  }
  console.log(`ok: ${n}`);
}

const g = domainTemplateModule.run(
  {},
  {
    intentCandidates: [{ label: "game sprite texture", score: 1 }],
    refinedCategory: "game_asset",
    inputData: {},
  },
);
assert("game preset", g.preset === "game-dev" && Array.isArray(g.selectedModules));

const b = domainTemplateModule.run(
  { preset: "business" },
  { intentCandidates: [], refinedCategory: null, inputData: {} },
);
assert("forced business", b.preset === "business");

console.log("testDomainTemplate: passed");

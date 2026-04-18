import { taggingModule } from "../workflow/modules/capabilities/taggingModule.js";

function assert(n, c) {
  if (!c) {
    console.error(`FAIL: ${n}`);
    process.exit(1);
  }
  console.log(`ok: ${n}`);
}

const out = taggingModule.run(
  {},
  {
    intentCandidates: [{ label: "keyword tags", score: 1 }],
    refinedCategory: "icon",
    inputData: {},
  },
);
assert("tags non-empty", Array.isArray(out.tags) && out.tags.length > 0);

console.log("testTagging: passed");

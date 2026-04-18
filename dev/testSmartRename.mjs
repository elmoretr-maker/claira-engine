import { smartRenameModule } from "../workflow/modules/capabilities/smartRenameModule.js";

function assert(n, c) {
  if (!c) {
    console.error(`FAIL: ${n}`);
    process.exit(1);
  }
  console.log(`ok: ${n}`);
}

const out = smartRenameModule.run(
  {},
  {
    intentCandidates: [{ label: "rename", score: 1 }],
    refinedCategory: "logo",
    inputData: {},
  },
);
assert("suggested filename", typeof out.suggestedFilename === "string" && out.suggestedFilename.includes("logo"));

console.log("testSmartRename: passed");

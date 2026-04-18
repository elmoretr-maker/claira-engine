import { folderStructureModule } from "../workflow/modules/capabilities/folderStructureModule.js";

function assert(n, c) {
  if (!c) {
    console.error(`FAIL: ${n}`);
    process.exit(1);
  }
  console.log(`ok: ${n}`);
}

const out = folderStructureModule.run(
  { rootFolder: "out/assets" },
  { intentCandidates: [], refinedCategory: "sprite_sheet", inputData: {} },
);
assert("folder path", typeof out.suggestedFolderPath === "string" && out.suggestedFolderPath.includes("sprite"));

console.log("testFolderStructure: passed");

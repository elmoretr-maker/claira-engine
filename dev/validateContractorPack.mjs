/**
 * General Contractor pack: registry, scan, compare reuse, cost module, isolation.
 * Run: node dev/validateContractorPack.mjs
 */
import { strict as assert } from "assert";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { getAllPackRegistryEntries } from "../workflow/packs/packRegistry.js";
import { getDomainDefinition } from "../workflow/modules/capabilities/domainRegistry.js";
import { validatePackTriad } from "../workflow/packs/validatePackTriad.js";
import { registerAllCapabilities } from "../workflow/modules/capabilities/registerAllCapabilities.js";
import { getCapabilities } from "../workflow/modules/capabilities/capabilityRegistry.js";
import {
  contractorTimelineScanApi,
  contractorCostTrackingApi,
  receiptAddApi,
  receiptListApi,
  fitnessImageComparisonApi,
} from "../interfaces/api.js";
import { buildContractorCombinedInsight } from "../workflow/modules/capabilities/contractorCombinedInsight.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const contractor = getDomainDefinition("contractor");
const tax = getDomainDefinition("tax");
const fitness = getDomainDefinition("fitness");

assert(contractor.id === "contractor");
assert(!contractor.allowedModules.includes("tax_document_comparison"), "contractor must not allow tax modules");
assert(!tax.allowedModules.includes("contractor_cost_tracking"), "tax must not allow contractor_cost_tracking");
assert(!fitness.allowedModules.includes("contractor_cost_tracking"), "fitness must not allow contractor_cost_tracking");
assert(contractor.allowedModules.includes("fitness_image_comparison"), "contractor reuses fitness_image_comparison");
assert(contractor.allowedModules.includes("contractor_cost_tracking"));
assert(contractor.allowedModules.includes("receipt_tracking"), "contractor allows shared receipt module");

const triad = validatePackTriad("contractor");
assert(triad.valid, `pack triad: ${triad.errors.join("; ")}`);

const packRow = getAllPackRegistryEntries().find((p) => p.id === "contractor");
assert(packRow != null && packRow.domainMode === "contractor", "packRegistry contractor row");

registerAllCapabilities();
assert(getCapabilities().some((c) => c.id === "contractor_cost_tracking"), "cost module registered");
assert(getCapabilities().some((c) => c.id === "receipt_tracking"), "receipt module registered");

const diffA = join(ROOT, "dev", "fixtures", "capabilities", "diff_a.png");
const diffB = join(ROOT, "dev", "fixtures", "capabilities", "diff_b.png");

const tmp = mkdtempSync(join(tmpdir(), "claira-contractor-"));
try {
  const beforeDir = join(tmp, "Projects", "Smith_House", "Rooms", "Kitchen", "Timeline", "before");
  const w1Dir = join(tmp, "Projects", "Smith_House", "Rooms", "Kitchen", "Timeline", "week_1");
  const completeDir = join(tmp, "Projects", "Smith_House", "Rooms", "Kitchen", "Timeline", "complete");
  mkdirSync(beforeDir, { recursive: true });
  mkdirSync(w1Dir, { recursive: true });
  mkdirSync(completeDir, { recursive: true });
  copyFileSync(diffA, join(beforeDir, "a.png"));
  copyFileSync(diffB, join(w1Dir, "b.png"));
  copyFileSync(diffB, join(completeDir, "c.png"));

  const pngB64 = readFileSync(diffA).toString("base64");
  const addRec = await receiptAddApi({
    cwd: tmp,
    vendor: "Fixture Supply",
    amount: 3500,
    date: "2026-04-01",
    note: "validate",
    imageBase64: `data:image/png;base64,${pngB64}`,
    filename: "receipt.png",
    tags: {
      domain: "contractor",
      path: ["Smith_House", "Phase_1", "Framing"],
      assignee: "Alex",
    },
  });
  assert(addRec.ok === true, String(addRec.ok === false ? addRec.error : ""));
  const nestedDir = join(tmp, "receipts", "contractor", "smith_house", "phase_1", "framing", "alex");
  assert(existsSync(nestedDir), `expected nested receipt dir: ${nestedDir}`);
  const listed = receiptListApi({ cwd: tmp, tags: { project: "Smith_House" } });
  assert(listed.ok === true && Array.isArray(listed.receipts) && listed.receipts.length === 1, "receipt list");
  assert.strictEqual(/** @type {{ total: number }} */ (listed).total, 3500);

  const scan = contractorTimelineScanApi({ cwd: tmp });
  assert(scan.ok === true, String(scan.ok === false ? scan.error : ""));
  const plist = /** @type {{ name: string, rooms: unknown[] }[]} */ (scan.projects);
  assert.strictEqual(plist.length, 1);
  assert.strictEqual(plist[0].name, "Smith_House");
  const rooms = /** @type {{ name: string, stages: { name: string }[] }[]} */ (plist[0].rooms);
  assert(rooms.length >= 1);
  const kitchen = rooms.find((r) => r.name === "Kitchen");
  assert(kitchen != null && kitchen.stages.length >= 2, "kitchen should have ordered stages");

  const cost = await contractorCostTrackingApi({
    cwd: tmp,
    project: "Smith_House",
    initialCost: 1000,
    manualSpendSupplement: 0,
  });
  assert(cost.ok === true, String(cost.ok === false ? cost.error : ""));
  const cr = /** @type {{ delta: number, overBudget: boolean, receiptTotal: number | null, currentCost: number }} */ (
    cost.result
  );
  assert.strictEqual(cr.receiptTotal, 3500);
  assert.strictEqual(cr.currentCost, 3500);
  assert.strictEqual(cr.overBudget, true);
  assert(cr.delta > 0);

  mkdirSync(join(tmp, "Projects", "Empty_Project"), { recursive: true });
  const costNoReceipts = await contractorCostTrackingApi({
    cwd: tmp,
    project: "Empty_Project",
    initialCost: 5000,
    currentCost: 6200,
  });
  assert(costNoReceipts.ok === true);
  const crL = /** @type {{ currentCost: number }} */ (costNoReceipts.result);
  assert.strictEqual(crL.currentCost, 6200);

  const cmp = await fitnessImageComparisonApi({
    cwd: tmp,
    domainMode: "contractor",
    mode: "single",
    pathA: join(beforeDir, "a.png"),
    pathB: join(w1Dir, "b.png"),
    stageA: "before",
    stageB: "week_1",
  });
  assert(cmp.ok === true, String(cmp.ok === false ? cmp.error : ""));
  const insight = /** @type {{ insightLabel?: string }} */ (cmp.result);
  assert(typeof insight.insightLabel === "string" && insight.insightLabel.length > 0);

  const badTax = await fitnessImageComparisonApi({
    cwd: tmp,
    domainMode: "tax",
    mode: "single",
    pathA: join(beforeDir, "a.png"),
    pathB: join(w1Dir, "b.png"),
  });
  assert(badTax.ok === false, "tax domain must not use fitness compare API");

  const line = buildContractorCombinedInsight({
    roomLabel: "Kitchen",
    insightLabel: "Significant transformation",
    overBudget: true,
    budgetDelta: 3500,
    percentChange: 14,
  });
  assert(line.includes("significant visual progress"), line);
  assert(line.includes("exceeded budget"), line);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("ok: validateContractorPack");

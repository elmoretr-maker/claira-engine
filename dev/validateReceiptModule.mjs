/**
 * Shared receipt module (domain-agnostic storage + capability).
 * Run: node dev/validateReceiptModule.mjs
 */
import { strict as assert } from "assert";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { registerAllCapabilities } from "../workflow/modules/capabilities/registerAllCapabilities.js";
import { getCapabilities } from "../workflow/modules/capabilities/capabilityRegistry.js";
import { receiptAddApi, receiptListApi } from "../interfaces/api.js";
import { receiptModule } from "../workflow/modules/capabilities/receiptModule.js";
import { calculateReceiptTotal, listReceipts } from "../workflow/modules/capabilities/receiptStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const samplePng = join(ROOT, "dev", "fixtures", "capabilities", "diff_a.png");

registerAllCapabilities();
const mod = getCapabilities().find((c) => c.id === "receipt_tracking");
assert(mod != null, "receipt_tracking registered");

const tmp = mkdtempSync(join(tmpdir(), "claira-receipt-"));
try {
  const pngB64 = readFileSync(samplePng).toString("base64");
  const added = await receiptAddApi({
    cwd: tmp,
    vendor: "Global Test Co",
    amount: 42.5,
    date: "2026-01-15",
    note: "standalone",
    imageBase64: `data:image/png;base64,${pngB64}`,
    filename: "r.png",
    tags: { project: "P1", room: "Office", category: "supplies" },
  });
  assert(added.ok === true, String(added.ok === false ? added.error : ""));

  const listed = receiptListApi({ cwd: tmp });
  assert(listed.ok === true && /** @type {{ receipts: unknown[] }} */ (listed).receipts.length === 1);

  const filtered = receiptListApi({ cwd: tmp, tags: { category: "supplies" } });
  assert(
    filtered.ok === true && /** @type {{ receipts: unknown[] }} */ (filtered).receipts.length === 1,
    "tag filter",
  );

  const sum = calculateReceiptTotal(listReceipts(tmp));
  assert.strictEqual(sum, 42.5);

  const ctx = { intentCandidates: [], refinedCategory: null, inputData: { cwd: tmp } };
  const listRun = receiptModule.run({ action: "list" }, ctx);
  assert(listRun && typeof listRun === "object" && /** @type {{ ok?: boolean }} */ (listRun).ok === true);
  const totalRun = receiptModule.run({ action: "total", tags: { project: "P1" } }, ctx);
  assert(
    totalRun && typeof totalRun === "object" && /** @type {{ total?: number }} */ (totalRun).total === 42.5,
  );

  const png2 = readFileSync(samplePng).toString("base64");
  const nested = await receiptAddApi({
    cwd: tmp,
    vendor: "Nested Co",
    amount: 10,
    date: "2026-02-01",
    note: "nested",
    imageBase64: `data:image/png;base64,${png2}`,
    filename: "n.png",
    tags: {
      domain: "contractor",
      path: ["P1", "SubA", "SecB"],
      assignee: "Pat",
    },
  });
  assert(nested.ok === true, String(nested.ok === false ? nested.error : ""));
  const byAssignee = receiptListApi({ cwd: tmp, tags: { domain: "contractor", assignee: "Pat" } });
  assert(byAssignee.ok === true && /** @type {{ receipts: unknown[] }} */ (byAssignee).receipts.length === 1);
  const sum2 = calculateReceiptTotal(listReceipts(tmp));
  assert.strictEqual(sum2, 52.5);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("ok: validateReceiptModule");

/**
 * Contractor project persistence + report export.
 * Run: node dev/validateContractorProjectPersistence.mjs
 */
import { strict as assert } from "assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";
import {
  exportProjectPdfApi,
  exportProjectReportApi,
  generateShareLinkApi,
  listProjectsApi,
  loadProjectApi,
  receiptAddApi,
  saveProjectApi,
} from "../interfaces/api.js";
import { buildAssigneeAlerts } from "../workflow/modules/capabilities/contractorAssigneeAlerts.js";
import { buildAssigneePerformanceRows } from "../workflow/modules/capabilities/contractorPerformanceShared.js";
import { listReceipts } from "../workflow/modules/capabilities/receiptStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePng = join(__dirname, "fixtures", "capabilities", "diff_a.png");

const tmp = mkdtempSync(join(tmpdir(), "claira-contractor-proj-"));
try {
  const pngB64 = readFileSync(samplePng).toString("base64");
  const addRec = await receiptAddApi({
    cwd: tmp,
    vendor: "T",
    amount: 2000,
    date: "2026-05-01",
    note: "",
    imageBase64: `data:image/png;base64,${pngB64}`,
    filename: "r.png",
    tags: {
      domain: "contractor",
      path: ["Acme_House", "Kitchen", "week_1"],
      assignee: "sam",
    },
  });
  assert(addRec.ok === true);

  const saved = saveProjectApi({
    cwd: tmp,
    name: "Acme_House",
    budget: 50000,
  });
  assert(saved.ok === true);
  const slug = /** @type {{ project: { slug: string } }} */ (saved).project.slug;
  assert(existsSync(join(tmp, "projects", slug, "project.json")));

  const listed = listProjectsApi({ cwd: tmp });
  assert(listed.ok === true && /** @type {{ projects: unknown[] }} */ (listed).projects.length === 1);

  const loaded = loadProjectApi({ cwd: tmp, slug });
  assert(loaded.ok === true);
  const p = /** @type {{ project: { name: string, budget: number, assignees: string[] } }} */ (loaded).project;
  assert.strictEqual(p.name, "Acme_House");
  assert.strictEqual(p.budget, 50000);
  assert(p.assignees.includes("sam"));

  const report = await exportProjectReportApi({ cwd: tmp, project: "Acme_House" });
  assert(report.ok === true);
  const rep = /** @type {{ report: { totalCost: number, alerts: unknown[], version?: number, source?: Record<string, unknown> } }} */ (report).report;
  assert.strictEqual(rep.totalCost, 2000);
  assert(Array.isArray(rep.alerts));
  assert.strictEqual(rep.version, 3);
  assert(rep.source && typeof rep.source === "object");
  assert.strictEqual(/** @type {{ receiptCount: number }} */ (rep.source).receiptCount, 1);

  const pdfOut = await exportProjectPdfApi({ cwd: tmp, project: "Acme_House" });
  assert(pdfOut.ok === true);
  assert(typeof /** @type {{ pdfBase64?: string }} */ (pdfOut).pdfBase64 === "string");
  assert(/** @type {{ pdfBase64: string }} */ (pdfOut).pdfBase64.length > 500);

  const share = await generateShareLinkApi({ cwd: tmp, project: "Acme_House" });
  assert(share.ok === true);
  const reportSlug = String(/** @type {{ projectSlug?: string }} */ (share).projectSlug ?? "");
  const rid = String(/** @type {{ reportId?: string }} */ (share).reportId ?? "");
  assert(reportSlug.length > 0 && rid.length > 0);
  assert(existsSync(join(tmp, "reports", reportSlug, `${rid}.json`)));
  assert(existsSync(join(tmp, "reports", reportSlug, `${rid}.pdf`)));
  const sharePath = String(/** @type {{ sharePath?: string }} */ (share).sharePath ?? "");
  assert(sharePath === `/reports/${reportSlug}/${rid}`);

  const allRecs = listReceipts(tmp);
  const rows = buildAssigneePerformanceRows(allRecs, [], "Acme_House");
  const alerts = buildAssigneeAlerts(rows);
  assert(alerts.some((a) => a.type === "problem"), "cost with zero progress should yield problem alert");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("ok: validateContractorProjectPersistence");

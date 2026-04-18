/**
 * Deterministic checks for tax field mapping + path rules + multi-doc analytics (no PDF fixtures required).
 * Run: node dev/validateTaxDocumentComparison.mjs
 */
import { strict as assert } from "assert";
import {
  bestSynonymScoreForField,
  extractNumberFromLine,
  listTaxComparisonFieldIds,
} from "../workflow/modules/capabilities/taxFieldMap.js";
import { assertPdfPathUnderCwd } from "../workflow/modules/capabilities/taxPathUnderCwd.js";
import { registerAllCapabilities } from "../workflow/modules/capabilities/registerAllCapabilities.js";
import { getCapabilities } from "../workflow/modules/capabilities/capabilityRegistry.js";
import { isModuleAllowedInDomain } from "../workflow/modules/capabilities/domainRegistry.js";
import {
  computeTrendAndAvgGrowth,
  detectSeriesAnomaly,
  firstLastDelta,
} from "../workflow/modules/capabilities/taxComparisonAnalytics.js";
import { buildTaxClientAggregation, buildTaxCompareExportPayload, taxComparePayloadToCsv } from "../workflow/modules/capabilities/taxCompareExportModel.js";
import { taxFieldDisplayLabel } from "../workflow/modules/capabilities/taxFieldMap.js";
import { clearFeedbackStore, getCapabilityOverrideEntriesForModule, recordCapabilityOverrideFeedback } from "../workflow/feedback/feedbackStore.js";

registerAllCapabilities();
const ids = getCapabilities().map((m) => m.id);
assert(ids.includes("tax_document_comparison"), "tax_document_comparison registered");
assert(isModuleAllowedInDomain("tax_document_comparison", "tax"), "allowed in tax domain");

assert(listTaxComparisonFieldIds().includes("net_income"));
assert(listTaxComparisonFieldIds().includes("tax_paid"), "tax_paid field registered");

const line = "Total Income: $85,000";
const sc = bestSynonymScoreForField(line, "net_income");
assert(sc > 0.2, `synonym score for net_income: ${sc}`);
const num = extractNumberFromLine(line);
assert.equal(num.value, 85000);

try {
  assertPdfPathUnderCwd(process.cwd(), "../outside/secret.pdf");
  assert.fail("should reject traversal");
} catch (e) {
  assert.match(String(e?.message ?? ""), /workspace|escapes/);
}

const inc = computeTrendAndAvgGrowth([100, 110, 121]);
assert.equal(inc.trend, "increasing");
assert(inc.avgGrowth != null && inc.avgGrowth > 9 && inc.avgGrowth < 11, `avgGrowth: ${inc.avgGrowth}`);

const flat = computeTrendAndAvgGrowth([50, 50.0001, 50]);
assert.equal(flat.trend, "flat");

const spike = detectSeriesAnomaly([100, 250], 50);
assert.equal(spike.anomaly, true);
assert.match(spike.message, /period/i);

const ok = detectSeriesAnomaly([100, 120], 50);
assert.equal(ok.anomaly, false);

const fld = firstLastDelta([10, null, 40]);
assert.equal(fld.delta, 30);

clearFeedbackStore();
const fb = recordCapabilityOverrideFeedback({
  rowId: "validate-tax-1",
  moduleId: "tax_document_comparison",
  originalValues: {
    version: 1,
    edits: [{ kind: "tax_comparison_edit", fieldId: "net_income", docIndex: 0, value: 1, sourceText: "x" }],
  },
  finalValues: {
    version: 1,
    edits: [{ kind: "tax_comparison_edit", fieldId: "net_income", docIndex: 0, value: 2, sourceText: "x" }],
  },
});
assert.equal(fb.ok, true);
const entries = getCapabilityOverrideEntriesForModule("tax_document_comparison");
assert.equal(entries.length, 1);
clearFeedbackStore();

assert.equal(taxFieldDisplayLabel("net_income"), "Net Income");

const draft = {
  net_income: { values: [100, 110, 120], mapToFieldId: "net_income" },
};
const comparisons = [
  { fieldId: "net_income", label: "Net Income", values: [100, 110, 120], documents: [] },
];
const docMeta = [
  { client: "John Doe", year: "2022" },
  { client: "John Doe", year: "2023" },
  { client: "John Doe", year: "2024" },
];
const clients = buildTaxClientAggregation(docMeta, comparisons, draft, ["net_income"], 50);
assert.equal(clients.length, 1);
assert.equal(clients[0].client, "John Doe");
assert.deepEqual(clients[0].years, [2022, 2023, 2024]);
assert.equal(clients[0].fields.length, 1);

const payload = buildTaxCompareExportPayload(
  { comparisons, paths: ["/a", "/b", "/c"], summary: "test" },
  draft,
  docMeta,
  ["net_income"],
  50,
  ["f1.pdf", "f2.pdf", "f3.pdf"],
  "documents",
);
assert.ok(payload.documentView.length >= 1);
const csv = taxComparePayloadToCsv(payload);
assert.match(csv, /document/);
assert.match(csv, /client/);

console.log("ok: validateTaxDocumentComparison");

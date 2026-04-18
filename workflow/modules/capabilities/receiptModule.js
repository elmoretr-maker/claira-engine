/**
 * Global receipt capability: add / list / total. No domain checks — packs supply tags.
 */

import { assertCapabilityModule } from "./capabilityContract.js";
import {
  addReceipt,
  calculateReceiptTotal,
  listFilterHasContent,
  listReceipts,
  normalizeReceiptTags,
} from "./receiptStore.js";
import { extractReceiptData } from "./receiptOcr.js";

export { extractReceiptData };

export { normalizeReceiptTags };

export const receiptModule = {
  id: "receipt_tracking",
  name: "Receipt tracking",
  description: "Add, list, and total receipts under receipts/ (tagged for any pack: contractor, tax, etc.).",
  supportedIntents: ["receipt", "expense", "save receipt", "upload receipt"],

  /**
   * @param {Record<string, unknown>} input
   * @param {import("./capabilityContract.js").CapabilityRunContext} context
   */
  async run(input, context) {
    const cwd =
      context.inputData != null &&
      typeof context.inputData === "object" &&
      !Array.isArray(context.inputData) &&
      typeof /** @type {{ cwd?: string }} */ (context.inputData).cwd === "string" &&
      String(/** @type {{ cwd?: string }} */ (context.inputData).cwd).trim()
        ? String(/** @type {{ cwd?: string }} */ (context.inputData).cwd).trim()
        : process.cwd();

    const action = String(input.action ?? "list").trim().toLowerCase();

    if (action === "extract") {
      try {
        const imageBase64 = String(input.imageBase64 ?? "");
        const data = await extractReceiptData(imageBase64);
        return {
          ok: true,
          extract: data,
          summary: data.vendor ? `OCR: ${data.vendor}` : "OCR: no fields detected",
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          ok: true,
          extract: {
            vendor: "",
            amount: "",
            date: "",
            rawText: "",
            confidence: { overall: null, vendor: null, amount: null, date: null },
          },
          summary: `OCR failed (${msg}); enter fields manually.`,
        };
      }
    }

    if (action === "add") {
      try {
        const rec = addReceipt(cwd, {
          vendor: String(input.vendor ?? ""),
          amount: input.amount,
          date: String(input.date ?? ""),
          note: String(input.note ?? ""),
          imageBase64: String(input.imageBase64 ?? ""),
          filename: String(input.filename ?? ""),
          tags: input.tags,
        });
        return {
          ok: true,
          receipt: rec,
          summary: `Saved receipt ${rec.id}`,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: true, message: msg, summary: msg };
      }
    }

    if (action === "total") {
      const filterTags = normalizeReceiptTags(input.tags);
      const hasFilter = listFilterHasContent(input.tags);
      const list = listReceipts(cwd, hasFilter ? { tags: filterTags } : {});
      const total = calculateReceiptTotal(list);
      return {
        ok: true,
        total,
        count: list.length,
        summary: `${list.length} receipt(s) · total ${total}`,
      };
    }

    const filterTags = normalizeReceiptTags(input.tags);
    const hasFilter = listFilterHasContent(input.tags);
    const receipts = listReceipts(cwd, hasFilter ? { tags: filterTags } : {});
    const total = calculateReceiptTotal(receipts);
    return {
      ok: true,
      receipts,
      total,
      summary: `${receipts.length} receipt(s) · total ${total}`,
    };
  },
};

assertCapabilityModule(receiptModule, "receiptModule");

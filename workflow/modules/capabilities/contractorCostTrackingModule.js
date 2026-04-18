/**
 * Contractor cost delta vs initial budget (deterministic, no I/O).
 */

import { assertCapabilityModule } from "./capabilityContract.js";
import { getDomainDefinition } from "./domainRegistry.js";

export const contractorCostTrackingModule = {
  id: "contractor_cost_tracking",
  name: "Contractor cost tracking",
  description:
    "Compute budget vs actual (contractor domain). Prefer receiptTotal + manualSpendSupplement; else legacy currentCost.",
  supportedIntents: ["project cost", "budget variance", "construction budget"],

  /**
   * @param {Record<string, unknown>} input
   * @param {import("./capabilityContract.js").CapabilityRunContext} context
   */
  run(input, context) {
    const dm =
      context.inputData != null &&
      typeof context.inputData === "object" &&
      !Array.isArray(context.inputData) &&
      typeof /** @type {{ domainMode?: string }} */ (context.inputData).domainMode === "string"
        ? String(/** @type {{ domainMode?: string }} */ (context.inputData).domainMode).trim()
        : "";
    if (getDomainDefinition(dm).id !== "contractor") {
      return {
        error: true,
        message: "contractor_cost_tracking: requires domainMode contractor",
        summary: "Switch capability domain to General Contractor.",
      };
    }

    const project = String(input.project ?? "").trim() || "project";
    const initialRaw = input.initialCost;
    const initialCost = typeof initialRaw === "number" ? initialRaw : Number(initialRaw);
    if (!Number.isFinite(initialCost)) {
      return {
        error: true,
        message: "contractor_cost_tracking: initialCost must be a finite number",
        summary: "Enter numeric budget (initial).",
      };
    }

    const receiptTotalRaw = input.receiptTotal;
    const receiptTotal =
      receiptTotalRaw == null ? NaN : typeof receiptTotalRaw === "number" ? receiptTotalRaw : Number(receiptTotalRaw);

    const supplementRaw = input.manualSpendSupplement ?? input.nonReceiptSpend ?? 0;
    const supplement =
      typeof supplementRaw === "number" ? supplementRaw : Number(supplementRaw);
    const manualSpendSupplement = Number.isFinite(supplement) ? Number(supplement.toFixed(2)) : 0;

    const currentRaw = input.currentCost;
    const manualCurrent = typeof currentRaw === "number" ? currentRaw : Number(currentRaw);

    let currentCost;
    let receiptTotalUsed = null;
    if (Number.isFinite(receiptTotal)) {
      receiptTotalUsed = Number(receiptTotal.toFixed(2));
      currentCost = Number((receiptTotalUsed + manualSpendSupplement).toFixed(2));
    } else if (Number.isFinite(manualCurrent)) {
      currentCost = Number(manualCurrent.toFixed(2));
    } else {
      currentCost = Number(manualSpendSupplement.toFixed(2));
    }

    const delta = Number((currentCost - initialCost).toFixed(2));
    const overBudget = delta > 0;
    const percentChange =
      initialCost !== 0 ? Number(((delta / initialCost) * 100).toFixed(2)) : null;

    const summary =
      overBudget && delta > 0
        ? `Over budget by ${delta.toFixed(2)}`
        : delta < 0
          ? `Under budget by ${Math.abs(delta).toFixed(2)}`
          : "On budget";

    return {
      project,
      initialCost,
      currentCost,
      receiptTotal: receiptTotalUsed,
      manualSpendSupplement: receiptTotalUsed != null ? manualSpendSupplement : null,
      delta,
      overBudget,
      percentChange,
      summary,
    };
  },
};

assertCapabilityModule(contractorCostTrackingModule, "contractorCostTrackingModule");

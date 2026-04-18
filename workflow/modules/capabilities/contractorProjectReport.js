/**
 * Single source of truth for contractor project reports (JSON, PDF, share snapshots).
 */

import { compressAndEmbedReceiptImage } from "./contractorReportImageEmbed.js";
import { buildAssigneeAlerts } from "./contractorAssigneeAlerts.js";
import { buildAssigneePerformanceRows } from "./contractorPerformanceShared.js";
import { slugReceiptSegment } from "./receiptPathSlug.js";
import { calculateReceiptTotal, listReceiptsForContractorProject } from "./receiptStore.js";

/**
 * @param {unknown[]} scanProjects
 * @param {string} projectFolderName `Projects/{name}` folder name
 */
function countTimelineImagesForProject(scanProjects, projectDisplayName) {
  let targetSlug = "";
  try {
    targetSlug = slugReceiptSegment(String(projectDisplayName ?? "").trim());
  } catch {
    targetSlug = String(projectDisplayName ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "_");
  }
  if (!targetSlug) return 0;
  let n = 0;
  for (const p of scanProjects) {
    if (typeof p !== "object" || !p) continue;
    const pn = String(/** @type {{ name?: string }} */ (p).name ?? "");
    let pSl = "";
    try {
      pSl = slugReceiptSegment(pn);
    } catch {
      continue;
    }
    if (pSl !== targetSlug) continue;
    const rooms = Array.isArray(/** @type {{ rooms?: unknown }} */ (p).rooms) ? /** @type {unknown[]} */ (p).rooms : [];
    for (const room of rooms) {
      if (typeof room !== "object" || !room) continue;
      const stages = Array.isArray(/** @type {{ stages?: unknown }} */ (room).stages) ? /** @type {unknown[]} */ (room).stages : [];
      for (const st of stages) {
        if (typeof st !== "object" || !st) continue;
        const imgs = Array.isArray(/** @type {{ images?: unknown }} */ (st).images) ? /** @type {unknown[]} */ (st).images : [];
        n += imgs.length;
      }
    }
  }
  return n;
}

/**
 * @typedef {{
 *   initialBudget?: number | null,
 *   manualSpendSupplement?: number | null,
 * }} BudgetContext
 */

/**
 * @param {{
 *   cwd: string,
 *   projectDisplayName: string,
 *   scanProjects: unknown[],
 *   budgetContext?: BudgetContext | null,
 *   includeReceiptThumbnails?: boolean,
 * }} opts
 */
export async function buildContractorProjectReportData(opts) {
  const project = String(opts.projectDisplayName ?? "").trim();
  if (!project) throw new Error("report: project name required");
  const receipts = listReceiptsForContractorProject(opts.cwd, project);
  const totalCost = calculateReceiptTotal(receipts);
  const performanceRows = buildAssigneePerformanceRows(receipts, opts.scanProjects, project);
  const alerts = buildAssigneeAlerts(performanceRows);

  /** @type {Record<string, { total: number, sections: Record<string, number> }>} */
  const perAssignee = {};
  for (const row of performanceRows) {
    if (!perAssignee[row.assignee]) perAssignee[row.assignee] = { total: 0, sections: {} };
    perAssignee[row.assignee].total += row.cost;
    perAssignee[row.assignee].sections[row.sectionLabel] = row.cost;
  }

  /** @type {Record<string, number>} */
  const sectionBreakdown = {};
  for (const row of performanceRows) {
    sectionBreakdown[row.sectionLabel] = (sectionBreakdown[row.sectionLabel] ?? 0) + row.cost;
  }

  let projectSlug;
  try {
    projectSlug = slugReceiptSegment(project);
  } catch {
    projectSlug = project.toLowerCase().replace(/[^a-z0-9._-]+/g, "_").slice(0, 80) || "project";
  }

  /** @type {Record<string, unknown> | null} */
  let budgetVsActual = null;
  const bc = opts.budgetContext;
  if (bc && (bc.initialBudget != null || bc.manualSpendSupplement != null)) {
    const initial =
      bc.initialBudget != null && Number.isFinite(Number(bc.initialBudget)) ? Number(bc.initialBudget) : null;
    const manual =
      bc.manualSpendSupplement != null && Number.isFinite(Number(bc.manualSpendSupplement))
        ? Number(bc.manualSpendSupplement)
        : 0;
    const currentSpend = Number((totalCost + manual).toFixed(2));
    budgetVsActual = {
      initialBudget: initial,
      receiptTotal: totalCost,
      manualSpendSupplement: manual,
      currentSpend,
      ...(initial != null ? { deltaVsBudget: Number((currentSpend - initial).toFixed(2)) } : {}),
    };
  }

  /** @type {Array<{ sectionLabel: string, embeddedImages: Array<{ mimeType: string, dataBase64: string }> }>} */
  const receiptThumbnails = [];
  /** @type {Map<string, Array<{ mimeType: string, dataBase64: string }>>} */
  const bySectionEmb = new Map();
  if (opts.includeReceiptThumbnails !== false) {
    for (const r of receipts) {
      const tags = r.tags && typeof r.tags === "object" && !Array.isArray(r.tags) ? r.tags : {};
      const path = Array.isArray(tags.path) ? tags.path : [];
      if (path.length < 3) continue;
      const label = `${path[1]} › ${path[2]}`;
      const ip = String(r.imagePath ?? "").trim();
      if (!ip) continue;
      if (!bySectionEmb.has(label)) bySectionEmb.set(label, []);
      const arr = bySectionEmb.get(label);
      if (!arr || arr.length >= 2) continue;
      const emb = await compressAndEmbedReceiptImage(opts.cwd, ip);
      if (emb) arr.push(emb);
    }
    for (const [sectionLabel, embeddedImages] of bySectionEmb.entries()) {
      if (embeddedImages.length > 0) receiptThumbnails.push({ sectionLabel, embeddedImages });
    }
    receiptThumbnails.sort((a, b) => a.sectionLabel.localeCompare(b.sectionLabel));
  }

  let receiptImageCount = 0;
  for (const r of receipts) {
    if (String(r.imagePath ?? "").trim()) receiptImageCount += 1;
  }
  const timelineImageCount = countTimelineImagesForProject(opts.scanProjects, project);
  let embeddedReceiptSampleCount = 0;
  for (const row of receiptThumbnails) {
    embeddedReceiptSampleCount += row.embeddedImages.length;
  }

  return {
    version: 3,
    generatedAt: new Date().toISOString(),
    source: {
      receiptCount: receipts.length,
      receiptImageCount,
      timelineImageCount,
      embeddedReceiptSampleCount,
    },
    project: { name: project, slug: projectSlug },
    totalCost,
    receiptCount: receipts.length,
    budgetVsActual,
    sectionBreakdown,
    perAssignee,
    progressMetrics: performanceRows.map((r) => ({
      assignee: r.assignee,
      section: r.sectionLabel,
      cost: r.cost,
      progressCount: r.progressCount,
      efficiency: Number.isFinite(r.efficiency) ? Number(r.efficiency.toFixed(6)) : null,
      status: r.status,
    })),
    alerts,
    receiptThumbnails,
  };
}

/**
 * @param {{
 *   cwd: string,
 *   projectDisplayName: string,
 *   scanProjects: unknown[],
 *   budgetContext?: BudgetContext | null,
 * }} opts
 */
export async function buildContractorProjectReportExport(opts) {
  const { includeReceiptThumbnails, ...rest } = opts;
  return buildContractorProjectReportData({
    ...rest,
    includeReceiptThumbnails: includeReceiptThumbnails ?? true,
  });
}

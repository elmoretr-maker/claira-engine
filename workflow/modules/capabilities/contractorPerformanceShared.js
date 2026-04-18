/**
 * Shared contractor assignee/section performance metrics (timeline + receipts).
 */

import { slugReceiptSegment } from "./receiptPathSlug.js";

/**
 * @param {unknown[]} projects
 * @param {string} projSlug
 * @param {string} roomSlug
 * @param {string} stageSlug
 */
export function timelineProgressForReceiptPath(projects, projSlug, roomSlug, stageSlug) {
  for (const p of projects) {
    if (typeof p !== "object" || !p || Array.isArray(p)) continue;
    const pn = String(/** @type {{ name?: string }} */ (p).name ?? "");
    let pSl = "";
    try {
      pSl = slugReceiptSegment(pn);
    } catch {
      continue;
    }
    if (pSl !== projSlug) continue;
    const rooms = Array.isArray(/** @type {{ rooms?: unknown }} */ (p).rooms) ? /** @type {unknown[]} */ (p.rooms) : [];
    for (const rm of rooms) {
      if (typeof rm !== "object" || !rm || Array.isArray(rm)) continue;
      const rn = String(/** @type {{ name?: string }} */ (rm).name ?? "");
      let rSl = "";
      try {
        rSl = slugReceiptSegment(rn);
      } catch {
        continue;
      }
      if (rSl !== roomSlug) continue;
      const stages = Array.isArray(/** @type {{ stages?: unknown }} */ (rm).stages) ? /** @type {unknown[]} */ (rm.stages) : [];
      let stageImages = 0;
      let roomImageTotal = 0;
      let stagesWithImages = 0;
      for (const st of stages) {
        if (typeof st !== "object" || !st || Array.isArray(st)) continue;
        const sn = String(/** @type {{ name?: string }} */ (st).name ?? "");
        let sSl = "";
        try {
          sSl = slugReceiptSegment(sn);
        } catch {
          continue;
        }
        const imgs = Array.isArray(/** @type {{ images?: unknown }} */ (st).images) ? /** @type {unknown[]} */ (st.images) : [];
        const c = imgs.length;
        roomImageTotal += c;
        if (c > 0) stagesWithImages += 1;
        if (sSl === stageSlug) stageImages = c;
      }
      if (stageImages > 0) return stageImages;
      return Math.max(roomImageTotal, stagesWithImages);
    }
  }
  return 0;
}

/**
 * @typedef {{ id?: string, amount?: unknown, tags?: Record<string, unknown> }} ReceiptLike
 */

/**
 * @param {ReceiptLike[]} allReceipts
 * @param {unknown[]} projects scan projects
 * @param {string} [selectedProjectDisplayName] folder/display name; omit or empty = all projects
 * @returns {Array<{ assignee: string, sectionLabel: string, cost: number, progressCount: number, efficiency: number, status: string }>}
 */
export function buildAssigneePerformanceRows(allReceipts, projects, selectedProjectDisplayName) {
  /** @type {Array<{ assignee: string, sectionLabel: string, cost: number, progressCount: number, efficiency: number, status: string }>} */
  const rows = [];
  /** @type {Map<string, { cost: number, projectSlug: string, subSlug: string, secSlug: string, assignee: string }>} */
  const agg = new Map();
  for (const r of allReceipts) {
    const tags = r.tags && typeof r.tags === "object" && !Array.isArray(r.tags) ? r.tags : {};
    if (String(tags.domain ?? "").toLowerCase() !== "contractor") continue;
    const path = Array.isArray(tags.path) ? tags.path : [];
    if (path.length < 3) continue;
    const assignee = String(tags.assignee ?? "").trim();
    if (!assignee) continue;
    const amt = typeof r.amount === "number" ? r.amount : Number(r.amount);
    if (!Number.isFinite(amt)) continue;
    const pk = `${path[0]}|${path[1]}|${path[2]}|${assignee}`;
    const prev = agg.get(pk) ?? {
      cost: 0,
      projectSlug: String(path[0]),
      subSlug: String(path[1]),
      secSlug: String(path[2]),
      assignee,
    };
    prev.cost += amt;
    agg.set(pk, prev);
  }
  const scopeProject = String(selectedProjectDisplayName ?? "").trim();
  for (const v of agg.values()) {
    if (scopeProject) {
      try {
        if (v.projectSlug !== slugReceiptSegment(scopeProject)) continue;
      } catch {
        continue;
      }
    }
    const progressCount = timelineProgressForReceiptPath(projects, v.projectSlug, v.subSlug, v.secSlug);
    const cost = Number(v.cost.toFixed(2));
    let efficiency = 0;
    if (cost > 0) efficiency = progressCount / cost;
    else if (progressCount > 0) efficiency = Number.POSITIVE_INFINITY;
    let status = "warning";
    if (cost <= 0 && progressCount <= 0) status = "problem";
    else if (!Number.isFinite(efficiency)) status = "good";
    else if (efficiency >= 0.005) status = "good";
    else if (efficiency >= 0.0008) status = "warning";
    else status = "problem";
    rows.push({
      assignee: v.assignee,
      sectionLabel: `${v.subSlug} › ${v.secSlug}`,
      cost,
      progressCount,
      efficiency,
      status,
    });
  }
  rows.sort((a, b) => {
    const ea = Number.isFinite(a.efficiency) ? a.efficiency : 1e9;
    const eb = Number.isFinite(b.efficiency) ? b.efficiency : 1e9;
    return eb - ea;
  });
  return rows;
}

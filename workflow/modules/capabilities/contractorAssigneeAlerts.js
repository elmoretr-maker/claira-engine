/**
 * @typedef {{ assignee: string, sectionLabel: string, cost: number, progressCount: number, efficiency: number }} PerformanceRowLike
 */

/**
 * @typedef {{ assignee: string, section: string, type: "good" | "warning" | "problem", message: string }} AssigneeAlert
 */

/**
 * @param {PerformanceRowLike[]} rows
 * @returns {AssigneeAlert[]}
 */
export function buildAssigneeAlerts(rows) {
  /** @type {AssigneeAlert[]} */
  const alerts = [];
  for (const row of rows) {
    const section = row.sectionLabel;
    if (row.cost > 0 && row.progressCount === 0) {
      alerts.push({
        assignee: row.assignee,
        section,
        type: "problem",
        message: `Receipt spend ${row.cost} with no matching timeline progress for this section.`,
      });
      continue;
    }
    if (
      row.cost >= 1000 &&
      row.progressCount > 0 &&
      Number.isFinite(row.efficiency) &&
      row.efficiency < 0.001
    ) {
      alerts.push({
        assignee: row.assignee,
        section,
        type: "warning",
        message: `High spend with low progress efficiency (${row.efficiency.toFixed(4)}).`,
      });
    }
    if (Number.isFinite(row.efficiency) && row.cost > 0 && row.efficiency >= 0.005) {
      alerts.push({
        assignee: row.assignee,
        section,
        type: "good",
        message: `High efficiency (${row.efficiency.toFixed(4)} progress per dollar).`,
      });
    }
    if (!Number.isFinite(row.efficiency) && row.progressCount > 0) {
      alerts.push({
        assignee: row.assignee,
        section,
        type: "good",
        message: "Timeline progress recorded with no receipt cost in this bucket.",
      });
    }
  }
  return alerts;
}

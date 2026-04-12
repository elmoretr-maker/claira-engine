/**
 * Review (waiting room) priority — policy file describes intent; assignment logic lives here.
 * Not wired to CLI or session ledger yet.
 */

/**
 * @param {{ reason?: string | null }} item
 * @returns {{ priority: "high" | "medium" | "low" }}
 */
export function assignPriority(item) {
  const reason = String(item?.reason ?? "").trim();

  if (reason === "rejected_by_room") {
    return { priority: "high" };
  }
  if (reason === "text_mismatch") {
    return { priority: "medium" };
  }
  if (reason === "text_label_conflict") {
    return { priority: "medium" };
  }
  if (reason === "text_routing_conflict") {
    return { priority: "medium" };
  }
  if (reason === "text_insight_flag") {
    return { priority: "medium" };
  }
  if (reason.includes("low_confidence")) {
    return { priority: "high" };
  }
  if (reason.includes("ambiguous")) {
    return { priority: "medium" };
  }
  return { priority: "low" };
}

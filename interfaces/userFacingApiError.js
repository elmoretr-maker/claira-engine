/**
 * Server-side shape aligned with UI `UserFacingError` (for API JSON responses).
 * @typedef {{ message: string, type: "system", actionHint?: string }} UserFacingSystemError
 */

/**
 * @param {unknown} raw
 * @param {{ fallback?: string, actionHint?: string }} [opts]
 * @returns {UserFacingSystemError}
 */
export function apiSystemUserFacing(raw, opts = {}) {
  const fallback = opts.fallback ?? "Something went wrong. Please try again.";
  const message =
    typeof raw === "string" && raw.trim()
      ? raw.trim()
      : raw instanceof Error && raw.message
        ? raw.message
        : fallback;
  return {
    message,
    type: "system",
    ...(opts.actionHint ? { actionHint: opts.actionHint } : {}),
  };
}

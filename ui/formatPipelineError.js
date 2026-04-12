/** User-facing copy when real mode blocks mock/simulated external paths. */
export const REAL_MODE_INTEGRATION_REQUIRED_MESSAGE =
  "Real integrations are required in real mode. Please connect a supported system.";

/**
 * @param {unknown} message
 * @returns {string}
 */
export function formatPipelineErrorForDisplay(message) {
  const s = String(message);
  if (
    s.includes("Real external adapter not implemented. Cannot proceed in real mode.") ||
    s.includes("Real external output not implemented. Cannot proceed in real mode.")
  ) {
    return REAL_MODE_INTEGRATION_REQUIRED_MESSAGE;
  }
  return s;
}

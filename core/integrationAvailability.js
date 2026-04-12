import { REAL_EXTERNAL_ADAPTER_READY } from "../adapters/realExternalAdapter.js";
import { REAL_EXTERNAL_OUTPUT_READY } from "../outputs/realExternalOutput.js";

/**
 * True when both ingestion and export are wired for production external targets.
 */
export function isRealExternalIntegrationReady() {
  return REAL_EXTERNAL_ADAPTER_READY && REAL_EXTERNAL_OUTPUT_READY;
}

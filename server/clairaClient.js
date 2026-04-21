/**
 * Claira API Client — server-side helper for calling a running Claira engine.
 *
 * Use this module from:
 *   - Integration scripts that need to call Claira programmatically
 *   - Test harnesses
 *   - External services / adapters running alongside the engine
 *
 * This module makes plain HTTP calls to POST /__claira/run.
 * It does NOT import internal engine code — it is a pure network client.
 *
 * Usage:
 *   import { runClaira, checkHealth } from "./server/clairaClient.js";
 *
 *   const result = await runClaira(
 *     { kind: "getRiskInsights" },
 *     { accountId: "acct_123", apiKey: "my-key" }
 *   );
 */

const DEFAULT_BASE_URL = `http://127.0.0.1:${process.env.PORT || 3000}`;

/**
 * Call POST /__claira/run on a running Claira server.
 *
 * @param {Record<string, any>} body
 *   Request body. Must include `kind`. Any additional fields are passed through.
 *   Optional context fields (`accountId`, `environment`, `metadata`) are merged
 *   from `options` if not already present in `body`.
 *
 * @param {{
 *   apiKey?:    string,   // Sent as x-claira-key header
 *   accountId?: string,   // Merged into request body
 *   environment?: string, // Merged into request body
 *   metadata?:  Record<string, any>, // Merged into request body
 *   requestId?: string,   // Sent as x-claira-request-id header (trace correlation)
 *   baseUrl?:   string,   // Override server base URL (default: http://127.0.0.1:<PORT>)
 * }} [options]
 *
 * @returns {Promise<any>} The engine result (same shape as /__claira/run success response).
 * @throws {Error} On HTTP error or network failure. `err.statusCode` is set for HTTP errors.
 */
export async function runClaira(body, options = {}) {
  const {
    apiKey,
    accountId,
    environment,
    metadata,
    requestId,
    baseUrl = DEFAULT_BASE_URL,
  } = options;

  // Merge context fields from options into the body (body fields take precedence).
  const payload = {
    ...(accountId != null ? { accountId } : {}),
    ...(environment != null ? { environment } : {}),
    ...(metadata != null ? { metadata } : {}),
    ...body, // body wins over options for any overlapping key
  };

  const headers = {
    "Content-Type": "application/json",
    ...(apiKey ? { "x-claira-key": apiKey } : {}),
    ...(requestId ? { "x-claira-request-id": requestId } : {}),
  };

  const response = await fetch(`${baseUrl}/__claira/run`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(json.error ?? `HTTP ${response.status}`);
    /** @type {any} */ (err).statusCode = response.status;
    throw err;
  }

  return json;
}

/**
 * Check if a Claira server is reachable and healthy.
 *
 * @param {string} [baseUrl] - Defaults to http://127.0.0.1:<PORT>
 * @returns {Promise<boolean>} true if healthy, false otherwise.
 */
export async function checkHealth(baseUrl = DEFAULT_BASE_URL) {
  try {
    const response = await fetch(`${baseUrl}/api/claira/health`);
    return response.ok;
  } catch {
    return false;
  }
}

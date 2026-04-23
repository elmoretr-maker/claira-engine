/**
 * runClaira — shared internal engine function.
 *
 * This is the single source of truth for all engine dispatch. Both the HTTP
 * layer (/__claira/run, /api/claira/run) and the module orchestrator
 * (workflow/execution/moduleOrchestrator.js) call this directly.
 *
 * The HTTP routes are one interface to this function, not the function itself.
 *
 * ── Context contract ────────────────────────────────────────────────────────
 *   accountId  string | null   Caller account identifier (null = anonymous).
 *   rid        string          Request / trace ID. Auto-generated if missing.
 *   source     "ui"            Call originated from the browser UI.
 *              "workflow"      Call originated from the module orchestrator.
 *              "integration"   Call originated from an external integration.
 *
 * All three fields are always present after normalization — callers must never
 * need to check for undefined.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   // server/index.js (startup)
 *   import { initRunClaira, runClaira } from "./runClaira.js";
 *   initRunClaira(CLAIRA_RUN_HANDLERS);
 *
 *   // HTTP route
 *   const out = await runClaira(kind, body, { accountId, rid, source: "ui" });
 *
 *   // Module orchestrator (Phase 4)
 *   import { runClaira } from "../../server/runClaira.js";
 *   const result = await runClaira(kind, payload, { accountId, rid, source: "workflow" });
 */

/**
 * @typedef {"ui" | "workflow" | "integration"} RunClairaSource
 */

/**
 * @typedef {{
 *   accountId?: string | null,
 *   rid?: string,
 *   source?: RunClairaSource,
 * }} RunClairaContext
 */

/**
 * @typedef {{
 *   accountId: string | null,
 *   rid: string,
 *   source: RunClairaSource,
 * }} NormalizedRunClairaContext
 */

/** @type {Record<string, (body: Record<string, any>, api: any) => Promise<any>> | null} */
let _handlerMap = null;

/**
 * Initialize the engine dispatcher with the handler map.
 * Must be called exactly once during server startup, after CLAIRA_RUN_HANDLERS
 * is defined and before any request is served.
 *
 * Safe to call from test harnesses — subsequent calls are silently ignored.
 *
 * @param {Record<string, (body: Record<string, any>, api: any) => Promise<any>>} handlerMap
 */
export function initRunClaira(handlerMap) {
  if (_handlerMap !== null) {
    console.warn("[runClaira] initRunClaira called more than once — ignoring duplicate");
    return;
  }
  if (handlerMap == null || typeof handlerMap !== "object") {
    throw new Error("[runClaira] initRunClaira: handlerMap must be a non-null object");
  }
  _handlerMap = handlerMap;
  console.log(`[runClaira] initialized — ${Object.keys(handlerMap).length} handler(s) registered`);
}

/**
 * Reset the handler map (test use only).
 * @internal
 */
export function _resetRunClairaForTesting() {
  _handlerMap = null;
}

/** Transport keys not part of engine operation payloads (after `payload` unwrapping). */
const RUN_BODY_TRANSPORT_KEYS = new Set([
  "kind",
  "accountId",
  "environment",
  "metadata",
  "cwd",
  "payload",
]);

/**
 * Flatten `{ kind, payload: { ...ops } }` → `{ kind, ...ops }` so handlers read operation
 * fields at the top level. Omits the nested `payload` property from the result.
 * Bodies that are already flat are returned unchanged.
 *
 * Called inside {@link runClaira} for every dispatch (HTTP and workflow).
 *
 * @param {Record<string, any> | null | undefined} body
 * @returns {Record<string, any>}
 */
export function normalizeRunRequestBody(body) {
  if (body == null || typeof body !== "object") return body;
  const inner = body.payload;
  if (inner != null && typeof inner === "object" && !Array.isArray(inner)) {
    const { payload: _omit, ...rest } = body;
    return { ...rest, ...inner };
  }
  return body;
}

/**
 * Strips HTTP / run transport keys from a normalized body for handlers that expect a
 * single operation object (e.g. `ingestData` after flattening legacy `payload` wrappers).
 *
 * @param {Record<string, any>} body
 * @returns {Record<string, any>}
 */
export function operationArgsFromRunBody(body) {
  if (body == null || typeof body !== "object") return {};
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (!RUN_BODY_TRANSPORT_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Normalize and validate the caller-supplied context.
 * All three fields are guaranteed to be present in the returned object.
 *
 * @param {RunClairaContext} [context]
 * @returns {NormalizedRunClairaContext}
 */
function normalizeContext(context = {}) {
  const accountId =
    typeof context.accountId === "string" && context.accountId.length > 0
      ? context.accountId
      : null;

  const rid =
    typeof context.rid === "string" && context.rid.length > 0
      ? context.rid.slice(0, 64)
      : Math.random().toString(36).slice(2, 10);

  const source =
    context.source === "ui" ||
    context.source === "workflow" ||
    context.source === "integration"
      ? context.source
      : "ui";

  return { accountId, rid, source };
}

/**
 * Shared internal engine function.
 *
 * Both the HTTP layer and the module orchestrator call this function directly.
 * Never call CLAIRA_RUN_HANDLERS or pipeline functions directly — always use
 * runClaira so that logging, context enforcement, and future middleware
 * (auth, rate-limiting, tracing) apply uniformly to every call site.
 *
 * @param {string} kind        The operation to run (matches a CLAIRA_RUN_HANDLERS key).
 * @param {Record<string, any>} payload  Raw request body (HTTP) or orchestrator payload.
 *                             Normalized internally: nested `{ payload: { ... } }` is flattened
 *                             before the handler runs (see {@link normalizeRunRequestBody}).
 * @param {RunClairaContext} [context]  Caller identity and trace context.
 * @returns {Promise<any>}     Raw handler result (HTTP routes wrap this; orchestrator uses directly).
 * @throws {Error}             If not initialized, kind is unknown, or the handler throws.
 */
export async function runClaira(kind, payload, context = {}) {
  if (!_handlerMap) {
    throw new Error(
      "[runClaira] not initialized — call initRunClaira(CLAIRA_RUN_HANDLERS) during server startup",
    );
  }

  if (!kind || typeof kind !== "string") {
    throw new Error('[runClaira] kind must be a non-empty string');
  }

  // ── Enforce context shape ─────────────────────────────────────────────────
  const { accountId, rid, source } = normalizeContext(context);
  const tag = `[runClaira] rid=${rid} account=${accountId ?? "anon"} source=${source} kind=${kind}`;

  // ── Handler lookup ────────────────────────────────────────────────────────
  const handler = _handlerMap[kind];
  if (!handler) {
    console.warn(`${tag} unknown-kind`);
    throw new Error(`Unknown kind: "${kind}"`);
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────
  const api = await import("../interfaces/api.js");
  const started = Date.now();
  console.log(`${tag} start`);

  try {
    const normalizedBody = normalizeRunRequestBody(payload);
    const result = await handler(normalizedBody, api);
    console.log(`${tag} status=ok ms=${Date.now() - started}`);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${tag} status=error ms=${Date.now() - started} — ${msg}`);
    throw e;
  }
}

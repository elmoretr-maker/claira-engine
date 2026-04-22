/**
 * Workflow module shape — capabilities, isolated state, read-only health, UI hooks.
 *
 * Optional: execute(context) — workflow orchestration; state is read-only on context;
 * writes only via context.dispatch(moduleId, reducerKey, payload).
 * expectedContextVersion must equal the engine's context.version or execute is skipped with an error.
 *
 * All modules must follow moduleContract. State logic must remain isolated per module.
 *
 * ── Engine-aware modules (plan.md §16) ──────────────────────────────────────
 * Modules that participate in the module orchestration system (Phase 4+) must
 * additionally declare:
 *
 *   engineKinds  string[]   The runClaira kind(s) this module calls. Must be a
 *                           non-empty array of non-empty strings. Individual kind
 *                           values are not validated against CLAIRA_RUN_HANDLERS
 *                           here — that is a runtime concern. This validates
 *                           structure only.
 *
 * Legacy modules (entity_tracking, event_log, asset_registry, etc.) that use
 * the execute(context) pattern are exempt from engineKinds. They continue to
 * pass assertModuleFollowsContract unchanged.
 *
 * New modules must pass assertEngineContract (a strict superset of this
 * contract) before being registered with the module orchestrator.
 */

import { isRegisteredArtifactKind } from "../pipeline/artifactKindRegistry.js";
import { isModulePipelineType } from "../pipeline/modulePipelineTypes.js";
import { isProduceMode } from "../pipeline/produceMode.js";

/**
 * @typedef {"healthy" | "warning" | "error"} ModuleHealthStatus
 */

/**
 * @typedef {{
 *   status: ModuleHealthStatus,
 *   issues: string[],
 * }} ModuleHealthReport
 */

// =============================================================================
// Private helpers
// =============================================================================

/**
 * Validate the shape of an engineKinds value.
 *
 * engineKinds must be a non-empty array of non-empty trimmed strings.
 * Kind string values are NOT checked against CLAIRA_RUN_HANDLERS here —
 * that validation happens at runtime when runClaira dispatches the call.
 *
 * @param {unknown} engineKinds
 * @param {string} label
 * @throws {Error}
 */
function assertValidEngineKinds(engineKinds, label) {
  if (!Array.isArray(engineKinds) || engineKinds.length === 0) {
    throw new Error(`${label}: engineKinds must be a non-empty array of strings`);
  }
  for (let i = 0; i < engineKinds.length; i++) {
    if (typeof engineKinds[i] !== "string" || !engineKinds[i].trim()) {
      throw new Error(`${label}: engineKinds[${i}] must be a non-empty string`);
    }
  }
}

// =============================================================================
// Base contract — all modules (legacy + new)
// =============================================================================

/**
 * Assert that a module object satisfies the base workflow module contract.
 *
 * This function is backward-compatible: legacy modules that do not declare
 * engineKinds pass without error. If engineKinds IS present, its shape is
 * validated (soft check).
 *
 * @param {unknown} mod
 * @param {string} [label]
 * @throws {Error}
 */
export function assertModuleFollowsContract(mod, label = "module") {
  if (mod == null || typeof mod !== "object" || Array.isArray(mod)) {
    throw new Error(`${label}: must be a non-null object`);
  }
  const m = /** @type {Record<string, unknown>} */ (mod);
  for (const key of [
    "id",
    "label",
    "description",
    "capabilities",
    "modulePipelineType",
    "consumes",
    "produces",
    "expectedContextVersion",
    "state",
    "health",
    "ui",
  ]) {
    if (!(key in m)) throw new Error(`${label}: missing required field "${key}"`);
  }
  if (!isModulePipelineType(m.modulePipelineType)) {
    throw new Error(
      `${label}: modulePipelineType must be one of input|processing|tracking|aggregation|output|presentation`,
    );
  }
  if (!Array.isArray(m.consumes) || !m.consumes.every((c) => typeof c === "string" && isRegisteredArtifactKind(c))) {
    throw new Error(`${label}: consumes must be an array of registered artifact kind strings`);
  }
  if (!Array.isArray(m.produces)) {
    throw new Error(`${label}: produces must be an array`);
  }
  for (let i = 0; i < m.produces.length; i++) {
    const row = m.produces[i];
    if (row == null || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`${label}: produces[${i}] must be an object { kind, mode }`);
    }
    const pr = /** @type {{ kind?: unknown, mode?: unknown }} */ (row);
    if (typeof pr.kind !== "string" || !isRegisteredArtifactKind(pr.kind)) {
      throw new Error(`${label}: produces[${i}].kind must be a registered artifact kind`);
    }
    if (!isProduceMode(pr.mode)) {
      throw new Error(`${label}: produces[${i}].mode must be create|extend|derive|replace`);
    }
  }
  if (m.modulePipelineType === "presentation") {
    const caps = m.interactionCapabilities;
    if (!Array.isArray(caps) || caps.length === 0 || !caps.every((c) => typeof c === "string" && c.trim())) {
      throw new Error(
        `${label}: presentation modules must declare interactionCapabilities as a non-empty array of non-empty strings`,
      );
    }
  }
  if (typeof m.expectedContextVersion !== "number" || !Number.isInteger(m.expectedContextVersion)) {
    throw new Error(`${label}: expectedContextVersion must be an integer`);
  }
  if (typeof m.id !== "string" || !m.id.trim()) throw new Error(`${label}: id must be a non-empty string`);
  if (typeof m.label !== "string" || !m.label.trim()) throw new Error(`${label}: label must be a non-empty string`);
  if (typeof m.description !== "string") throw new Error(`${label}: description must be a string`);
  if (!Array.isArray(m.capabilities) || !m.capabilities.every((c) => typeof c === "string")) {
    throw new Error(`${label}: capabilities must be an array of strings`);
  }

  const st = m.state;
  if (st == null || typeof st !== "object" || Array.isArray(st)) {
    throw new Error(`${label}: state must be a non-null object`);
  }
  const state = /** @type {Record<string, unknown>} */ (st);
  if (typeof state.initialize !== "function") throw new Error(`${label}: state.initialize must be a function`);
  if (state.selectors == null || typeof state.selectors !== "object" || Array.isArray(state.selectors)) {
    throw new Error(`${label}: state.selectors must be an object`);
  }
  if (state.reducers == null || typeof state.reducers !== "object" || Array.isArray(state.reducers)) {
    throw new Error(`${label}: state.reducers must be an object`);
  }
  const sel = /** @type {Record<string, unknown>} */ (state.selectors);
  const red = /** @type {Record<string, unknown>} */ (state.reducers);
  for (const fn of Object.values(sel)) {
    if (typeof fn !== "function") throw new Error(`${label}: every selector must be a function`);
  }
  for (const fn of Object.values(red)) {
    if (typeof fn !== "function") throw new Error(`${label}: every reducer must be a function`);
  }

  const h = m.health;
  if (h == null || typeof h !== "object" || Array.isArray(h)) {
    throw new Error(`${label}: health must be a non-null object`);
  }
  if (typeof /** @type {{ check?: unknown }} */ (h).check !== "function") {
    throw new Error(`${label}: health.check must be a function`);
  }

  const ui = m.ui;
  if (ui == null || typeof ui !== "object" || Array.isArray(ui)) {
    throw new Error(`${label}: ui must be a non-null object`);
  }
  if (!Array.isArray(/** @type {{ components?: unknown }} */ (ui).components)) {
    throw new Error(`${label}: ui.components must be an array`);
  }

  if ("execute" in m && m.execute != null && typeof m.execute !== "function") {
    throw new Error(`${label}: execute must be a function when present`);
  }

  // ── Soft check: engineKinds (present → valid shape; absent → legacy ok) ──
  if ("engineKinds" in m) {
    assertValidEngineKinds(m.engineKinds, label);
  }
}

// =============================================================================
// Engine contract — new-architecture modules only (Phase 4+)
// =============================================================================

/**
 * Assert that a module satisfies the strict engine-aware contract required by
 * the module orchestrator.
 *
 * This is a superset of assertModuleFollowsContract. All base checks run first,
 * then the engine-specific requirements are enforced.
 *
 * Additional requirements beyond the base contract:
 *
 *   engineKinds  string[]  (REQUIRED) The runClaira kind(s) this module calls.
 *                          Must be a non-empty array of non-empty strings.
 *                          Each string must match a key in CLAIRA_RUN_HANDLERS,
 *                          but that match is validated at runtime — not here.
 *
 * Do NOT call this on legacy modules. They will fail because they have no
 * engineKinds. Use assertModuleFollowsContract for legacy validation.
 *
 * @param {unknown} mod
 * @param {string} [label]
 * @throws {Error}
 */
export function assertEngineContract(mod, label = "module") {
  // Run all base checks first.
  assertModuleFollowsContract(mod, label);

  const m = /** @type {Record<string, unknown>} */ (mod);

  // engineKinds — required for engine-aware modules.
  if (!("engineKinds" in m)) {
    throw new Error(
      `${label}: engineKinds is required for engine-aware modules — ` +
      `declare which runClaira kind(s) this module calls`,
    );
  }
  // Shape is already validated by the soft check in assertModuleFollowsContract,
  // but call again here to keep this function self-contained and testable in isolation.
  assertValidEngineKinds(m.engineKinds, label);
}

// =============================================================================
// Non-throwing inspector — health checks and dev tooling
// =============================================================================

/**
 * Return a list of engine-contract issues for a module without throwing.
 *
 * Runs assertEngineContract and catches all errors. Returns an empty array if
 * the module is fully compliant, or a list of issue strings otherwise.
 *
 * Intended for:
 *   - module health panels
 *   - dev-time registry audits
 *   - CI validation scripts
 *
 * @param {unknown} mod
 * @param {string} [label]
 * @returns {string[]} List of issue messages; empty means fully compliant.
 */
export function getEngineContractIssues(mod, label = "module") {
  /** @type {string[]} */
  const issues = [];

  // Run base contract first, collect each failure separately.
  try {
    assertModuleFollowsContract(mod, label);
  } catch (e) {
    issues.push(e instanceof Error ? e.message : String(e));
  }

  if (issues.length > 0) {
    // If the base contract already failed, skip engine-specific checks —
    // the module needs base fixes first.
    return issues;
  }

  // Check engineKinds separately so the message is clear.
  const m = /** @type {Record<string, unknown>} */ (mod);
  if (!("engineKinds" in m)) {
    issues.push(
      `${label}: engineKinds is missing — required for engine-aware modules`,
    );
  } else {
    try {
      assertValidEngineKinds(m.engineKinds, label);
    } catch (e) {
      issues.push(e instanceof Error ? e.message : String(e));
    }
  }

  return issues;
}

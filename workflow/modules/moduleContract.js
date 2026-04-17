/**
 * Workflow module shape — capabilities, isolated state, read-only health, UI hooks.
 *
 * Optional: execute(context) — workflow orchestration; state is read-only on context;
 * writes only via context.dispatch(moduleId, reducerKey, payload).
 * expectedContextVersion must equal the engine’s context.version or execute is skipped with an error.
 *
 * All modules must follow moduleContract. State logic must remain isolated per module.
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

/**
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
}

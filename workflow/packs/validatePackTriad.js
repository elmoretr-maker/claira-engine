/**
 * Triad: packRegistry row + packs/<id>/structure.json + domainRegistry[domainMode].
 */

import { existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { domainModeIsRegistered } from "../modules/capabilities/domainRegistry.js";
import { getPackRegistryEntry } from "./packRegistry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

export class InvalidPackError extends Error {
  /** @param {string[]} details */
  constructor(details) {
    super("Invalid pack");
    this.name = "InvalidPackError";
    /** @type {string[]} */
    this.details = Array.isArray(details) ? details : [];
  }
}

/**
 * @param {string} rawId
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePackTriad(rawId) {
  const id = String(rawId ?? "")
    .trim()
    .toLowerCase();
  /** @type {string[]} */
  const errors = [];

  if (!id || !/^[a-z0-9_-]+$/.test(id)) {
    errors.push("invalid pack id (use letters, numbers, hyphens, underscores)");
    return { valid: false, errors };
  }

  const entry = getPackRegistryEntry(id);
  if (!entry) {
    errors.push(`missing packRegistry entry for id "${id}"`);
  }

  const structPath = join(ROOT, "packs", id, "structure.json");
  if (!existsSync(structPath)) {
    errors.push(`missing packs/${id}/structure.json`);
  }

  if (entry && !domainModeIsRegistered(entry.domainMode)) {
    errors.push(
      `domainMode "${entry.domainMode}" is not defined in domainRegistry (pack "${id}")`,
    );
  }

  return { valid: errors.length === 0, errors };
}

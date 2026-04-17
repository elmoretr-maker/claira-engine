/**
 * Browser stub for `node:fs` — workflow feedback store skips disk when `storePath()` is null.
 * Real Node still resolves the actual `node:fs` (this file is only used in the Vite client graph).
 */

export function existsSync() {
  return false;
}

export function readFileSync() {
  return "";
}

export function mkdirSync() {}

export function writeFileSync() {}

export function unlinkSync() {}

export default {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
};

/**
 * Global application mode: simulation uses mock integrations; real expects live APIs only.
 * Allowed values: "simulation" | "real"
 *
 * Set via environment variable CLAIRA_SYSTEM_MODE (server-side Node) or
 * VITE_SYSTEM_MODE (browser build via import.meta.env). Defaults to "simulation".
 * No code change or rebuild required to switch modes on the server.
 */

const _envMode =
  (typeof process !== "undefined" ? process.env?.CLAIRA_SYSTEM_MODE : undefined) ??
  (typeof import.meta !== "undefined"
    ? /** @type {any} */ (import.meta)?.env?.VITE_SYSTEM_MODE
    : undefined) ??
  "";

/** @type {"simulation" | "real"} */
export const SYSTEM_MODE = _envMode === "real" ? "real" : "simulation";

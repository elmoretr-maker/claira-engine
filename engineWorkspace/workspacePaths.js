/**
 * Paths for per-account industry workspaces under repo-root `workspace/` (runtime data,
 * gitignored). Application logic lives here — not inside `workspace/` — so it stays tracked.
 */

import { mkdirSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = resolve(join(__dirname, ".."));

/**
 * @param {string | undefined} raw
 * @returns {string}
 */
export function sanitizeSegment(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "";
  return s.replace(/[^a-z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 80);
}

/**
 * @param {string} accountId
 * @param {"live"|"simulation"} mode
 * @param {string} industry
 * @returns {string} absolute context root
 */
export function getContextRoot(accountId, mode, industry) {
  const a = sanitizeSegment(accountId) || "local";
  const m = mode === "live" ? "live" : "simulation";
  const ind = sanitizeSegment(industry);
  return join(ENGINE_ROOT, "workspace", a, m, ind);
}

/**
 * @param {string} absResolvedRoot — resolved workspace folder
 * @returns {{ accountId: string, mode: "live"|"simulation", industry: string } | null}
 */
export function deriveWorkspaceScope(absResolvedRoot) {
  const root = resolve(absResolvedRoot);
  const rel = relative(ENGINE_ROOT, root).replace(/\\/g, "/");
  const parts = rel.split("/").filter(Boolean);
  if (parts.length < 4 || parts[0] !== "workspace") return null;
  const accountId = parts[1];
  const modeRaw = parts[2];
  const mode = modeRaw === "live" ? "live" : "simulation";
  const industry = parts.slice(3).join("/");
  if (!accountId || !industry) return null;
  return { accountId, mode, industry };
}

/**
 * Ensure `.claira/` metadata dir exists under the workspace root.
 *
 * @param {string} contextRoot
 * @returns {{ contextRoot: string, clairaDir: string }}
 */
export function ensureContextDirs(contextRoot) {
  const cr = resolve(contextRoot);
  const clairaDir = join(cr, ".claira");
  mkdirSync(clairaDir, { recursive: true });
  return { contextRoot: cr, clairaDir };
}

/**
 * @param {string} contextRoot
 * @param {string} candidatePath
 * @returns {boolean}
 */
export function isPathInsideContext(contextRoot, candidatePath) {
  const base = resolve(contextRoot);
  const child = resolve(candidatePath);
  if (child === base) return true;
  const rel = relative(base, child);
  return rel !== "" && !rel.startsWith("..") && !rel.includes("..");
}

/**
 * Persist contractor project snapshots under projects/{slug}/project.json
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";
import { slugReceiptSegment } from "./receiptPathSlug.js";
import { listReceiptsForContractorProject } from "./receiptStore.js";

/**
 * @param {string} cwd
 */
export function contractorProjectsRootAbs(cwd) {
  return join(resolve(String(cwd ?? "").trim() || process.cwd()), "projects");
}

/**
 * Find `Projects/{folder}` where slug(folder) matches canonical project slug.
 * @param {string} cwd
 * @param {string} canonicalSlug from slugReceiptSegment
 * @returns {string | null} posix-style relative path e.g. `Projects/My_House`
 */
export function discoverTimelineRootForSlug(cwd, canonicalSlug) {
  const root = resolve(String(cwd ?? "").trim() || process.cwd());
  const projectsDir = join(root, "Projects");
  if (!existsSync(projectsDir)) return null;
  const target = String(canonicalSlug ?? "").trim();
  if (!target) return null;
  for (const ent of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    let sl = "";
    try {
      sl = slugReceiptSegment(ent.name);
    } catch {
      continue;
    }
    if (sl === target) {
      const rel = relative(root, join(projectsDir, ent.name));
      return rel.split(/[/\\]/).join("/");
    }
  }
  return null;
}

/**
 * @param {{
 *   name: string,
 *   slug?: string,
 *   budget: number,
 *   assignees?: string[],
 *   sections?: string[],
 *   timelineRoot?: string,
 * }} payload
 */
export function saveContractorProject(cwd, payload) {
  const name = String(payload.name ?? "").trim();
  if (!name) throw new Error("project: name required");
  let slug = String(payload.slug ?? "").trim();
  if (!slug) slug = slugReceiptSegment(name);
  else slug = slugReceiptSegment(slug);
  const budgetRaw = payload.budget;
  const budget = typeof budgetRaw === "number" ? budgetRaw : Number(budgetRaw);
  if (!Number.isFinite(budget)) throw new Error("project: budget must be a finite number");
  const assignees = Array.isArray(payload.assignees)
    ? [...new Set(payload.assignees.map((x) => String(x ?? "").trim()).filter(Boolean))].sort()
    : [];
  const sections = Array.isArray(payload.sections)
    ? [...new Set(payload.sections.map((x) => String(x ?? "").trim()).filter(Boolean))].sort()
    : [];
  const root = contractorProjectsRootAbs(cwd);
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  let timelineRoot =
    typeof payload.timelineRoot === "string" && payload.timelineRoot.trim()
      ? payload.timelineRoot.trim().replace(/\\/g, "/")
      : "";
  if (!timelineRoot) {
    const auto = discoverTimelineRootForSlug(cwd, slug);
    if (auto) timelineRoot = auto;
  }
  if (timelineRoot) {
    const abs = resolve(cwd, ...timelineRoot.split("/").filter(Boolean));
    const projRoot = resolve(cwd, "Projects");
    if (!abs.startsWith(projRoot) || !existsSync(abs)) timelineRoot = "";
  }
  const doc = {
    name,
    slug,
    projectSlug: slug,
    budget: Number(budget.toFixed(2)),
    assignees,
    sections,
    ...(timelineRoot ? { timelineRoot } : {}),
    savedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, "project.json"), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return doc;
}

/**
 * @param {string} cwd
 * @param {string} slugIn
 */
export function loadContractorProject(cwd, slugIn) {
  const slug = slugReceiptSegment(String(slugIn ?? "").trim());
  const path = join(contractorProjectsRootAbs(cwd), slug, "project.json");
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return raw;
}

/**
 * @param {string} cwd
 * @returns {Array<{ slug: string, name: string, budget: number, assignees: string[], sections: string[], savedAt?: string }>}
 */
export function listContractorProjects(cwd) {
  const root = contractorProjectsRootAbs(cwd);
  if (!existsSync(root)) return [];
  /** @type {Array<{ slug: string, name: string, budget: number, assignees: string[], sections: string[], savedAt?: string }>} */
  const out = [];
  for (const ent of readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const j = join(root, ent.name, "project.json");
    if (!existsSync(j)) continue;
    try {
      const data = /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(j, "utf8")));
      out.push({
        slug: String(data.slug ?? ent.name),
        projectSlug: typeof data.projectSlug === "string" ? data.projectSlug : String(data.slug ?? ent.name),
        name: String(data.name ?? ent.name),
        budget: typeof data.budget === "number" ? data.budget : Number(data.budget),
        assignees: Array.isArray(data.assignees) ? data.assignees.map((x) => String(x)) : [],
        sections: Array.isArray(data.sections) ? data.sections.map((x) => String(x)) : [],
        timelineRoot: typeof data.timelineRoot === "string" ? data.timelineRoot : undefined,
        savedAt: typeof data.savedAt === "string" ? data.savedAt : undefined,
      });
    } catch {
      /* skip corrupt */
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Unique assignees and section labels from contractor receipts for a project (display name).
 * @param {string} cwd
 * @param {string} projectDisplayName
 */
export function deriveAssigneesSectionsForProject(cwd, projectDisplayName) {
  const receipts = listReceiptsForContractorProject(cwd, projectDisplayName);
  /** @type {Set<string>} */
  const assignees = new Set();
  /** @type {Set<string>} */
  const sections = new Set();
  for (const r of receipts) {
    const tags = r.tags && typeof r.tags === "object" && !Array.isArray(r.tags) ? r.tags : {};
    if (String(tags.domain ?? "").toLowerCase() !== "contractor") continue;
    const path = Array.isArray(tags.path) ? tags.path : [];
    if (path.length >= 3) sections.add(`${path[1]} › ${path[2]}`);
    const a = tags.assignee != null ? String(tags.assignee).trim() : "";
    if (a) assignees.add(a);
  }
  return {
    assignees: [...assignees].sort(),
    sections: [...sections].sort(),
  };
}

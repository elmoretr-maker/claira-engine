/**
 * Single source of truth: packs/<active_pack>/workflow_template.json (no config/ copy).
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { readActivePackIndustry } from "../../interfaces/packReference.js";
import { TRAINER_ROOT } from "./paths.js";

/**
 * @returns {Record<string, unknown> | null}
 */
export function readWorkflowTemplateFromActivePack() {
  const slug = readActivePackIndustry();
  if (!slug) return null;
  const p = join(TRAINER_ROOT, "packs", slug, "workflow_template.json");
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Regenerate missing reference assets and strengthen patterns (pack tooling only; not classifier).
 */

import { buildIndustryReport } from "./coverageEvaluator.js";
import { runPackGenerator } from "./runPackGenerator.js";

/**
 * @param {string} rawSlug
 * @returns {{ ok: boolean, error?: string, report: ReturnType<typeof buildIndustryReport> }}
 */
export function autoImproveIndustryPack(rawSlug) {
  const slug = String(rawSlug ?? "")
    .trim()
    .toLowerCase();
  if (!slug || !/^[a-z0-9_-]+$/.test(slug)) {
    return { ok: false, error: "Invalid pack slug." };
  }

  const gen = runPackGenerator(["--industry", slug, "--repair-coverage"]);
  if (!gen.ok) {
    return {
      ok: false,
      error: gen.stderr?.trim() || gen.stdout?.trim() || "Automatic improvement failed.",
      report: buildIndustryReport(slug),
    };
  }

  return { ok: true, report: buildIndustryReport(slug) };
}

/**
 * Shareable report snapshots: reports/{projectSlug}/{reportId}.json + .pdf
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { writeContractorReportPdfFile } from "./contractorPdfReport.js";

/**
 * @param {string} cwd
 */
export function contractorReportsRootAbs(cwd) {
  return join(resolve(String(cwd ?? "").trim() || process.cwd()), "reports");
}

/**
 * @param {string} cwd
 * @param {string} projectSlug
 * @param {string} reportId
 */
export function shareReportJsonPath(cwd, projectSlug, reportId) {
  return join(contractorReportsRootAbs(cwd), projectSlug, `${reportId}.json`);
}

/**
 * @param {string} cwd
 * @param {string} projectSlug
 * @param {string} reportId
 */
export function shareReportPdfPath(cwd, projectSlug, reportId) {
  return join(contractorReportsRootAbs(cwd), projectSlug, `${reportId}.pdf`);
}

/**
 * @param {string} cwd
 * @param {Record<string, unknown>} reportData
 * @param {string} projectSlug
 */
export async function writeShareReportFiles(cwd, reportData, projectSlug) {
  const slug = String(projectSlug ?? "").trim();
  if (!slug) throw new Error("share: project slug required");
  const reportId = randomUUID();
  const dir = join(contractorReportsRootAbs(cwd), slug);
  mkdirSync(dir, { recursive: true });
  const jsonPath = join(dir, `${reportId}.json`);
  const pdfPath = join(dir, `${reportId}.pdf`);
  writeFileSync(jsonPath, `${JSON.stringify(reportData, null, 2)}\n`, "utf8");
  await writeContractorReportPdfFile(pdfPath, reportData);
  return { reportId, projectSlug: slug, jsonPath, pdfPath };
}

/**
 * @param {string} cwd
 * @param {string} projectSlug
 * @param {string} reportId
 */
export function readShareReportJson(cwd, projectSlug, reportId) {
  const p = shareReportJsonPath(cwd, projectSlug, reportId);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

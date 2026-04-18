/**
 * Autonomous industry pack creation: connectivity → research → refine → template → generate_pack_system → validate → activate.
 * Does not import classifier or learning modules.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { writeAutoIndustryTemplate } from "./autoTemplate.js";
import { refineIndustryCategories } from "./categoryRefinement.js";
import { checkInternetConnection } from "./internetCheck.js";
import { buildIndustryKnowledge, normalizeCategoryKey, normalizePackSlug } from "./researchEngine.js";
import { runPackGenerator } from "./runPackGenerator.js";
import { buildIndustryReport } from "./coverageEvaluator.js";
import { validatePackIntegrity } from "./validatePackIntegrity.js";
import { writeComposedWorkflowTemplateForPack } from "./writeWorkflowTemplateForPack.js";
import { validateWorkflowModuleSelection } from "../../workflow/contracts/workflowRules.js";
import { registerCustomPackEntry } from "../../workflow/packs/customPacksStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

/**
 * @typedef {{ id: string, label: string, status: "pending" | "running" | "ok" | "error", detail?: string }} UiStep
 */

function makeUiSteps() {
  /** @type {UiStep[]} */
  return [
    { id: "connection", label: "Checking connection", status: "pending" },
    { id: "research", label: "Researching industry", status: "pending" },
    { id: "structure", label: "Structuring categories", status: "pending" },
    { id: "references", label: "Generating references", status: "pending" },
    { id: "build", label: "Building system", status: "pending" },
    { id: "finalize", label: "Finalizing", status: "pending" },
  ];
}

/**
 * @param {{ industryName: string, buildIntent?: string, selectedModules: string[] }} input
 * @returns {Promise<{
 *   ok: boolean,
 *   slug: string,
 *   displayName: string,
 *   steps: UiStep[],
 *   knowledge?: Record<string, unknown>,
 *   validation?: { ok: boolean, errors: string[] },
 *   error?: string,
 *   activated?: boolean,
 *   needsUserDecision?: boolean,
 *   report?: Record<string, unknown>,
 * }>}
 */
export async function createIndustryFromInput(input) {
  const steps = makeUiSteps();
  const setStep = (i, status, detail) => {
    if (steps[i]) {
      steps[i].status = status;
      if (detail != null) steps[i].detail = detail;
    }
  };

  const industryName = typeof input?.industryName === "string" ? input.industryName : "";
  const buildIntent = typeof input?.buildIntent === "string" ? input.buildIntent : "";
  const displayName = industryName.trim();
  if (!displayName) {
    return { ok: false, slug: "", displayName: "", steps, error: "Industry name is required." };
  }

  const selectedModules = Array.isArray(input?.selectedModules)
    ? input.selectedModules.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  const selectionError = validateWorkflowModuleSelection(selectedModules);
  if (selectionError) {
    return { ok: false, slug: "", displayName, steps, error: selectionError };
  }

  const slug = normalizePackSlug(displayName);
  if (!slug) {
    return {
      ok: false,
      slug: "",
      displayName,
      steps,
      error: "Could not derive a valid pack slug (use letters and numbers).",
    };
  }

  const packDir = join(ROOT, "packs", slug);
  const templatePath = join(ROOT, "templates", `${slug}.js`);

  if (existsSync(packDir)) {
    return {
      ok: false,
      slug,
      displayName,
      steps,
      error: `Pack folder already exists: packs/${slug}. Choose another name or add categories manually.`,
    };
  }

  let wroteAutoTemplate = false;
  let createdPackDir = false;

  const cleanupPartial = () => {
    try {
      if (createdPackDir && existsSync(packDir)) {
        rmSync(packDir, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
    try {
      if (wroteAutoTemplate && existsSync(templatePath)) {
        rmSync(templatePath, { force: true });
      }
    } catch {
      /* ignore */
    }
  };

  setStep(0, "running");
  const net = await checkInternetConnection();
  if (!net.connected) {
    setStep(0, "error", net.detail);
    return {
      ok: false,
      slug,
      displayName,
      steps,
      error: "Internet connection required for research. Connect and use Retry.",
    };
  }
  setStep(0, "ok", net.detail);

  setStep(1, "running");
  let knowledge;
  try {
    knowledge = await buildIndustryKnowledge(displayName, { useCache: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStep(1, "error", msg);
    return { ok: false, slug, displayName, steps, error: msg };
  }
  setStep(1, "ok", `${knowledge.queriesUsed.length} queries · ${knowledge.categories.length} raw categories`);

  setStep(2, "running");
  let catKeys;
  try {
    catKeys = refineIndustryCategories(knowledge.categories, displayName);
    if (catKeys.length < 5) {
      throw new Error(`Need at least 5 categories after refinement; got ${catKeys.length}.`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStep(2, "error", msg);
    return { ok: false, slug, displayName, steps, knowledge, error: msg };
  }
  setStep(2, "ok", `${catKeys.length} categories: ${catKeys.join(", ")}`);

  setStep(3, "running");
  try {
    const hadTemplate = existsSync(templatePath);
    if (!hadTemplate) {
      writeAutoIndustryTemplate({
        slug,
        displayName: knowledge.displayName,
        documentTypes: knowledge.documentTypes,
        workflows: knowledge.workflows,
      });
      wroteAutoTemplate = true;
    }

    const empty = runPackGenerator(["--industry", slug]);
    if (!empty.ok) {
      throw new Error(empty.stderr || empty.stdout || "Empty pack generation failed");
    }
    createdPackDir = true;

    catKeys = [...new Set(catKeys.map((c) => normalizeCategoryKey(c)).filter(Boolean))];
    for (const ck of catKeys) {
      const gen = runPackGenerator(["--industry", slug, "--category", ck]);
      if (!gen.ok) {
        throw new Error(gen.stderr || gen.stdout || `Failed on category ${ck}`);
      }
    }

    const refPath = join(packDir, "reference.json");
    const ref = JSON.parse(readFileSync(refPath, "utf8"));
    if (!ref || typeof ref !== "object") throw new Error("reference.json invalid");
    ref.pack = {
      label: knowledge.displayName,
      inputVerb: `Add ${knowledge.displayName.toLowerCase()} files`,
      workflowSource: "generated",
      intents: [
        { value: "workflow", label: `Sort & route — ${knowledge.displayName}` },
        { value: "custom", label: "Custom" },
      ],
    };
    writeFileSync(refPath, `${JSON.stringify(ref, null, 2)}\n`, "utf8");
    setStep(3, "ok", `Template ${hadTemplate ? "(existing)" : "(auto-generated)"} · ${catKeys.length} categories`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStep(3, "error", msg);
    cleanupPartial();
    return { ok: false, slug, displayName, steps, knowledge, error: msg };
  }

  setStep(4, "running");
  const validation = validatePackIntegrity(slug);
  if (!validation.ok) {
    const summary = validation.errors.join("; ");
    setStep(4, "error", summary);
    cleanupPartial();
    return {
      ok: false,
      slug,
      displayName,
      steps,
      knowledge,
      validation,
      error: `Validation failed: ${summary}`,
    };
  }
  setStep(4, "ok", "Validation passed");
  try {
    writeComposedWorkflowTemplateForPack(packDir, displayName, buildIntent, slug, selectedModules);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStep(4, "error", msg);
    cleanupPartial();
    return {
      ok: false,
      slug,
      displayName,
      steps,
      knowledge,
      validation,
      error: msg,
    };
  }

  try {
    registerCustomPackEntry({
      id: slug,
      name: displayName,
      domainMode: "general",
    });
  } catch (regErr) {
    console.warn("registerCustomPackEntry:", regErr);
  }

  const report = buildIndustryReport(slug);
  const prof = report.useCaseProfile?.id ?? "general";
  console.log(`Industry build: ${slug} → ${report.overallScore}% (${report.rating}, ${prof})`);

  setStep(5, "running");
  if (report.rating === "high") {
    try {
      const { loadIndustryPack } = await import("../loadIndustryPack.js");
      await loadIndustryPack(slug);
      setStep(5, "ok", `Coverage ${report.overallScore}% (high) — pack activated`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStep(5, "error", msg);
      return {
        ok: false,
        slug,
        displayName,
        steps,
        knowledge,
        validation,
        report,
        error: `Activation failed: ${msg}. Pack exists under packs/${slug} — try Load from the list.`,
      };
    }
    return {
      ok: true,
      slug,
      displayName,
      steps,
      knowledge,
      validation,
      report,
      activated: true,
      needsUserDecision: false,
    };
  }

  setStep(5, "ok", `Coverage ${report.overallScore}% (${report.rating}) — confirm activation in the report below`);
  return {
    ok: true,
    slug,
    displayName,
    steps,
    knowledge,
    validation,
    report,
    activated: false,
    needsUserDecision: true,
  };
}

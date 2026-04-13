/**
 * Reference coverage scoring for generated packs (not used by classifier).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const KW_MIN = 10;
const WEIGHT = 20; // five dimensions × 20 = 100

/**
 * @typedef {"medical" | "financial" | "general"} UseCaseId
 * @typedef {{ id: UseCaseId, label: string, highMin: number, passableMin: number }} UseCaseProfile
 */

/** @type {Record<UseCaseId, UseCaseProfile>} */
export const USE_CASE_PROFILES = {
  medical: { id: "medical", label: "Medical / clinical", highMin: 90, passableMin: 75 },
  financial: { id: "financial", label: "Financial", highMin: 85, passableMin: 70 },
  general: { id: "general", label: "General", highMin: 80, passableMin: 60 },
};

/**
 * @param {string} packSlug
 * @param {string} [packDisplayText] — e.g. reference.json pack.label
 * @returns {UseCaseProfile}
 */
export function detectUseCaseProfile(packSlug, packDisplayText = "") {
  const s = `${String(packSlug ?? "")} ${String(packDisplayText ?? "")}`.toLowerCase();
  if (
    /medical|clinical|health|hospital|patient|physician|diagnos|pharma|clinic|ehr|emr|hipaa|triag|icu|surgery/.test(
      s,
    )
  ) {
    return USE_CASE_PROFILES.medical;
  }
  if (
    /financ|bank|banking|insur|billing|payment|accounting|fintech|loan|credit|ledger|invoice|trading|tax\b|audit\b/.test(
      s,
    )
  ) {
    return USE_CASE_PROFILES.financial;
  }
  return USE_CASE_PROFILES.general;
}

/**
 * @param {number} score
 * @param {UseCaseProfile} [profile]
 * @returns {"high" | "passable" | "insufficient"}
 */
export function ratingFromOverallScore(score, profile = USE_CASE_PROFILES.general) {
  const s = Number(score);
  if (!Number.isFinite(s)) return "insufficient";
  if (s >= profile.highMin) return "high";
  if (s >= profile.passableMin) return "passable";
  return "insufficient";
}

/**
 * @param {string} absDir
 * @returns {string[]}
 */
function listFilesSafe(absDir) {
  if (!existsSync(absDir)) return [];
  try {
    return readdirSync(absDir).filter((name) => {
      try {
        return statSync(join(absDir, name)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/**
 * @param {"high"|"medium"|"low"} severity
 * @param {string} code
 * @param {string} message
 * @returns {{ severity: "high"|"medium"|"low", code: string, message: string, display: string }}
 */
export function makeCoverageIssue(severity, code, message) {
  const tag = severity.toUpperCase();
  return { severity, code, message, display: `[${tag}] ${message}` };
}

/**
 * @param {string} packSlug
 * @returns {{ categoryScores: Record<string, number>, overallScore: number }}
 */
export function evaluatePackCoverage(packSlug) {
  const slug = String(packSlug ?? "").trim().toLowerCase();
  /** @type {Record<string, number>} */
  const categoryScores = {};

  if (!slug || !/^[a-z0-9_-]+$/.test(slug)) {
    return { categoryScores: {}, overallScore: 0 };
  }

  const packDir = join(ROOT, "packs", slug);
  const structPath = join(packDir, "structure.json");
  const patternsPath = join(packDir, "reference_assets", "patterns.json");
  const procPath = join(packDir, "reference_assets", "processes.json");

  if (!existsSync(structPath)) {
    return { categoryScores: {}, overallScore: 0 };
  }

  /** @type {Record<string, string[]>} */
  let categories = {};
  try {
    const structure = JSON.parse(readFileSync(structPath, "utf8"));
    categories =
      structure?.categories && typeof structure.categories === "object" && !Array.isArray(structure.categories)
        ? structure.categories
        : {};
  } catch {
    return { categoryScores: {}, overallScore: 0 };
  }

  /** @type {Record<string, unknown>} */
  let patterns = {};
  if (existsSync(patternsPath)) {
    try {
      const p = JSON.parse(readFileSync(patternsPath, "utf8"));
      patterns = p && typeof p === "object" && !Array.isArray(p) ? p : {};
    } catch {
      patterns = {};
    }
  }

  /** @type {Record<string, unknown>} */
  let processes = {};
  if (existsSync(procPath)) {
    try {
      const pr = JSON.parse(readFileSync(procPath, "utf8"));
      processes = pr && typeof pr === "object" && !Array.isArray(pr) ? pr : {};
    } catch {
      processes = {};
    }
  }

  const keys = Object.keys(categories).sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) {
    return { categoryScores: {}, overallScore: 0 };
  }

  for (const cat of keys) {
    let score = 0;
    const words = categories[cat];
    if (Array.isArray(words) && words.filter((w) => String(w).trim()).length >= KW_MIN) {
      score += WEIGHT;
    }

    const pat = patterns[cat];
    if (pat && typeof pat === "object" && !Array.isArray(pat)) {
      const po = /** @type {Record<string, unknown>} */ (pat);
      const kws = po.keywords;
      if (Array.isArray(kws) && kws.filter((x) => String(x).trim()).length > 0) {
        score += WEIGHT;
      }
    }

    const docDir = join(packDir, "reference_assets", "documents", cat);
    const docs = listFilesSafe(docDir);
    if (docs.length > 0) score += WEIGHT;

    const imgDir = join(packDir, "reference_assets", "images", cat);
    const imgs = listFilesSafe(imgDir).filter((n) => n.toLowerCase().endsWith(".png"));
    if (imgs.length > 0) score += WEIGHT;

    if (processes[cat] && typeof processes[cat] === "object") {
      score += WEIGHT;
    }

    categoryScores[cat] = Math.min(100, score);
  }

  const values = Object.values(categoryScores);
  const overallScore =
    values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;

  return { categoryScores, overallScore };
}

/**
 * @param {string} cat
 * @param {Record<string, string[]>} categories
 * @param {Record<string, unknown>} patterns
 * @param {Record<string, unknown>} processes
 * @param {string} packDir
 * @returns {ReturnType<typeof makeCoverageIssue>[]}
 */
function issuesForCategory(cat, categories, patterns, processes, packDir) {
  /** @type {ReturnType<typeof makeCoverageIssue>[]} */
  const issues = [];
  const words = categories[cat];
  const kwCount = Array.isArray(words) ? words.filter((w) => String(w).trim()).length : 0;
  if (kwCount < KW_MIN) {
    issues.push(
      makeCoverageIssue(
        "high",
        "expected_elements",
        `Missing expected elements (keywords ${kwCount}; need ≥${KW_MIN})`,
      ),
    );
  }

  const pat = patterns[cat];
  if (!pat || typeof pat !== "object" || Array.isArray(pat)) {
    issues.push(makeCoverageIssue("medium", "weak_patterns", "Weak pattern definition (no patterns.json entry)"));
  } else {
    const kws = /** @type {Record<string, unknown>} */ (pat).keywords;
    if (!Array.isArray(kws) || kws.filter((x) => String(x).trim()).length === 0) {
      issues.push(makeCoverageIssue("medium", "weak_patterns", "Weak pattern definition (no pattern keywords)"));
    }
  }

  const docDir = join(packDir, "reference_assets", "documents", cat);
  if (listFilesSafe(docDir).length === 0) {
    issues.push(
      makeCoverageIssue("medium", "missing_documents", "Missing structured document examples"),
    );
  }

  const imgDir = join(packDir, "reference_assets", "images", cat);
  const pngs = listFilesSafe(imgDir).filter((n) => n.toLowerCase().endsWith(".png"));
  if (pngs.length === 0) {
    issues.push(makeCoverageIssue("low", "missing_images", "Missing reference images"));
  }

  if (!processes[cat] || typeof processes[cat] !== "object") {
    issues.push(makeCoverageIssue("medium", "missing_processes", "Missing process definition"));
  }

  return issues;
}

/**
 * @param {ReturnType<typeof issuesForCategory>[]} allIssuesNested
 */
function collectRecommendedActions(allIssuesNested) {
  const codes = new Set();
  for (const list of allIssuesNested) {
    for (const iss of list) {
      codes.add(iss.code);
    }
  }
  /** @type {string[]} */
  const out = [];
  if (codes.has("expected_elements")) {
    out.push("Expand category keywords in structure.json (or use Improve automatically to generate more).");
  }
  if (codes.has("weak_patterns")) {
    out.push("Improve pattern definitions in reference_assets/patterns.json.");
  }
  if (codes.has("missing_documents")) {
    out.push("Add structured document examples under reference_assets/documents/<category>/.");
  }
  if (codes.has("missing_images")) {
    out.push("Add more reference images (PNG) under reference_assets/images/<category>/.");
  }
  if (codes.has("missing_processes")) {
    out.push("Add or regenerate process metadata in reference_assets/processes.json.");
  }
  if (out.length === 0) {
    out.push("Review category scores; add assets where coverage is below 100%.");
  }
  return out;
}

/**
 * @param {"high"|"passable"|"insufficient"} rating
 * @param {UseCaseProfile} profile
 * @param {{
 *   lowKeywords: number,
 *   weakPatterns: number,
 *   missingProcesses: number,
 *   missingDocuments: number,
 *   missingImages: number,
 * }} counts
 */
function buildConfidenceExplanation(rating, profile, counts) {
  const ratingLabel = rating.charAt(0).toUpperCase() + rating.slice(1);
  const intro = `This industry is considered ${ratingLabel} under the ${profile.label} profile (high ≥${profile.highMin}%, passable ≥${profile.passableMin}%) because:`;

  /** @type {string[]} */
  const bullets = [];
  if (counts.lowKeywords > 0) {
    bullets.push(
      `${counts.lowKeywords} categor${counts.lowKeywords === 1 ? "y has" : "ies have"} insufficient keywords (expected elements).`,
    );
  }
  if (counts.weakPatterns > 0) {
    bullets.push(
      `${counts.weakPatterns} categor${counts.weakPatterns === 1 ? "y has" : "ies have"} incomplete or weak patterns.`,
    );
  }
  if (counts.missingProcesses > 0) {
    bullets.push(
      `${counts.missingProcesses} categor${counts.missingProcesses === 1 ? "y is" : "ies are"} missing process metadata.`,
    );
  }
  if (counts.missingDocuments > 0) {
    bullets.push(
      `${counts.missingDocuments} categor${counts.missingDocuments === 1 ? "y lacks" : "ies lack"} structured document examples.`,
    );
  }
  if (counts.missingImages > 0) {
    bullets.push(
      `${counts.missingImages} categor${counts.missingImages === 1 ? "y is" : "ies are"} missing reference images.`,
    );
  }
  if (bullets.length === 0) {
    bullets.push("All checked dimensions meet thresholds for this rating.");
  }

  return { intro, bullets };
}

/**
 * @param {string} packSlug
 * @returns {{
 *   overallScore: number,
 *   rating: "high" | "passable" | "insufficient",
 *   useCaseProfile: UseCaseProfile,
 *   thresholds: { highMin: number, passableMin: number },
 *   categories: Array<{ key: string, score: number, issues: ReturnType<typeof makeCoverageIssue>[] }>,
 *   categoryScores: Record<string, number>,
 *   recommendedActions: string[],
 *   confidenceExplanation: { intro: string, bullets: string[] },
 * }}
 */
export function buildIndustryReport(packSlug) {
  const slug = String(packSlug ?? "").trim().toLowerCase();

  const packDir = join(ROOT, "packs", slug);
  let packLabel = "";
  const refPath = join(packDir, "reference.json");
  if (existsSync(refPath)) {
    try {
      const ref = JSON.parse(readFileSync(refPath, "utf8"));
      const pk = ref?.pack && typeof ref.pack === "object" ? ref.pack : {};
      packLabel = typeof pk.label === "string" ? pk.label : "";
    } catch {
      packLabel = "";
    }
  }

  const profile = detectUseCaseProfile(slug, packLabel);
  const { categoryScores, overallScore } = evaluatePackCoverage(slug);
  const rating = ratingFromOverallScore(overallScore, profile);

  const structPath = join(packDir, "structure.json");
  /** @type {Record<string, string[]>} */
  let categories = {};
  if (existsSync(structPath)) {
    try {
      const structure = JSON.parse(readFileSync(structPath, "utf8"));
      categories =
        structure?.categories && typeof structure.categories === "object" && !Array.isArray(structure.categories)
          ? structure.categories
          : {};
    } catch {
      categories = {};
    }
  }

  /** @type {Record<string, unknown>} */
  let patterns = {};
  const patternsPath = join(packDir, "reference_assets", "patterns.json");
  if (existsSync(patternsPath)) {
    try {
      const p = JSON.parse(readFileSync(patternsPath, "utf8"));
      patterns = p && typeof p === "object" && !Array.isArray(p) ? p : {};
    } catch {
      patterns = {};
    }
  }

  /** @type {Record<string, unknown>} */
  let processes = {};
  const procPath = join(packDir, "reference_assets", "processes.json");
  if (existsSync(procPath)) {
    try {
      const pr = JSON.parse(readFileSync(procPath, "utf8"));
      processes = pr && typeof pr === "object" && !Array.isArray(pr) ? pr : {};
    } catch {
      processes = {};
    }
  }

  const keys = Object.keys(categoryScores).sort((a, b) => a.localeCompare(b));
  const categoriesOut = keys.map((key) => ({
    key,
    score: categoryScores[key] ?? 0,
    issues: issuesForCategory(key, categories, patterns, processes, packDir),
  }));

  const allIssueLists = categoriesOut.map((c) => c.issues);
  const recommendedActions = collectRecommendedActions(allIssueLists);

  /** @type {{ lowKeywords: number, weakPatterns: number, missingProcesses: number, missingDocuments: number, missingImages: number }} */
  const counts = {
    lowKeywords: 0,
    weakPatterns: 0,
    missingProcesses: 0,
    missingDocuments: 0,
    missingImages: 0,
  };
  for (const c of categoriesOut) {
    for (const iss of c.issues) {
      if (iss.code === "expected_elements") counts.lowKeywords += 1;
      else if (iss.code === "weak_patterns") counts.weakPatterns += 1;
      else if (iss.code === "missing_processes") counts.missingProcesses += 1;
      else if (iss.code === "missing_documents") counts.missingDocuments += 1;
      else if (iss.code === "missing_images") counts.missingImages += 1;
    }
  }

  const confidenceExplanation = buildConfidenceExplanation(rating, profile, counts);

  return {
    overallScore,
    rating,
    useCaseProfile: profile,
    thresholds: { highMin: profile.highMin, passableMin: profile.passableMin },
    categories: categoriesOut,
    categoryScores,
    recommendedActions,
    confidenceExplanation,
  };
}

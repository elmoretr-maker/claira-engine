/**
 * Tax field synonyms for keyword / token-overlap matching (no layout).
 */

/** @type {Record<string, string[]>} */
export const TAX_FIELD_SYNONYMS = {
  net_income: ["net income", "total income", "line 9", "adjusted gross income", "agi"],
  gross_income: ["gross income", "total wages", "wages tips", "line 1", "wages salaries"],
  refund: ["refund", "amount refunded", "overpayment", "your refund"],
  taxable_income: ["taxable income", "taxable amount", "line 15"],
  tax_paid: ["tax paid", "total tax", "income tax", "amount you owe", "federal tax withheld", "withholding", "line 24"],
};

/** Human-readable labels for comparison / export (Title Case). */
export const TAX_FIELD_LABELS = {
  gross_income: "Gross Income",
  net_income: "Net Income",
  taxable_income: "Taxable Income",
  tax_paid: "Tax Paid",
  refund: "Refund",
};

/**
 * @param {string} fieldId
 * @returns {string}
 */
export function taxFieldDisplayLabel(fieldId) {
  const id = String(fieldId ?? "").trim();
  if (TAX_FIELD_LABELS[id]) return TAX_FIELD_LABELS[id];
  if (!id) return "";
  return id
    .split(/_+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Display groups for comparison UI (subset of field ids). */
export const TAX_FIELD_GROUPS = {
  Income: ["gross_income", "net_income", "taxable_income"],
  Taxes: ["tax_paid", "refund"],
};

/**
 * @returns {string[]}
 */
export function listTaxFieldGroupOrder() {
  return Object.keys(TAX_FIELD_GROUPS);
}

/**
 * @param {string} fieldId
 * @returns {string}
 */
export function groupForTaxFieldId(fieldId) {
  const id = String(fieldId ?? "").trim();
  for (const g of listTaxFieldGroupOrder()) {
    const ids = TAX_FIELD_GROUPS[g];
    if (Array.isArray(ids) && ids.includes(id)) return g;
  }
  return "Other";
}

/**
 * @returns {string[]}
 */
export function listTaxComparisonFieldIds() {
  return Object.keys(TAX_FIELD_SYNONYMS).sort((a, b) => a.localeCompare(b));
}

/**
 * @param {string} s
 */
function normText(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[$,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} text
 */
function tokens(text) {
  const t = normText(text);
  return new Set(
    t
      .split(/[^a-z0-9]+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2),
  );
}

/**
 * Jaccard similarity of token sets (0..1).
 * @param {Set<string>} a
 * @param {Set<string>} b
 */
function tokenJaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * @param {string} line
 * @param {string} phrase
 */
export function scoreLineAgainstPhrase(line, phrase) {
  const L = normText(line);
  const P = normText(phrase);
  if (!L || !P) return 0;
  if (L.includes(P)) return 0.85 + 0.1 * Math.min(1, P.length / 40);
  const tl = tokens(L);
  const tp = tokens(P);
  return tokenJaccard(tl, tp);
}

/**
 * @param {string} line
 * @param {string} fieldId
 */
export function bestSynonymScoreForField(line, fieldId) {
  const syns = TAX_FIELD_SYNONYMS[fieldId];
  if (!Array.isArray(syns)) return 0;
  let best = 0;
  for (const phrase of syns) {
    const s = scoreLineAgainstPhrase(line, phrase);
    if (s > best) best = s;
  }
  return best;
}

/**
 * Parse first plausible currency / number from a line (deterministic).
 * @param {string} line
 * @returns {{ value: number | null, raw: string | null }}
 */
export function extractNumberFromLine(line) {
  const s = String(line ?? "");
  const re = /(?:\$?\s*)?(\(?[\d,]+(?:\.\d{1,4})?\)?)/g;
  let best = /** @type {{ value: number, raw: string, len: number } | null} */ (null);
  let m;
  while ((m = re.exec(s)) !== null) {
    const raw = m[1];
    let t = raw.replace(/,/g, "");
    let neg = false;
    if (t.startsWith("(") && t.endsWith(")")) {
      neg = true;
      t = t.slice(1, -1);
    }
    const n = Number.parseFloat(t);
    if (!Number.isFinite(n)) continue;
    const val = neg ? -n : n;
    const len = raw.length;
    if (!best || len > best.len) best = { value: val, raw, len };
  }
  return best ? { value: best.value, raw: best.raw } : { value: null, raw: null };
}

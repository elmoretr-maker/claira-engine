/**
 * OCR text vs predicted label — additive validation (does not classify).
 * Keyword hints for downstream routing / review only (no ML).
 */

/** @type {ReadonlyArray<{ keywords: string[], label: string }>} */
const LABEL_KEYWORD_HINTS = [
  { keywords: ["invoice", "invoicing"], label: "documents" },
  { keywords: ["receipt", "statement", "bill to", "purchase order"], label: "documents" },
  { keywords: ["character", "characters", "npc", "protagonist"], label: "characters" },
  { keywords: ["terrain", "landscape", "ground tile"], label: "terrain" },
  { keywords: ["prop", "props", "furniture", "decoration"], label: "prop" },
  { keywords: ["debris", "rubble", "wreckage"], label: "debris" },
  { keywords: ["road", "highway", "asphalt"], label: "road" },
  { keywords: ["obstacle", "barrier", "barricade"], label: "obstacle" },
];

/**
 * First keyword hit wins (order in LABEL_KEYWORD_HINTS).
 * @param {string | null | undefined} text — raw OCR text
 * @returns {string | null} hint label or null
 */
export function suggestLabelFromText(text) {
  if (text == null) return null;
  const raw = String(text).trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  for (const { keywords, label } of LABEL_KEYWORD_HINTS) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) return label;
    }
  }
  return null;
}

/** @type {ReadonlyArray<{ keywords: string[], destination: string }>} */
const DESTINATION_KEYWORD_HINTS = [
  { keywords: ["invoice", "invoicing"], destination: "assets/finance" },
  { keywords: ["receipt", "statement", "bill to", "purchase order"], destination: "assets/documents" },
  { keywords: ["character", "characters", "npc", "protagonist"], destination: "assets/characters" },
  { keywords: ["terrain", "landscape", "ground tile"], destination: "assets/terrain" },
  { keywords: ["prop", "props", "furniture", "decoration"], destination: "assets/prop" },
  { keywords: ["debris", "rubble", "wreckage"], destination: "assets/debris" },
  { keywords: ["road", "highway", "asphalt"], destination: "assets/road" },
  { keywords: ["obstacle", "barrier", "barricade"], destination: "assets/obstacle" },
];

/**
 * Keyword → destination path hints (does not call the router).
 * @param {string | null | undefined} text — raw OCR text
 * @returns {string | null}
 */
export function suggestDestinationFromText(text) {
  if (text == null) return null;
  const raw = String(text).trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  for (const { keywords, destination } of DESTINATION_KEYWORD_HINTS) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) return destination;
    }
  }
  return null;
}

/**
 * @param {string | null | undefined} text — raw OCR text
 * @param {string | null | undefined} predicted_label — classifier output label
 * @returns {{ matches: boolean, confidence: number, reason: string } | null}
 */
export function analyzeTextAgainstLabel(text, predicted_label) {
  if (text == null) return null;
  const raw = String(text).trim();
  if (!raw) return null;

  const label = String(predicted_label ?? "").trim().toLowerCase();
  if (!label) return null;

  const normText = raw.toLowerCase();
  const matches = normText.includes(label);

  return {
    matches,
    confidence: matches ? 1 : 0,
    reason: matches
      ? `predicted label "${label}" found in OCR text`
      : `predicted label "${label}" not found in OCR text`,
  };
}

/** @type {ReadonlyArray<{ a: RegExp, b: RegExp, message: string }>} */
const CONFLICTING_TERM_PAIRS = [
  { a: /\bleft\b/i, b: /\bright\b/i, message: "Conflicting directions: both 'left' and 'right' appear" },
  { a: /\bnorth\b/i, b: /\bsouth\b/i, message: "Conflicting directions: both 'north' and 'south' appear" },
  { a: /\beast\b/i, b: /\bwest\b/i, message: "Conflicting directions: both 'east' and 'west' appear" },
  { a: /\bincrease\b/i, b: /\bdecrease\b/i, message: "Conflicting terms: both 'increase' and 'decrease' appear" },
  { a: /\baccept\b/i, b: /\breject\b/i, message: "Conflicting terms: both 'accept' and 'reject' appear" },
];

/** @type {ReadonlyArray<{ phrase: string, insight: string }>} */
const SUSPICIOUS_PHRASES = [
  { phrase: "unknown", insight: 'Suspicious or vague wording: "unknown"' },
  { phrase: "unclear", insight: 'Suspicious or vague wording: "unclear"' },
  { phrase: "approximate", insight: 'Suspicious or vague wording: "approximate"' },
  { phrase: "illegible", insight: 'Suspicious or vague wording: "illegible"' },
  { phrase: "unreadable", insight: 'Suspicious or vague wording: "unreadable"' },
  { phrase: "to be determined", insight: 'Incomplete information: "to be determined"' },
  { phrase: "tbd", insight: 'Incomplete information: "TBD"' },
];

/**
 * Heuristic OCR / content insights (missing keywords, contradictions, vague phrasing).
 * @param {string | null | undefined} text
 * @returns {{ hasInsight: boolean, insights: string[] }}
 */
export function detectInsights(text) {
  if (text == null) return { hasInsight: false, insights: [] };
  const raw = String(text).trim();
  if (!raw) return { hasInsight: false, insights: [] };

  const lower = raw.toLowerCase();
  /** @type {string[]} */
  const insights = [];

  for (const { phrase, insight } of SUSPICIOUS_PHRASES) {
    if (lower.includes(phrase)) insights.push(insight);
  }

  for (const { a, b, message } of CONFLICTING_TERM_PAIRS) {
    if (a.test(raw) && b.test(raw)) insights.push(message);
  }

  if (/\binvoice\b/i.test(raw) && !/\btotal\b/i.test(raw) && !/\bamount\b/i.test(raw)) {
    insights.push("Invoice-like text but no 'total' or 'amount' — may be incomplete");
  }
  if (/\breceipt\b/i.test(raw) && !/\b(date|dated)\b/i.test(raw)) {
    insights.push("Receipt-like text but no date reference — may be incomplete");
  }

  if (raw.length < 12) {
    insights.push("Very little text extracted — content may be incomplete");
  }

  return { hasInsight: insights.length > 0, insights };
}

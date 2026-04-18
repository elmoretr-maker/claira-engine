/**
 * Best-effort receipt OCR: vendor, amount, date. Never throws — callers handle empty fields.
 */

import { createWorker } from "tesseract.js";

/**
 * @param {string} dataUrlOrBase64
 * @returns {Buffer}
 */
function toImageBuffer(dataUrlOrBase64) {
  const s = String(dataUrlOrBase64 ?? "").trim();
  if (!s) return Buffer.alloc(0);
  const b64 = s.includes("base64,") ? s.split("base64,").pop() ?? "" : s;
  try {
    return Buffer.from(b64, "base64");
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * @param {string} text
 * @returns {string | null}
 */
function pickAmount(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const joined = lines.join("\n");

  const labeled = /(?:total|amount|balance|due)\s*[:#]?\s*\$?\s*([\d,]+\.\d{2})\b/gi;
  let m;
  while ((m = labeled.exec(joined)) !== null) {
    const n = Number(String(m[1]).replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0 && n < 1e9) return n.toFixed(2);
  }

  /** @type {number | null} */
  let best = null;
  const dollar = /\$?\s*([\d,]+\.\d{2})\b/g;
  while ((m = dollar.exec(joined)) !== null) {
    const n = Number(String(m[1]).replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0 && n < 1e9) {
      if (best == null || n > best) best = n;
    }
  }
  return best != null ? best.toFixed(2) : null;
}

/**
 * @param {string} text
 * @returns {string | null} YYYY-MM-DD when parseable
 */
function pickDate(text) {
  const s = String(text ?? "");
  const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})\b/);
  if (us) {
    let mm = Number(us[1]);
    let dd = Number(us[2]);
    let yy = Number(us[3]);
    if (yy < 100) yy += 2000;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yy >= 2000 && yy < 2100) {
      return `${String(yy)}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }
  return null;
}

/**
 * First substantial line as vendor (skip common receipt headers).
 * @param {string} text
 */
function pickVendor(text) {
  const skip = /^(receipt|invoice|thank|store|date|time|cashier|terminal)\b/i;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 12)) {
    if (line.length < 2 || line.length > 80) continue;
    if (skip.test(line)) continue;
    if (/^\$?[\d,.]+$/.test(line)) continue;
    return line.replace(/\s+/g, " ").slice(0, 120);
  }
  return "";
}

/**
 * @param {number | null} ovr
 * @param {boolean} filled
 */
function fieldConf(ovr, filled) {
  if (ovr == null || !filled) return null;
  return Math.round(Math.min(100, Math.max(0, ovr)) * 10) / 10;
}

/**
 * @param {string | Buffer} image data URL, raw base64, or image bytes
 * @returns {Promise<{
 *   vendor: string,
 *   amount: string,
 *   date: string,
 *   rawText: string,
 *   confidence: { overall: number | null, vendor: number | null, amount: number | null, date: number | null },
 * }>}
 */
export async function extractReceiptData(image) {
  const emptyConf = { overall: null, vendor: null, amount: null, date: null };
  const buf = Buffer.isBuffer(image) ? image : toImageBuffer(String(image));
  if (!buf.length) {
    return { vendor: "", amount: "", date: "", rawText: "", confidence: emptyConf };
  }

  let worker;
  try {
    worker = await createWorker("eng");
    const {
      data: { text, confidence },
    } = await worker.recognize(buf);
    const t = String(text ?? "");
    const amount = pickAmount(t) ?? "";
    const date = pickDate(t) ?? "";
    const vendor = pickVendor(t);
    const ovr = typeof confidence === "number" && Number.isFinite(confidence) ? Math.min(100, Math.max(0, confidence)) : null;
    return {
      vendor,
      amount,
      date,
      rawText: t.slice(0, 8000),
      confidence: {
        overall: ovr,
        vendor: fieldConf(ovr, Boolean(vendor)),
        amount: fieldConf(ovr, Boolean(amount)),
        date: fieldConf(ovr, Boolean(date)),
      },
    };
  } catch {
    return { vendor: "", amount: "", date: "", rawText: "", confidence: emptyConf };
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Global receipt persistence under receipts/ — flat or nested:
 *   receipts/{domain}/{project}/{subproject}/{section}/{assignee}/{id}.{ext|json}
 * Tags are domain-agnostic; packs define meaning of path[] and assignee.
 */

import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { extname, join, relative, resolve, sep } from "path";
import { MAX_IMAGE_BYTES } from "./fitnessImagePathUnderCwd.js";
import { slugReceiptSegment } from "./receiptPathSlug.js";

export { slugReceiptSegment } from "./receiptPathSlug.js";

/** @type {Set<string>} */
const RECEIPT_IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);

/**
 * @param {string} root
 * @param {string} absPath
 */
function assertUnderRoot(root, absPath) {
  const rel = relative(root, absPath);
  if (rel.startsWith(`..${sep}`) || rel === ".." || rel.split(sep).includes("..")) {
    throw new Error("receipt: path escapes workspace");
  }
}

/**
 * @param {string} rawBase64
 * @param {string} [filename]
 * @returns {{ buffer: Buffer, ext: string }}
 */
export function decodeReceiptImageBase64(rawBase64, filename) {
  let s = String(rawBase64 ?? "").trim();
  let ext = ".jpg";
  const dataUrl = /^data:([^;]+);base64,(.+)$/s.exec(s);
  if (dataUrl) {
    const mime = dataUrl[1].toLowerCase();
    if (mime.includes("png")) ext = ".png";
    else if (mime.includes("webp")) ext = ".webp";
    else if (mime.includes("gif")) ext = ".gif";
    else if (mime.includes("bmp")) ext = ".bmp";
    else if (mime.includes("jpeg") || mime.includes("jpg")) ext = ".jpg";
    s = dataUrl[2];
  } else if (typeof filename === "string" && filename) {
    const e = extname(filename).toLowerCase();
    if (RECEIPT_IMAGE_EXT.has(e)) ext = e;
  }
  const buffer = Buffer.from(s, "base64");
  if (!buffer.length) throw new Error("receipt: empty image data");
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`receipt: image exceeds max size (${MAX_IMAGE_BYTES} bytes)`);
  }
  if (!RECEIPT_IMAGE_EXT.has(ext)) ext = ".jpg";
  return { buffer, ext };
}

/**
 * @typedef {{
 *   domain?: string,
 *   path?: string[],
 *   assignee?: string,
 *   project?: string,
 *   room?: string,
 *   category?: string,
 * }} ReceiptTagsNormalized
 */

/**
 * @param {unknown} raw
 * @returns {ReceiptTagsNormalized}
 */
export function normalizeReceiptTags(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const t = /** @type {Record<string, unknown>} */ (raw);
  /** @type {ReceiptTagsNormalized} */
  const out = {};
  if (t.domain != null && String(t.domain).trim()) out.domain = String(t.domain).trim().toLowerCase();
  if (t.assignee != null && String(t.assignee).trim()) out.assignee = String(t.assignee).trim();
  if (Array.isArray(t.path)) {
    out.path = t.path.slice(0, 3).map((x) => String(x ?? "").trim());
    while (out.path.length < 3) out.path.push("");
  }
  if (t.project != null && String(t.project).trim()) out.project = String(t.project).trim();
  if (t.room != null && String(t.room).trim()) out.room = String(t.room).trim();
  if (t.category != null && String(t.category).trim()) out.category = String(t.category).trim();
  return out;
}

/**
 * Display / filter triple: [project, subproject, section] from tags.path or legacy project/room/category.
 * @param {ReceiptTagsNormalized | Record<string, unknown> | undefined} tags
 * @returns {[string, string, string]}
 */
export function receiptPathTriple(tags) {
  const n = tags && typeof tags === "object" && !Array.isArray(tags) ? normalizeReceiptTags(tags) : {};
  if (Array.isArray(n.path) && n.path.length >= 3) {
    return [String(n.path[0] ?? "").trim(), String(n.path[1] ?? "").trim(), String(n.path[2] ?? "").trim()];
  }
  return [
    String(n.project ?? "").trim(),
    String(n.room ?? "").trim(),
    String(n.category ?? "").trim(),
  ];
}

/**
 * @typedef {{
 *   id: string,
 *   imagePath: string,
 *   vendor: string,
 *   amount: number,
 *   date: string,
 *   note: string,
 *   tags: ReceiptTagsNormalized,
 * }} ReceiptRecord
 */

/**
 * @param {unknown} raw
 * @returns {ReceiptRecord | null}
 */
function parseReceiptJson(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = String(r.id ?? "").trim();
  if (!id) return null;
  const amount = typeof r.amount === "number" ? r.amount : Number(r.amount);
  if (!Number.isFinite(amount)) return null;
  const tags = normalizeReceiptTags(r.tags);
  return {
    id,
    imagePath: String(r.imagePath ?? "").trim(),
    vendor: String(r.vendor ?? "").trim(),
    amount: Number(amount.toFixed(2)),
    date: String(r.date ?? "").trim(),
    note: String(r.note ?? "").trim(),
    tags,
  };
}

/**
 * @param {ReceiptRecord} rec
 * @param {ReceiptTagsNormalized} f
 * @returns {boolean}
 */
export function receiptMatchesListFilter(rec, f) {
  if (f == null || typeof f !== "object" || Object.keys(f).length === 0) return true;
  const rt = rec.tags;
  const [p0, p1, p2] = receiptPathTriple(rt);
  if (f.domain && String(rt?.domain ?? "").toLowerCase() !== String(f.domain).toLowerCase()) return false;
  if (f.assignee != null && String(f.assignee).trim() !== "") {
    const fa = String(f.assignee).trim();
    const ra = String(rt?.assignee ?? "").trim();
    let match = fa === ra;
    if (!match && ra) {
      try {
        match = slugReceiptSegment(fa) === slugReceiptSegment(ra);
      } catch {
        match = false;
      }
    }
    if (!match) return false;
  }
  if (f.project != null && String(f.project).trim() !== "") {
    const wantRaw = String(f.project).trim();
    const rtDom = String(rt?.domain ?? "").toLowerCase();
    if (rtDom === "contractor") {
      let wantSlug = wantRaw;
      try {
        wantSlug = slugReceiptSegment(wantRaw);
      } catch {
        /* compare raw only */
      }
      if (p0 !== wantRaw && p0 !== wantSlug && String(rt?.project ?? "").trim() !== wantRaw) return false;
    } else if (p0 !== wantRaw && String(rt?.project ?? "").trim() !== wantRaw) {
      return false;
    }
  }
  if (Array.isArray(f.path) && f.path.length > 0) {
    const want = f.path.map((x) => String(x ?? "").trim());
    const got = [p0, p1, p2];
    const slugPath = String(rt?.domain ?? "").toLowerCase() === "contractor";
    for (let i = 0; i < want.length; i++) {
      if (!want[i]) continue;
      if (slugPath) {
        let ws = want[i];
        try {
          ws = slugReceiptSegment(want[i]);
        } catch {
          /* keep trimmed */
        }
        if ((got[i] ?? "") !== ws) return false;
      } else if ((got[i] ?? "") !== want[i]) {
        return false;
      }
    }
  }
  if (f.room != null && String(f.room).trim() !== "") {
    if (String(rt?.room ?? "").trim() !== String(f.room).trim()) return false;
  }
  if (f.category != null && String(f.category).trim() !== "") {
    if (String(rt?.category ?? "").trim() !== String(f.category).trim()) return false;
  }
  return true;
}

/**
 * Whether listReceipts should apply tag filtering for API/module callers.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function listFilterHasContent(raw) {
  const n = normalizeReceiptTags(raw);
  if (n.domain) return true;
  if (n.assignee != null && String(n.assignee).trim() !== "") return true;
  if (Array.isArray(n.path) && n.path.some((x) => String(x ?? "").trim() !== "")) return true;
  if (n.project != null && String(n.project).trim() !== "") return true;
  if (n.room != null && String(n.room).trim() !== "") return true;
  if (n.category != null && String(n.category).trim() !== "") return true;
  return false;
}

/**
 * @param {ReceiptRecord[]} receipts
 * @returns {number}
 */
export function calculateReceiptTotal(receipts) {
  let t = 0;
  for (const rec of receipts) {
    if (rec && Number.isFinite(rec.amount)) t += rec.amount;
  }
  return Number(t.toFixed(2));
}

/**
 * @param {string} cwd
 * @returns {string}
 */
export function receiptStorageDirAbs(cwd) {
  const root = resolve(String(cwd ?? "").trim() || process.cwd());
  return join(root, "receipts");
}

/**
 * @param {string} dir
 * @param {string[]} outAbsJson
 */
function collectJsonFilesRecursive(dir, outAbsJson) {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) collectJsonFilesRecursive(full, outAbsJson);
    else if (ent.isFile() && ent.name.toLowerCase().endsWith(".json")) outAbsJson.push(full);
  }
}

/**
 * @param {string} cwd
 * @param {{ tags?: ReceiptTagsNormalized }} [filter]
 * @returns {ReceiptRecord[]}
 */
export function listReceipts(cwd, filter = {}) {
  const root = resolve(String(cwd ?? "").trim() || process.cwd());
  const base = receiptStorageDirAbs(root);
  /** @type {string[]} */
  const jsonFiles = [];
  collectJsonFilesRecursive(base, jsonFiles);

  const filterTags = normalizeReceiptTags(filter.tags);

  /** @type {ReceiptRecord[]} */
  const out = [];
  for (const absJson of jsonFiles) {
    try {
      const raw = JSON.parse(readFileSync(absJson, "utf8"));
      const rec = parseReceiptJson(raw);
      if (rec && receiptMatchesListFilter(rec, filterTags)) out.push(rec);
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
}

/**
 * Receipts for contractor cost rollup: domain === contractor only; path[0] slug matches project folder name.
 * @param {string} cwd
 * @param {string} projectName
 * @returns {ReceiptRecord[]}
 */
export function listReceiptsForContractorProject(cwd, projectName) {
  const p = String(projectName ?? "").trim();
  if (!p) return [];
  let wantSlug;
  try {
    wantSlug = slugReceiptSegment(p);
  } catch {
    return [];
  }
  return listReceipts(cwd).filter((r) => {
    if (String(r.tags?.domain ?? "").toLowerCase() !== "contractor") return false;
    const [p0] = receiptPathTriple(r.tags);
    return p0 === wantSlug;
  });
}

/**
 * Unique contractor project slugs (tags.domain === contractor, path[0]).
 * @param {string} cwd
 * @returns {string[]}
 */
export function listReceiptTaggedProjects(cwd) {
  const all = listReceipts(cwd);
  /** @type {Set<string>} */
  const s = new Set();
  for (const r of all) {
    if (String(r.tags?.domain ?? "").toLowerCase() !== "contractor") continue;
    const [p0] = receiptPathTriple(r.tags);
    if (p0) s.add(p0);
  }
  return [...s].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {string} cwd
 * @param {{
 *   vendor: string,
 *   amount: number,
 *   date?: string,
 *   note?: string,
 *   imageBase64: string,
 *   filename?: string,
 *   tags?: Record<string, unknown>,
 * }} payload
 * @returns {ReceiptRecord}
 */
export function addReceipt(cwd, payload) {
  const root = resolve(String(cwd ?? "").trim() || process.cwd());
  const vendor = String(payload.vendor ?? "").trim();
  if (!vendor) throw new Error("receipt: vendor required");

  const amountRaw = payload.amount;
  const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
  if (!Number.isFinite(amount)) throw new Error("receipt: amount must be a finite number");

  const note = String(payload.note ?? "").trim();
  let date = String(payload.date ?? "").trim();
  if (!date) date = new Date().toISOString().slice(0, 10);

  const rawTags =
    payload.tags != null && typeof payload.tags === "object" && !Array.isArray(payload.tags)
      ? /** @type {Record<string, unknown>} */ (payload.tags)
      : {};

  /** @type {ReceiptTagsNormalized} */
  let tags;
  if (String(rawTags.domain ?? "").trim().toLowerCase() === "contractor") {
    const pathRaw = Array.isArray(rawTags.path) ? rawTags.path : null;
    if (!pathRaw || pathRaw.length !== 3) {
      throw new Error("receipt: contractor path must be exactly [project, subproject, section] (no partial paths)");
    }
    const trimmed = pathRaw.map((x) => String(x ?? "").trim());
    if (trimmed.some((x) => !x)) {
      throw new Error("receipt: contractor path segments must all be non-empty");
    }
    const assigneeRaw = rawTags.assignee != null ? String(rawTags.assignee).trim() : "";
    if (!assigneeRaw) throw new Error("receipt: contractor assignee required");
    tags = {
      domain: "contractor",
      path: [slugReceiptSegment(trimmed[0]), slugReceiptSegment(trimmed[1]), slugReceiptSegment(trimmed[2])],
      assignee: slugReceiptSegment(assigneeRaw),
    };
  } else {
    tags = normalizeReceiptTags(payload.tags);
  }

  const pathOk =
    Array.isArray(tags.path) &&
    tags.path.length === 3 &&
    tags.path.every((x) => String(x ?? "").trim().length > 0);
  const useNested = Boolean(tags.domain && tags.assignee && String(tags.assignee).trim() && pathOk);

  if (tags.domain === "contractor" && !useNested) {
    throw new Error(
      "receipt: contractor receipts require tags.domain, tags.path [project, subproject, section], and tags.assignee",
    );
  }

  const { buffer, ext } = decodeReceiptImageBase64(payload.imageBase64, payload.filename);

  const id = randomBytes(12).toString("hex");
  const storeRoot = receiptStorageDirAbs(root);

  /** @type {string} */
  let targetDir;
  if (useNested) {
    const dom = /** @type {string} */ (tags.domain);
    const assignee = /** @type {string} */ (tags.assignee);
    const pathSegs = /** @type {string[]} */ (tags.path);
    targetDir = join(
      storeRoot,
      slugReceiptSegment(dom),
      slugReceiptSegment(pathSegs[0]),
      slugReceiptSegment(pathSegs[1]),
      slugReceiptSegment(pathSegs[2]),
      slugReceiptSegment(assignee),
    );
  } else {
    targetDir = storeRoot;
  }

  mkdirSync(targetDir, { recursive: true });

  const imageBasename = `${id}${ext}`;
  const imageAbs = join(targetDir, imageBasename);
  assertUnderRoot(root, imageAbs);
  writeFileSync(imageAbs, buffer);

  const relImage = relative(root, imageAbs).split(sep).join("/");

  /** @type {ReceiptRecord} */
  const record = {
    id,
    imagePath: relImage,
    vendor,
    amount: Number(amount.toFixed(2)),
    date,
    note,
    tags,
  };

  const jsonAbs = join(targetDir, `${id}.json`);
  assertUnderRoot(root, jsonAbs);
  writeFileSync(jsonAbs, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  return record;
}

import { existsSync, readFileSync } from "fs";
import { mkdir, readFile, writeFile, rename as renameFile } from "fs/promises";
import net from "net";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { analyzeImage } from "./clairaImagePipeline.js";
import { getCapabilityForEvent, describeCapability } from "./capabilities.js";
import { getClairaTtsRuntimeSummary, initClairaTtsService, synthesizeClairaSpeech } from "../lib/clairaTts.mjs";
import { loadRootEnv } from "./loadRootEnv.mjs";
import { resetTunnelStagingTree } from "../interfaces/tunnelStaging.js";
import { initRunClaira, operationArgsFromRunBody, runClaira } from "./runClaira.js";
import { computeStateDelta as computeStateDeltaHandler } from "./handlers/computeStateDelta.js";
import { interpretTrends as interpretTrendsHandler } from "./handlers/interpretTrends.js";
import { analyzePerformanceTrends as analyzePerformanceTrendsHandler } from "./handlers/analyzePerformanceTrends.js";
import { generateRecommendations as generateRecommendationsHandler } from "./handlers/generateRecommendations.js";
loadRootEnv();

/** Absolute path to the repository root (one level above server/). */
const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Content-type helper shared by pack-asset and tracking-asset routes.
 * @param {string} name
 */
function contentTypeForBasename(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

resetTunnelStagingTree();

void initClairaTtsService().catch((e) => {
  console.warn("[Claira TTS] init (non-fatal):", e instanceof Error ? e.message : e);
});

/** Last POST /run body + extracted fields (in-memory only; resets on process restart). */
/** @type {unknown} retained for future debugging / webhook echo */
let _lastWixWebhook = null;

/**
 * Best-effort extraction — Wix payload shapes vary by event.
 * @param {unknown} body
 */
function extractWixSummary(body) {
  if (body == null || typeof body !== "object") {
    return {
      eventType: null,
      instanceId: null,
      productData: null,
      siteData: null,
    };
  }
  const o = /** @type {Record<string, unknown>} */ (body);

  const eventType =
    (typeof o.eventType === "string" && o.eventType) ||
    (typeof o.event === "string" && o.event) ||
    (o.data != null && typeof o.data === "object" && typeof /** @type {Record<string, unknown>} */ (o.data).eventType === "string"
      ? /** @type {Record<string, unknown>} */ (o.data).eventType
      : null) ||
    (typeof o.action === "string" && o.action) ||
    null;

  let instanceId = null;
  if (typeof o.instanceId === "string") instanceId = o.instanceId;
  else if (o.metadata != null && typeof o.metadata === "object") {
    const m = /** @type {Record<string, unknown>} */ (o.metadata);
    if (typeof m.instanceId === "string") instanceId = m.instanceId;
  } else if (o.data != null && typeof o.data === "object") {
    const d = /** @type {Record<string, unknown>} */ (o.data);
    if (typeof d.instanceId === "string") instanceId = d.instanceId;
    else if (d.metadata != null && typeof d.metadata === "object") {
      const m2 = /** @type {Record<string, unknown>} */ (d.metadata);
      if (typeof m2.instanceId === "string") instanceId = m2.instanceId;
    }
  }

  let productData = null;
  if (o.product != null) productData = o.product;
  else if (o.products != null) productData = o.products;
  else if (o.data != null && typeof o.data === "object") {
    const d = /** @type {Record<string, unknown>} */ (o.data);
    if (d.product != null) productData = d.product;
    else if (d.products != null) productData = d.products;
    else if (d.entity != null) productData = d.entity;
  }

  let siteData = null;
  if (o.siteId != null || o.site != null) {
    siteData = { siteId: o.siteId ?? null, site: o.site ?? null };
  } else if (o.context != null && typeof o.context === "object") {
    siteData = o.context;
  } else if (o.data != null && typeof o.data === "object") {
    const d = /** @type {Record<string, unknown>} */ (o.data);
    if (d.siteId != null || d.site != null) siteData = { siteId: d.siteId ?? null, site: d.site ?? null };
  }

   return { eventType, instanceId, productData, siteData };
}

/** Products extracted from Wix webhooks (in-memory only; resets on process restart). */
const processedProducts = [];

/**
 * @param {unknown} body
 * @returns {Record<string, unknown> | null}
 */
function getBodyData(body) {
  if (body == null || typeof body !== "object") return null;
  const d = /** @type {Record<string, unknown>} */ (body).data;
  if (d == null || typeof d !== "object") return null;
  return /** @type {Record<string, unknown>} */ (d);
}

/**
 * Product payload only when present on `data` (Wix convention).
 * @param {Record<string, unknown> | null} data
 */
function getDataProductPayload(data) {
  if (data == null) return null;
  if (data.product != null) return data.product;
  if (data.products != null) return data.products;
  if (data.entity != null) return data.entity;
  return null;
}

/**
 * @param {unknown} productPayload
 * @returns {Record<string, unknown>[]}
 */
function normalizeToProductRecords(productPayload) {
  if (productPayload == null) return [];
  if (Array.isArray(productPayload)) {
    return productPayload.filter((p) => p != null && typeof p === "object").map((p) => /** @type {Record<string, unknown>} */ (p));
  }
  if (typeof productPayload === "object") return [/** @type {Record<string, unknown>} */ (productPayload)];
  return [];
}

/**
 * @param {Record<string, unknown> | null | undefined} p
 */
function extractProductName(p) {
  if (p == null || typeof p !== "object") return null;
  for (const key of ["name", "title", "productName"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * @param {Record<string, unknown> | null | undefined} p
 */
function extractProductId(p) {
  if (p == null || typeof p !== "object") return null;
  for (const key of ["_id", "id", "productId"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * @param {unknown} s
 */
function isHttpUrlString(s) {
  return typeof s === "string" && /^https?:\/\//i.test(s.trim());
}

/**
 * @param {unknown} node
 * @param {(u: string) => void} add
 */
function collectImageUrlsFromMediaNode(node, add) {
  if (node == null) return;
  if (typeof node === "string") {
    if (isHttpUrlString(node)) add(node.trim());
    return;
  }
  if (typeof node !== "object") return;
  const n = /** @type {Record<string, unknown>} */ (node);
  if (typeof n.url === "string" && isHttpUrlString(n.url)) add(n.url.trim());
  if (typeof n.fullUrl === "string" && isHttpUrlString(n.fullUrl)) add(n.fullUrl.trim());
  if (n.image != null) collectImageUrlsFromMediaNode(n.image, add);
  if (n.thumbnail != null) collectImageUrlsFromMediaNode(n.thumbnail, add);
}

/**
 * @param {Record<string, unknown> | null | undefined} p
 * @returns {string[]}
 */
function extractImageUrlsFromProduct(p) {
  /** @type {string[]} */
  const urls = [];
  const seen = new Set();
  /** @param {string} u */
  const add = (u) => {
    if (seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };

  if (p == null || typeof p !== "object") return urls;

  if (typeof p.image === "string" && isHttpUrlString(p.image)) add(p.image.trim());

  const media = p.media;
  if (media != null && typeof media === "object") {
    const m = /** @type {Record<string, unknown>} */ (media);
    const main = m.mainMedia ?? m.main_media;
    collectImageUrlsFromMediaNode(main, add);
  }
  if (p.mainMedia != null) collectImageUrlsFromMediaNode(p.mainMedia, add);

  const mediaItems = p.mediaItems;
  if (Array.isArray(mediaItems)) {
    for (const item of mediaItems) {
      if (item != null && typeof item === "object") {
        const it = /** @type {Record<string, unknown>} */ (item);
        if (typeof it.url === "string" && isHttpUrlString(it.url)) add(it.url.trim());
        if (it.image != null) collectImageUrlsFromMediaNode(it.image, add);
      }
    }
  }

  const images = p.images;
  if (Array.isArray(images)) {
    for (const im of images) {
      if (typeof im === "string" && isHttpUrlString(im)) add(im.trim());
      else collectImageUrlsFromMediaNode(im, add);
    }
  }

  return urls;
}

/**
 * Runs after webhook responds so /run stays fast.
 * @param {{ name: string | null; id: string | null; images: string[] }[]} entries
 */
/**
 * Run CLIP image analysis for each product entry and return the results.
 *
 * Results are also appended to the module-level `processedProducts` array for
 * backward-compatibility with any existing consumers of that array.
 *
 * @param {{ name: string | null, id: string | null, images: string[] }[]} entries
 * @returns {Promise<{ name: string | null, id: string | null, images: string[], analysis: any[] }[]>}
 */
async function runProductImagePipeline(entries) {
  /** @type {{ name: string | null, id: string | null, images: string[], analysis: any[] }[]} */
  const runResults = [];

  for (const { name, id, images } of entries) {
    const results = await Promise.all(images.map((u) => analyzeImage(u)));
    const entry = { name, id, images, analysis: results };
    processedProducts.push(entry);
    runResults.push(entry);

    console.log("Analysis result:");
    console.log("  product name:", name ?? "(not found)");
    const labels = results
      .map((r) =>
        r && typeof r === "object" && "classification" in r
          ? /** @type {{ classification?: { predicted_label?: string | null } }} */ (r).classification?.predicted_label ??
            "?"
          : "?",
      )
      .join(", ");
    console.log("  predicted labels:", labels);
  }

  return runResults;
}

/**
 * Detect `data.product` | `data.products` | `data.entity`, extract fields, log.
 * @param {unknown} body
 * @returns {{ name: string | null; id: string | null; images: string[] }[]}
 */
function detectAndLogProductsFromData(body) {
  /** @type {{ name: string | null; id: string | null; images: string[] }[]} */
  const entries = [];
  const data = getBodyData(body);
  if (data == null) return entries;

  const payload = getDataProductPayload(data);
  const records = normalizeToProductRecords(payload);
  if (records.length === 0) return entries;

  for (const rec of records) {
    const name = extractProductName(rec);
    const id = extractProductId(rec);
    const images = extractImageUrlsFromProduct(rec);
    console.log("Product detected:");
    console.log("  name:", name ?? "(not found)");
    console.log("  id:", id ?? "(not found)");
    console.log("  image URLs:", images.length ? images : "(none)");
    entries.push({ name, id, images });
  }
  return entries;
}

const app = express();
app.use(express.json({ limit: "50mb" }));

// =============================================================================
// ACCESS CONTROL — API key enforcement + per-key rate limiting
//
// Applies to:   /api/claira/*   and   /api/integrations/*
// Exempt:       /__claira/run  (internal / UI use — no key required)
//
// Modes (controlled by env):
//   CLAIRA_REQUIRE_API_KEY=false  → missing key is allowed; warning logged
//   CLAIRA_REQUIRE_API_KEY=true   → missing or invalid key → 401
//
// Rate limiting:
//   CLAIRA_RATE_LIMIT=60  → max requests per key per 60-second window
// =============================================================================

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REQUIRE_API_KEY = process.env.CLAIRA_REQUIRE_API_KEY === "true";
const RATE_LIMIT_MAX  = Number(process.env.CLAIRA_RATE_LIMIT) || 60;
const RATE_WINDOW_MS  = 60_000; // fixed 1-minute window

// ---------------------------------------------------------------------------
// API Key Registry — in-memory, seed with a test key for dev use.
// Replace / extend at runtime; a persistent store can be wired here later.
// ---------------------------------------------------------------------------

/**
 * @typedef {{ accountId: string, name: string, createdAt: string }} ApiKeyRecord
 */

/** @type {Map<string, ApiKeyRecord>} */
const apiKeys = new Map([
  [
    "test-key-123",
    { accountId: "acct_test_001", name: "Test Key", createdAt: new Date().toISOString() },
  ],
]);

// ---------------------------------------------------------------------------
// Rate Limiter — sliding-bucket counter per API key.
// ---------------------------------------------------------------------------

/** @type {Map<string, { count: number, resetAt: number }>} */
const rateLimitStore = new Map();

/**
 * Check and increment the rate-limit counter for a key.
 * Returns true if the request is within the allowed window.
 * @param {string} key
 */
function checkRateLimit(key) {
  const now = Date.now();
  let entry = rateLimitStore.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateLimitStore.set(key, entry);
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX;
}

// ---------------------------------------------------------------------------
// Auth Middleware
// ---------------------------------------------------------------------------

/**
 * Middleware applied to /api/claira/* and /api/integrations/*.
 *
 * Flow:
 *   1. Read x-claira-key header.
 *   2. If missing:
 *        SOFT mode → allow, log warning.
 *        HARD mode → 401.
 *   3. If present but unknown → 401.
 *   4. Rate-limit check → 429 if exceeded.
 *   5. Attach key.accountId to req.clairaAuth and override body.accountId
 *      to prevent caller spoofing.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function clairaAuthMiddleware(req, res, next) {
  const rid =
    (/** @type {string | undefined} */ (req.headers["x-claira-request-id"]) ?? "").slice(0, 64) ||
    Math.random().toString(36).slice(2, 10);

  const apiKey = /** @type {string | undefined} */ (req.headers["x-claira-key"]);

  // ── Missing key ────────────────────────────────────────────────────────────
  if (!apiKey) {
    if (REQUIRE_API_KEY) {
      console.warn(`[auth] rid=${rid} 401 missing-key path=${req.path}`);
      return res.status(401).json({ error: "API key required" });
    }
    // Soft mode — allow but signal that this should eventually be keyed.
    console.warn(`[auth] rid=${rid} missing API key (allowed in soft mode) path=${req.path}`);
    return next();
  }

  // ── Key validation ─────────────────────────────────────────────────────────
  const keyRecord = apiKeys.get(apiKey);
  if (!keyRecord) {
    console.warn(`[auth] rid=${rid} 401 invalid-key path=${req.path}`);
    return res.status(401).json({ error: "Invalid API key" });
  }

  // ── Rate limit ─────────────────────────────────────────────────────────────
  if (!checkRateLimit(apiKey)) {
    console.warn(
      `[auth] rid=${rid} key=valid account=${keyRecord.accountId} rate=limited path=${req.path}`
    );
    return res.status(429).json({ error: "Rate limit exceeded. Retry after 60 seconds." });
  }

  // ── Attach verified context ────────────────────────────────────────────────
  // Override body.accountId so downstream handlers always use the key-bound
  // accountId, preventing callers from claiming another account's identity.
  /** @type {any} */ (req).clairaAuth = { accountId: keyRecord.accountId, keyName: keyRecord.name };
  if (req.body && typeof req.body === "object") {
    req.body.accountId = keyRecord.accountId;
  }

  console.log(
    `[auth] rid=${rid} key=valid account=${keyRecord.accountId} rate=ok path=${req.path}`
  );
  next();
}

// Register middleware — must come before any /api/claira/* and /api/integrations/* routes.
app.use("/api/claira", clairaAuthMiddleware);
app.use("/api/integrations", clairaAuthMiddleware);

// ---------------------------------------------------------------------------
// Admin — dev-only key inspection (no secrets exposed beyond the key string).
// WARNING: protect or remove this route before production deployment.
// ---------------------------------------------------------------------------

app.get("/api/admin/keys", (_req, res) => {
  console.warn("[admin] /api/admin/keys accessed — remove or protect before production");
  const keys = Array.from(apiKeys.entries()).map(([k, record]) => ({
    key: k,
    accountId: record.accountId,
    name: record.name,
    createdAt: record.createdAt,
  }));
  res.json({ keys, total: keys.length });
});

// =============================================================================

app.get("/", (req, res) => {
  res.json({
    message: "Claira API running",
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "claira",
  });
});

/**
 * TTS service status (no audio; safe to call on app load).
 */
app.get("/__claira/tts/status", (req, res) => {
  try {
    res.json({ ok: true, ...getClairaTtsRuntimeSummary() });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

/**
 * Claira TTS — same path the UI uses (`fetch("/__claira/tts")`).
 * Proxied from Vite in dev; call this server directly in production or serve static UI behind the same host.
 */
app.post("/__claira/tts", async (req, res) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    if (!text.trim()) {
      return res.status(400).json({ error: "text required" });
    }
    const headerEdge =
      String(req.headers["x-claira-tts-provider"] ?? "").toLowerCase() === "edge";
    const forceEdge = req.body?.provider === "edge" || headerEdge;
    if (process.env.NODE_ENV !== "production") {
      console.log(
        "[Claira TTS] forceEdge=%s textLen=%s bodyProvider=%s headerEdge=%s",
        forceEdge,
        text.length,
        req.body?.provider ?? "(none)",
        headerEdge,
      );
    }
    const { synthesizeClairaSpeechEdge } = await import("../lib/clairaEdgeTtsVoice.mjs");
    const buf = forceEdge ? await synthesizeClairaSpeechEdge(text) : await synthesizeClairaSpeech(text);
    res.setHeader("Content-Type", "audio/mpeg");
    return res.status(200).send(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (process.env.NODE_ENV !== "production") {
      console.error("[Claira TTS] error:", msg);
    }
    return res.status(503).json({
      error: msg,
    });
  }
});

/**
 * Per-row capability attach (same behavior as Vite dev middleware `attachPipelineCapabilities`).
 */
app.post("/api/capabilities/attach", async (req, res) => {
  try {
    const { attachPipelineCapabilitiesApi } = await import("../interfaces/api.js");
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const cwd = typeof req.body?.cwd === "string" ? req.body.cwd : undefined;
    const domainMode = typeof req.body?.domainMode === "string" ? req.body.domainMode : undefined;
    const planMode = req.body?.planMode === "planned" ? "planned" : "single";
    const out = await attachPipelineCapabilitiesApi({ rows, cwd, domainMode, planMode });
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/attach]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/tax-compare", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = await api.taxDocumentComparisonApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/tax-compare]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/fitness-timeline", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = api.fitnessTimelineScanApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/fitness-timeline]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/contractor-timeline", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = api.contractorTimelineScanApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/contractor-timeline]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/contractor-cost", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = await api.contractorCostTrackingApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/contractor-cost]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/receipt-add", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = await api.receiptAddApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/receipt-add]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/receipt-list", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = api.receiptListApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/receipt-list]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/contractor-receipt-add", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = await api.contractorReceiptAddApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/contractor-receipt-add]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/contractor-receipt-list", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = api.contractorReceiptListApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/contractor-receipt-list]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/contractor-project-save", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = api.saveProjectApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/contractor-project-save]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/contractor-project-load", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = api.loadProjectApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/contractor-project-load]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/contractor-project-list", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = api.listProjectsApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/contractor-project-list]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/contractor-project-export-report", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = await api.exportProjectReportApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/contractor-project-export-report]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/contractor-project-export-pdf", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = await api.exportProjectPdfApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/contractor-project-export-pdf]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/contractor-generate-share-link", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = await api.generateShareLinkApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/contractor-generate-share-link]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/receipt-extract", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = await api.receiptExtractApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/receipt-extract]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * Shared contractor report snapshot (JSON). Workspace cwd = server process cwd.
 */
app.get("/api/reports/:projectSlug/:reportId", async (req, res) => {
  try {
    const { readShareReportJson } = await import("../workflow/modules/capabilities/contractorReportShare.js");
    const slug = String(req.params.projectSlug ?? "").trim();
    const id = String(req.params.reportId ?? "").trim();
    if (!slug || !id || /[./\\]/.test(slug) || !/^[a-z0-9._-]+$/i.test(id)) {
      return res.status(400).json({ ok: false, error: "invalid report path" });
    }
    const data = readShareReportJson(process.cwd(), slug, id);
    if (!data) {
      return res.status(404).json({ ok: false, error: "report not found" });
    }
    res.json({ ok: true, report: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/reports json]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * Shared contractor report PDF (binary).
 */
app.get("/api/reports/:projectSlug/:reportId/pdf", async (req, res) => {
  try {
    const { shareReportPdfPath } = await import("../workflow/modules/capabilities/contractorReportShare.js");
    const slug = String(req.params.projectSlug ?? "").trim();
    const id = String(req.params.reportId ?? "").trim();
    if (!slug || !id || /[./\\]/.test(slug) || !/^[a-z0-9._-]+$/i.test(id)) {
      return res.status(400).json({ ok: false, error: "invalid report path" });
    }
    const pdfAbs = shareReportPdfPath(process.cwd(), slug, id);
    if (!existsSync(pdfAbs)) {
      return res.status(404).json({ ok: false, error: "report PDF not found" });
    }
    const buf = readFileSync(pdfAbs);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="report-${id}.pdf"`);
    res.send(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/reports pdf]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/fitness-compare", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = await api.fitnessImageComparisonApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/fitness-compare]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/fitness-image-read", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = api.fitnessImageReadApi(req.body ?? {});
    if (!out.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/fitness-image-read]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.get("/api/capabilities/applied", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = await api.getAppliedCapabilityRecordsApi();
    if (!out.ok) {
      console.warn("[api/capabilities/applied] read failed:", out.error);
      return res.status(500).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/applied]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/applied", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = await api.saveAppliedCapabilityRecordApi(req.body ?? {});
    if (!out.ok) {
      console.warn("[api/capabilities/applied] save rejected:", out.error);
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/applied] save error:", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/preview-row", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = await api.previewCapabilityRowApi(req.body ?? {});
    if (!out.ok) {
      console.warn("[api/capabilities/preview-row]", out.error);
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/preview-row]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/capabilities/record-override", async (req, res) => {
  try {
    const api = await import("../interfaces/api.js");
    const out = api.recordCapabilityOverrideApi(req.body ?? {});
    if (!out.ok) {
      console.warn("[api/capabilities/record-override]", out.error);
      return res.status(400).json(out);
    }
    res.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[api/capabilities/record-override]", msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * Moves log — same file served by Vite dev middleware in `ui/vite.config.mjs`.
 * In production, the UI calls this directly on the Express server.
 */
app.get("/api/logs", async (req, res) => {
  try {
    const logPath = path.join(engineRoot, "logs", "moves.log");
    const body = existsSync(logPath) ? await readFile(logPath, "utf8") : "";
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(body);
  } catch (e) {
    res.status(500).setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(e instanceof Error ? e.message : String(e));
  }
});

/**
 * Pack reference-asset file server (images / documents from packs/<industry>/reference_assets/).
 * Mirrors the `/__claira/pack-asset` handler in Vite dev middleware.
 */
app.get("/__claira/pack-asset", (req, res) => {
  try {
    const industry = String(req.query.industry ?? "").trim().toLowerCase();
    const category = String(req.query.category ?? "").trim();
    const kindRaw = String(req.query.kind ?? "images").toLowerCase();
    const kind = kindRaw === "documents" ? "documents" : "images";
    const file = String(req.query.file ?? "").trim();
    if (!/^[a-z0-9_-]+$/i.test(industry)) return res.status(400).end("invalid industry");
    if (!category || category.includes("..") || /[/\\]/.test(category)) return res.status(400).end("invalid category");
    if (!/^[\w.-]+$/i.test(file)) return res.status(400).end("invalid file");
    const base = path.resolve(engineRoot, "packs", industry, "reference_assets", kind, category);
    const full = path.resolve(base, file);
    const rel = path.relative(base, full);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return res.status(403).end("forbidden");
    if (!existsSync(full)) return res.status(404).end("not found");
    const buf = readFileSync(full);
    res.setHeader("Content-Type", contentTypeForBasename(file));
    return res.end(buf);
  } catch (e) {
    res.status(500).setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(e instanceof Error ? e.message : String(e));
  }
});

/**
 * Tracking entity snapshot image server (tracking/images/<entity>/<file>).
 * Mirrors the `/__claira/tracking-asset` handler in Vite dev middleware.
 */
app.get("/__claira/tracking-asset", (req, res) => {
  try {
    const entity = String(req.query.entity ?? "").trim().toLowerCase();
    const file = String(req.query.file ?? "").trim();
    if (!/^e_[a-z0-9_-]+$/i.test(entity)) return res.status(400).end("invalid entity");
    if (!/^[\w.-]+$/i.test(file)) return res.status(400).end("invalid file");
    const base = path.resolve(engineRoot, "tracking", "images", entity);
    const full = path.resolve(base, file);
    const rel = path.relative(base, full);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return res.status(403).end("forbidden");
    if (!existsSync(full)) return res.status(404).end("not found");
    const buf = readFileSync(full);
    res.setHeader("Content-Type", contentTypeForBasename(file));
    return res.end(buf);
  } catch (e) {
    res.status(500).setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(e instanceof Error ? e.message : String(e));
  }
});

// =============================================================================
// CORE ENGINE API — PLATFORM-AGNOSTIC
// POST /__claira/run is the single execution interface for the Claira engine.
// It must remain free of any platform-specific logic (Wix, Shopify, etc.).
// Any platform that wants to use Claira calls this endpoint or wraps it.
// =============================================================================

// Lazily-resolved photo analyzer — imported once and cached.
let _photoAnalyzer = null;
/** @returns {Promise<import('../interfaces/photoAnalyzer.js')>} */
async function getPhotoAnalyzer() {
  if (!_photoAnalyzer) _photoAnalyzer = await import("../interfaces/photoAnalyzer.js");
  return _photoAnalyzer;
}

/**
 * Save base64 data-URL image files sent from the browser to a temporary
 * directory and return the resulting absolute file paths.
 *
 * Shared by buildProductCatalog and analyzePhotos so the pattern stays DRY.
 *
 * @param {unknown} imageFiles  Value of body.imageFiles (may be any shape)
 * @param {string}  prefix      Short label used in the temp folder name
 * @returns {Promise<string[]>}
 */
async function saveBase64ImageFiles(imageFiles, prefix = "upload") {
  if (!Array.isArray(imageFiles) || imageFiles.length === 0) return [];
  const tempDir = path.join(os.tmpdir(), `claira-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(tempDir, { recursive: true });
  const paths = await Promise.all(
    imageFiles.map(async (item) => {
      if (!item || typeof item.data !== "string" || !item.data.startsWith("data:image/")) return null;
      const commaIdx = item.data.indexOf(",");
      if (commaIdx === -1) return null;
      const base64 = item.data.slice(commaIdx + 1);
      const extMatch = item.data.match(/data:image\/([a-zA-Z0-9+]+);/);
      const ext = extMatch ? extMatch[1].replace("jpeg", "jpg") : "jpg";
      const safeName = typeof item.name === "string"
        ? item.name.replace(/[^a-zA-Z0-9._-]/g, "_")
        : `upload_${Math.random().toString(36).slice(2)}.${ext}`;
      const filePath = path.join(tempDir, safeName);
      await writeFile(filePath, Buffer.from(base64, "base64"));
      return filePath;
    }),
  );
  return /** @type {string[]} */ (paths.filter(Boolean));
}

/**
 * Dispatch table for POST /__claira/run.
 * Each key matches a body.kind value; each value is (body, api) => Promise<result>.
 * To add a new operation: add one entry here. The route handler never changes.
 * @type {Record<string, (body: Record<string, any>, api: any) => Promise<any>>}
 */
const CLAIRA_RUN_HANDLERS = {
  processFolder: async (body, api) => {
    const opts = {};
    if (body.cwd) opts.cwd = body.cwd;
    if (body.runtimeContext && typeof body.runtimeContext === "object") opts.runtimeContext = body.runtimeContext;
    if (body.workflowContext && typeof body.workflowContext === "object") opts.workflowContext = body.workflowContext;
    return api.processFolder(body.folderPath, opts);
  },
  processData: async (body, api) => {
    const opts = {};
    if (body.cwd) opts.cwd = body.cwd;
    if (body.runtimeContext && typeof body.runtimeContext === "object") opts.runtimeContext = body.runtimeContext;
    if (body.workflowContext && typeof body.workflowContext === "object") opts.workflowContext = body.workflowContext;
    return api.processData(body.items, opts);
  },
  applyDecision: (body, api) =>
    api.applyDecision({
      decision_type: body.decision_type,
      predicted_label: body.predicted_label,
      selected_label: body.selected_label ?? body.selected_room,
      selected_room: body.selected_room,
      confidence: body.confidence,
      filePath: body.filePath,
      file: body.filePath ?? body.file,
      scope: body.scope,
      extractedText: body.extractedText,
      classification: body.classification,
      mismatchSeverity: body.mismatchSeverity,
      mismatchFingerprint: body.mismatchFingerprint,
      mismatchReason: body.mismatchReason,
    }),
  getRiskInsights: (_body, api) => api.getRiskInsights(),
  ingestData: (body, api) =>
    api.ingestData(operationArgsFromRunBody(body), typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
  buildProductCatalog: async (body, api) => {
    // useVision defaults true — set to false to skip CLIP (faster, heuristic only).
    const useVision  = body.useVision  !== false;
    const outputMode = typeof body.outputMode === "string" ? body.outputMode : null;
    const outputPath = typeof body.outputPath === "string" ? body.outputPath
      : process.env.CLAIRA_PRODUCT_OUTPUT_PATH ?? null;

    // ── Step 0: Save any base64 imageFiles from browser uploads to temp disk ─
    const extraImagePaths = await saveBase64ImageFiles(body.imageFiles, "catalog");

    // ── Step 1: Heuristic grouping (pure data transform, no I/O) ─────────────
    let catalog = await api.buildProductCatalogApi({
      images:      [...(Array.isArray(body.images) ? body.images : []), ...extraImagePaths],
      productData: body.productData ?? null,
      folderPath:  typeof body.folderPath === "string" ? body.folderPath : null,
      platform:    typeof body.platform === "string" ? body.platform : null,
      recursive:   body.recursive === true,
    });

    // ── Step 2: CLIP analysis (inside the engine — never called from adapters) ─
    // runProductImagePipeline returns results; we capture them for enrichment.
    if (useVision) {
      const withImages = catalog.products.filter((p) => p.images.length > 0);
      if (withImages.length > 0) {
        const clipResults = await runProductImagePipeline(withImages);

        // ── Step 3: Enrich grouping metadata with CLIP labels (no re-run) ────
        catalog = api.enrichCatalogWithClipResultsApi(catalog, clipResults);
      }
    }

    // ── Step 3.5: Apply user-edited product names (client-side overrides) ────
    // When the browser sends editedProducts: [{ id, name }], override the
    // product name and suggestedTitle before file writing so that the folder
    // name reflects what the user chose. Falls back to AI names when absent.
    if (Array.isArray(body.editedProducts) && body.editedProducts.length > 0) {
      /** @type {Map<string, string>} */
      const editMap = new Map(
        body.editedProducts
          .filter((e) => e && typeof e.id === "string" && typeof e.name === "string" && e.name.trim())
          .map((e) => [e.id, e.name.trim()]),
      );

      if (editMap.size > 0) {
        catalog = {
          ...catalog,
          products: catalog.products.map((p) => {
            const editedName = editMap.get(p.id);
            if (!editedName || editedName === p.name) return p;
            return {
              ...p,
              name: editedName,
              metadata: {
                ...p.metadata,
                suggestedTitle: editedName,
                description: `Product images for ${editedName}.`,
                userEdited: true,
              },
            };
          }),
        };
        const editCount = catalog.products.filter((p) => p.metadata?.userEdited).length;
        console.log(`[buildProductCatalog] applied ${editCount} user-edited name(s)`);
      }
    }

    // ── Step 4: Optional file output ─────────────────────────────────────────
    if (outputMode === "files") {
      const fileStructure = await api.writeProductCatalogFilesApi(catalog, outputPath);
      catalog = { ...catalog, fileStructure };
    }

    return catalog;
  },

  // ── analyzePhotos ────────────────────────────────────────────────────────────
  /**
   * Analyze a set of photos for quality, blur, resolution, and semantic labels.
   * Reuses the CLIP image pipeline; never re-implements it.
   *
   * Body:
   *   images?:     string[]  — HTTP(S) URLs
   *   imageFiles?: Array<{ data: string, name: string }>  — base64 data-URLs from browser
   *
   * Returns:
   *   { results, groups: { best, good, poor }, summary }
   */
  analyzePhotos: async (body) => {
    // Step 0: Save browser-uploaded files to temp disk
    const extraPaths = await saveBase64ImageFiles(body.imageFiles, "photos");
    const allImages = [
      ...(Array.isArray(body.images) ? body.images : []),
      ...extraPaths,
    ];

    if (allImages.length === 0) {
      return {
        results: [],
        groups: { best: [], good: [], poor: [] },
        summary: { total: 0, best: 0, good: 0, poor: 0 },
      };
    }

    const tag = `[analyzePhotos] rid=${Math.random().toString(36).slice(2, 10)}`;
    console.log(`${tag} analyzing ${allImages.length} photo(s)`);

    // Step 1: Run CLIP pipeline (reuse; each photo is a single-image "product")
    const pseudoProducts = allImages.map((img, i) => ({
      id: `photo-${i}`,
      name: `Photo ${i + 1}`,
      images: [img],
    }));
    const clipResults = await runProductImagePipeline(pseudoProducts);

    // Build image → CLIP-result lookup
    /** @type {Map<string, Record<string, any> | null>} */
    const clipMap = new Map(clipResults.map((r) => [r.images[0], r.analysis?.[0] ?? null]));

    // Step 2: Per-image quality assessment + label inference + score
    const { assessImageQuality, inferPhotoLabels, computePhotoScore, groupPhotoResults } =
      await getPhotoAnalyzer();

    const results = await Promise.all(
      allImages.map(async (img, i) => {
        const clipResult = clipMap.get(img) ?? null;
        const quality = await assessImageQuality(img);
        const clipConf =
          clipResult?.classification?.confidence ?? clipResult?.confidence ?? 0;
        const labels = inferPhotoLabels(clipResult, quality);
        const score = computePhotoScore(labels, quality, clipConf);

        return {
          image: img,
          index: i,
          score:           Math.round(score * 100) / 100,
          tags:            labels,   // standardised field name for UI consumers
          quality: {
            sharpness:  Math.round(quality.sharpness * 100) / 100,
            resolution: quality.resolution,
            width:      quality.width,
            height:     quality.height,
          },
          clipLabel:      clipResult?.classification?.predicted_label ?? null,
          clipConfidence: Math.round(clipConf * 100) / 100,
        };
      }),
    );

    // Step 3: Group into quality tiers
    const groups = groupPhotoResults(results);

    console.log(
      `${tag} done — best:${groups.best.length} good:${groups.good.length} poor:${groups.poor.length}`,
    );

    return {
      results,
      groups,
      summary: {
        total: results.length,
        best:  groups.best.length,
        good:  groups.good.length,
        poor:  groups.poor.length,
      },
    };
  },

  getRooms: (_body, api) => api.getRooms(),
  getSuggestions: (_body, api) => api.getSuggestions(),
  getUserControlState: (_body, api) => api.getUserControlState(),
  setUserControlRule: (body, api) =>
    api.setUserControlRuleApi({
      predicted_label: typeof body.predicted_label === "string" ? body.predicted_label : "",
      effect: body.effect,
      enabled: body.enabled,
      remove: body.remove === true,
    }),
  loadIndustryPack: (body, api) => api.loadIndustryPack(body.industry),
  listIndustryPacks: (_body, api) => api.listIndustryPacksApi(),
  checkInternetConnection: (_body, api) => api.checkInternetConnectionApi(),
  previewIndustryModuleComposition: (body, api) =>
    api.previewIndustryModuleCompositionApi({
      industryName: typeof body.industryName === "string" ? body.industryName : "",
      buildIntent: typeof body.buildIntent === "string" ? body.buildIntent : "",
      guidedModuleSignals:
        body.guidedModuleSignals != null && typeof body.guidedModuleSignals === "object"
          ? body.guidedModuleSignals
          : undefined,
    }),
  createIndustryFromInput: (body, api) =>
    api.createIndustryFromInputApi({
      industryName: typeof body.industryName === "string" ? body.industryName : "",
      buildIntent: typeof body.buildIntent === "string" ? body.buildIntent : "",
      selectedModules: Array.isArray(body.selectedModules) ? body.selectedModules : [],
    }),
  confirmIndustryPackActivation: (body, api) =>
    api.confirmIndustryPackActivationApi({
      slug: typeof body.slug === "string" ? body.slug : "",
    }),
  getIndustryBuildReport: (body, api) =>
    api.getIndustryBuildReportApi({
      slug: typeof body.slug === "string" ? body.slug : "",
    }),
  autoImproveIndustryPack: (body, api) =>
    api.autoImproveIndustryPackApi({
      slug: typeof body.slug === "string" ? body.slug : "",
    }),
  getActiveReferenceAssets: (body, api) =>
    api.getActiveReferenceAssetsApi(
      typeof body.category === "string" ? body.category : "",
      typeof body.industry === "string" ? body.industry : undefined,
    ),
  getStructureCategories: (body, api) => api.getStructureCategories(body.cwd ? { cwd: body.cwd } : {}),
  getPackReference: (body, api) => api.getPackReference(body.cwd ? { cwd: body.cwd } : {}),
  getPackProcesses: (body, api) =>
    api.getPackProcesses({
      industry: typeof body.industry === "string" ? body.industry : undefined,
      cwd: body.cwd ? body.cwd : undefined,
    }),
  ensureCapabilityOutputFolders: (body, api) =>
    api.ensureCapabilityOutputFoldersApi(
      Array.isArray(body.selectedKeys) ? body.selectedKeys : [],
      body.cwd ? { cwd: body.cwd } : {},
    ),
  tunnelUploadStaged: (body, api) => {
    const files = Array.isArray(body.files) ? body.files : [];
    return api.tunnelUploadStaged(body.category, files, { uploadTag: body.uploadTag });
  },
  getIndustryFeatures: (body, api) =>
    api.getIndustryFeaturesApi({
      industry: typeof body.industry === "string" ? body.industry : "",
    }),
  getTrackingConfig: (body, api) =>
    api.getTrackingConfigApi({
      industry: typeof body.industry === "string" ? body.industry : "",
    }),
  categoryTrackingSupport: (body, api) =>
    api.categoryTrackingSupportApi({
      industry: typeof body.industry === "string" ? body.industry : "",
      categoryKey: typeof body.categoryKey === "string" ? body.categoryKey : "",
    }),
  listTrackingEntities: (body, api) =>
    api.listTrackingEntitiesApi({
      industry: typeof body.industry === "string" ? body.industry : "",
    }),
  createTrackingEntity: (body, api) =>
    api.createTrackingEntityApi({
      name: typeof body.name === "string" ? body.name : "",
      category: typeof body.category === "string" ? body.category : "",
      industry: typeof body.industry === "string" ? body.industry : "",
    }),
  addTrackingSnapshot: (body, api) =>
    api.addTrackingSnapshotApi({
      entityId: typeof body.entityId === "string" ? body.entityId : "",
      imageBase64: typeof body.imageBase64 === "string" ? body.imageBase64 : "",
      manualMetrics: body.manualMetrics && typeof body.manualMetrics === "object" ? body.manualMetrics : undefined,
      categoryKey: typeof body.categoryKey === "string" ? body.categoryKey : "",
      industrySlug: typeof body.industrySlug === "string" ? body.industrySlug : "",
    }),
  listTrackingSnapshots: (body, api) =>
    api.listTrackingSnapshotsApi({
      entityId: typeof body.entityId === "string" ? body.entityId : "",
    }),
  getTrackingProgress: (body, api) =>
    api.getTrackingProgressApi({
      entityId: typeof body.entityId === "string" ? body.entityId : "",
    }),

  // ── computeStateDelta ────────────────────────────────────────────────────────
  /**
   * Compute per-entity numerical state deltas from snapshot history and event logs.
   *
   * This is the first processing engine capability in the module workflow system
   * (plan.md §15, module: state_delta_computer). Pure function — no API calls,
   * no store writes. Implementation lives in server/handlers/computeStateDelta.js
   * for isolated testability.
   *
   * Input:  { snapshots[], deliveryEvents?, saleEvents? }
   * Output: { deltas: [{ entityId, startValue, endValue, netDelta, deliveryTotal, salesTotal }] }
   */
  computeStateDelta: (body) => computeStateDeltaHandler(body),

  // ── interpretTrends ──────────────────────────────────────────────────────────
  /**
   * Convert raw per-entity numerical deltas into directional trend data.
   *
   * Second processing engine capability (plan.md §15, module: trend_interpreter).
   * Pure function — no API calls, no store writes.
   * Implementation lives in server/handlers/interpretTrends.js for isolated testability.
   *
   * Input:  { deltas: [{ entityId, netDelta, periodCount? }] }
   * Output: { trends: [{ entityId, direction, velocity, periodCount }] }
   */
  interpretTrends: (body) => interpretTrendsHandler(body),

  // ── analyzePerformanceTrends ─────────────────────────────────────────────────
  /**
   * Rank entities by a selected performance metric (velocity, netDelta, or salesTotal).
   *
   * Third processing engine capability (plan.md §15, module: ranking_engine).
   * Pure function — no API calls, no store writes.
   * Implementation lives in server/handlers/analyzePerformanceTrends.js.
   *
   * Input:  { trends: [...], rankBy: "velocity"|"netDelta"|"salesTotal" }
   * Output: { entities: [{ entityId, label, rank, score }] }
   */
  analyzePerformanceTrends: (body) => analyzePerformanceTrendsHandler(body),

  // ── generateRecommendations ──────────────────────────────────────────────────
  /**
   * Convert ranked entities and alert signals into actionable recommendations.
   *
   * Fourth and final processing engine capability (plan.md §15, module: recommendation_generator).
   * Pure function — no API calls, no store writes.
   * Implementation lives in server/handlers/generateRecommendations.js.
   *
   * Input:  { alerts[], rankedEntities[], actionTypes? }
   * Output: { recommendations: [{ entityId, label, action, urgency, reason }] }
   */
  generateRecommendations: (body) => generateRecommendationsHandler(body),

  workspaceScan: (body, api) =>
    api.workspaceScanApi({
      accountId: typeof body.accountId === "string" ? body.accountId : undefined,
      mode: typeof body.mode === "string" ? body.mode : undefined,
      industry: typeof body.industry === "string" ? body.industry : "",
    }),
  workspaceSync: (body, api) =>
    api.workspaceSyncApi({
      accountId: typeof body.accountId === "string" ? body.accountId : undefined,
      mode: typeof body.mode === "string" ? body.mode : undefined,
      industry: typeof body.industry === "string" ? body.industry : "",
      operations: Array.isArray(body.operations) ? body.operations : [],
    }),
  workspaceSimulationIngest: (body, api) =>
    api.workspaceSimulationIngestApi({
      accountId: typeof body.accountId === "string" ? body.accountId : undefined,
      mode: typeof body.mode === "string" ? body.mode : undefined,
      industry: typeof body.industry === "string" ? body.industry : "",
      files: Array.isArray(body.files) ? body.files : [],
    }),
  workspaceGeneratorSnapshot: (body, api) =>
    api.workspaceGeneratorSnapshotApi({
      accountId: typeof body.accountId === "string" ? body.accountId : undefined,
      mode: typeof body.mode === "string" ? body.mode : undefined,
      industry: typeof body.industry === "string" ? body.industry : "",
    }),
  createTrainerClient: (body, api) =>
    api.createTrainerClientApi({
      displayName: typeof body.displayName === "string" ? body.displayName : "",
    }),
  listTrainerClients: (_body, api) => api.listTrainerClientsApi(),
  getTrainerClient: (body, api) =>
    api.getTrainerClientApi({
      entityId: typeof body.entityId === "string" ? body.entityId : "",
      clientId: typeof body.clientId === "string" ? body.clientId : "",
    }),
  getActiveWorkflowTemplate: (_body, api) => api.getActiveWorkflowTemplateApi(),
  listWorkflowCompositions: (_body, api) => api.listWorkflowCompositionsApi(),
  recordReasoningOverrideFeedback: (body, api) =>
    api.recordReasoningOverrideFeedbackApi(
      body.payload != null && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : body,
    ),
  taxDocumentComparison: (body, api) =>
    api.taxDocumentComparisonApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      domainMode: typeof body.domainMode === "string" ? body.domainMode : "tax",
      paths: Array.isArray(body.paths) ? body.paths : [],
      uploads: Array.isArray(body.uploads) ? body.uploads : [],
      selectedFields: Array.isArray(body.selectedFields) ? body.selectedFields : undefined,
      anomalyThresholdPct:
        typeof body.anomalyThresholdPct === "number" && Number.isFinite(body.anomalyThresholdPct)
          ? body.anomalyThresholdPct
          : undefined,
    }),
  fitnessTimelineScan: (body, api) =>
    api.fitnessTimelineScanApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
    }),
  contractorTimelineScan: (body, api) =>
    api.contractorTimelineScanApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
    }),
  contractorCostTracking: (body, api) =>
    api.contractorCostTrackingApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      project: typeof body.project === "string" ? body.project : undefined,
      initialCost: body.initialCost,
      currentCost: body.currentCost,
      receiptTotal: body.receiptTotal,
      manualSpendSupplement: body.manualSpendSupplement,
    }),
  receiptAdd: (body, api) =>
    api.receiptAddApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      vendor: typeof body.vendor === "string" ? body.vendor : "",
      amount: typeof body.amount === "number" ? body.amount : body.amount,
      date: typeof body.date === "string" ? body.date : undefined,
      note: typeof body.note === "string" ? body.note : undefined,
      imageBase64: typeof body.imageBase64 === "string" ? body.imageBase64 : "",
      filename: typeof body.filename === "string" ? body.filename : "",
      tags: body.tags != null && typeof body.tags === "object" && !Array.isArray(body.tags) ? body.tags : undefined,
    }),
  receiptList: (body, api) =>
    api.receiptListApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      tags: body.tags != null && typeof body.tags === "object" && !Array.isArray(body.tags) ? body.tags : undefined,
    }),
  contractorReceiptAdd: (body, api) =>
    api.contractorReceiptAddApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      project: typeof body.project === "string" ? body.project : "",
      room: typeof body.room === "string" ? body.room : undefined,
      vendor: typeof body.vendor === "string" ? body.vendor : "",
      amount: typeof body.amount === "number" ? body.amount : body.amount,
      date: typeof body.date === "string" ? body.date : undefined,
      note: typeof body.note === "string" ? body.note : undefined,
      imageBase64: typeof body.imageBase64 === "string" ? body.imageBase64 : "",
      filename: typeof body.filename === "string" ? body.filename : "",
    }),
  contractorReceiptList: (body, api) =>
    api.contractorReceiptListApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      project: typeof body.project === "string" ? body.project : undefined,
    }),
  contractorProjectSave: (body, api) =>
    api.saveProjectApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      name: typeof body.name === "string" ? body.name : "",
      slug: typeof body.slug === "string" ? body.slug : undefined,
      budget: body.budget,
      assignees: Array.isArray(body.assignees) ? body.assignees : undefined,
      sections: Array.isArray(body.sections) ? body.sections : undefined,
    }),
  contractorProjectLoad: (body, api) =>
    api.loadProjectApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      slug: typeof body.slug === "string" ? body.slug : "",
    }),
  contractorProjectList: (body, api) =>
    api.listProjectsApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
    }),
  contractorProjectExportReport: (body, api) =>
    api.exportProjectReportApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      project: typeof body.project === "string" ? body.project : "",
      ...(body.budgetContext != null && typeof body.budgetContext === "object" && !Array.isArray(body.budgetContext)
        ? { budgetContext: body.budgetContext }
        : {}),
      ...(body.initialBudget != null ? { initialBudget: body.initialBudget } : {}),
      ...(body.manualSpendSupplement != null ? { manualSpendSupplement: body.manualSpendSupplement } : {}),
    }),
  contractorProjectExportPdf: (body, api) =>
    api.exportProjectPdfApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      project: typeof body.project === "string" ? body.project : "",
      ...(body.budgetContext != null && typeof body.budgetContext === "object" && !Array.isArray(body.budgetContext)
        ? { budgetContext: body.budgetContext }
        : {}),
      ...(body.initialBudget != null ? { initialBudget: body.initialBudget } : {}),
      ...(body.manualSpendSupplement != null ? { manualSpendSupplement: body.manualSpendSupplement } : {}),
    }),
  contractorGenerateShareLink: (body, api) =>
    api.generateShareLinkApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      project: typeof body.project === "string" ? body.project : "",
      ...(body.budgetContext != null && typeof body.budgetContext === "object" && !Array.isArray(body.budgetContext)
        ? { budgetContext: body.budgetContext }
        : {}),
      ...(body.initialBudget != null ? { initialBudget: body.initialBudget } : {}),
      ...(body.manualSpendSupplement != null ? { manualSpendSupplement: body.manualSpendSupplement } : {}),
    }),
  receiptExtract: (body, api) =>
    api.receiptExtractApi({
      imageBase64: typeof body.imageBase64 === "string" ? body.imageBase64 : "",
    }),
  fitnessImageComparison: (body, api) =>
    api.fitnessImageComparisonApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      domainMode: typeof body.domainMode === "string" ? body.domainMode : "fitness",
      pathA: typeof body.pathA === "string" ? body.pathA : "",
      pathB: typeof body.pathB === "string" ? body.pathB : "",
      stageA: typeof body.stageA === "string" ? body.stageA : "",
      stageB: typeof body.stageB === "string" ? body.stageB : "",
      mode: typeof body.mode === "string" ? body.mode : undefined,
      orderedStages: Array.isArray(body.orderedStages) ? body.orderedStages : undefined,
      pathsByStage:
        body.pathsByStage != null && typeof body.pathsByStage === "object" && !Array.isArray(body.pathsByStage)
          ? body.pathsByStage
          : undefined,
      imagePairs: Array.isArray(body.imagePairs) ? body.imagePairs : undefined,
    }),
  fitnessImageRead: (body, api) =>
    api.fitnessImageReadApi({
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      path: typeof body.path === "string" ? body.path : "",
    }),
  attachPipelineCapabilities: (body, api) =>
    api.attachPipelineCapabilitiesApi({
      rows: Array.isArray(body.rows) ? body.rows : [],
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      domainMode: typeof body.domainMode === "string" ? body.domainMode : undefined,
      planMode: body.planMode === "planned" ? "planned" : "single",
    }),
  recordCapabilityOverride: (body, api) =>
    api.recordCapabilityOverrideApi(
      body.payload != null && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : body,
    ),
  getAppliedCapabilityRecords: (_body, api) => api.getAppliedCapabilityRecordsApi(),
  saveAppliedCapabilityRecord: (body, api) =>
    api.saveAppliedCapabilityRecordApi(
      body.payload != null && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : body,
    ),
  previewCapabilityRow: async (body, api) => {
    const p =
      body.payload != null && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : body;
    return api.previewCapabilityRowApi({
      row: p.row,
      rowIndex: typeof p.rowIndex === "number" ? p.rowIndex : 0,
      allRows: Array.isArray(p.allRows) ? p.allRows : [],
      cwd: typeof p.cwd === "string" ? p.cwd : undefined,
      inputOverrides:
        p.inputOverrides != null && typeof p.inputOverrides === "object" && !Array.isArray(p.inputOverrides)
          ? p.inputOverrides
          : {},
    });
  },
};

// Bind the shared engine function to the handler map.
// Both /__claira/run and /api/claira/run — and the future module orchestrator —
// dispatch through runClaira(). Never call CLAIRA_RUN_HANDLERS directly from routes.
initRunClaira(CLAIRA_RUN_HANDLERS);

/**
 * POST /__claira/run — Core execution interface for the Claira engine.
 *
 * Platform-agnostic: usable by the internal UI and any external integration
 * (Shopify, Wix, Webflow, custom). Contains ZERO platform-specific logic.
 *
 * ── Request shape ──────────────────────────────────────────────────────────
 *  {
 *    // Required — selects the operation to run.
 *    "kind": "<operation>",           // e.g. "processFolder", "getRiskInsights"
 *
 *    // Operation-specific fields (see CLAIRA_RUN_HANDLERS above for each kind).
 *    ...operationFields,
 *
 *    // Alternatively, nest operation fields under `payload` (merged flat before dispatch).
 *    // "payload": { ...operationFields },
 *
 *    // Optional context — accepted and passed through without enforcement.
 *    // Reserved for future auth / multi-tenant routing.
 *    "accountId":   "<string>",       // caller account identifier
 *    "environment": "<string>",       // e.g. "production", "staging"
 *    "metadata":    { ... }           // arbitrary caller metadata
 *  }
 *
 * ── Response shape ─────────────────────────────────────────────────────────
 *  Success → HTTP 200  { ...operation-specific result fields }
 *  Bad req → HTTP 400  { "error": "<message>" }
 *  Error   → HTTP 500  { "error": "<message>" }   (no stack traces exposed)
 *
 * ── Auth / tracing headers ─────────────────────────────────────────────────
 *  x-claira-key         (optional) API key — logged, not enforced yet.
 *  x-claira-request-id  (optional) Caller-supplied trace ID. If omitted, a
 *                       short random ID is generated and used in all log lines
 *                       for this request, making log correlation easy.
 */
app.post("/__claira/run", async (req, res) => {
  const body = req.body ?? {};

  // ── Request ID — short random token for log correlation across entries. ──
  // Callers can also supply their own via x-claira-request-id for tracing.
  const reqId =
    (req.headers["x-claira-request-id"] ?? "").slice(0, 64) ||
    Math.random().toString(36).slice(2, 10);

  // ── Auth placeholder — read key header, store for future enforcement. ───
  const clairaKey = req.headers["x-claira-key"] ?? null;

  // ── Resolved account (from body or header) — ready for auth wiring. ─────
  const accountId = (typeof body.accountId === "string" ? body.accountId : null) ?? null;

  /** Compact prefix shared by every log line for this request. */
  const tag = `[run] rid=${reqId} account=${accountId ?? "anon"} key=${clairaKey ? "present" : "none"}`;

  // ── Input validation ─────────────────────────────────────────────────────
  if (!body.kind || typeof body.kind !== "string") {
    console.warn(`${tag} 400 missing-kind`);
    return res.status(400).json({ error: 'Request must include a "kind" string field.' });
  }

  const { kind } = body;

  try {
    const out = await runClaira(kind, body, { accountId, rid: reqId, source: "ui" });
    return res.json(out);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.startsWith('Unknown kind:')) {
      console.warn(`${tag} 400 unknown-kind="${kind}"`);
      return res.status(400).json({ error: message });
    }
    // Return a safe error — no stack traces exposed to callers.
    return res.status(500).json({ error: message });
  }
});

// =============================================================================
// EXTERNAL INTEGRATION API — /api/claira/*
//
// A thin envelope layer for external platform callers (Shopify, Webflow, etc.).
// Internally dispatches through the same CLAIRA_RUN_HANDLERS used by /__claira/run
// — no HTTP self-call, no duplicated logic.
//
// Response envelope (ONLY for /api/claira/* — /__claira/run is unchanged):
//   Success → { success: true,  data:  <engine result> }
//   Failure → { success: false, error: "<message>" }
// =============================================================================

/**
 * GET /api/claira/health
 * Liveness probe — confirms the server is up and ready.
 */
app.get("/api/claira/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

/**
 * POST /api/claira/run
 * External-facing alias for the Claira engine. Identical dispatch to /__claira/run
 * but responses are wrapped in { success, data/error } for external API consistency.
 *
 * Request:  same body shape as /__claira/run (kind + operation fields + optional context)
 * Headers:  x-claira-key, x-claira-request-id  (same as /__claira/run)
 */
app.post("/api/claira/run", async (req, res) => {
  const body = req.body ?? {};

  const reqId =
    (req.headers["x-claira-request-id"] ?? "").slice(0, 64) ||
    Math.random().toString(36).slice(2, 10);
  const clairaKey = req.headers["x-claira-key"] ?? null;
  const accountId = (typeof body.accountId === "string" ? body.accountId : null) ?? null;
  const tag = `[api/claira/run] rid=${reqId} account=${accountId ?? "anon"} key=${clairaKey ? "present" : "none"}`;

  if (!body.kind || typeof body.kind !== "string") {
    console.warn(`${tag} 400 missing-kind`);
    return res.status(400).json({ success: false, error: 'Request must include a "kind" string field.' });
  }

  const { kind } = body;

  try {
    const data = await runClaira(kind, body, { accountId, rid: reqId, source: "integration" });
    return res.json({ success: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.startsWith('Unknown kind:')) {
      console.warn(`${tag} 400 unknown-kind="${kind}"`);
      return res.status(400).json({ success: false, error: message });
    }
    console.error(`${tag} kind=${kind} status=error — ${message}`);
    return res.status(500).json({ success: false, error: message });
  }
});

// =============================================================================
// INTEGRATION LAYER — /api/integrations/*
//
// Structured event receivers for external platforms.
// Each route:
//   1. Accepts the raw platform payload unchanged.
//   2. Extracts fields using existing server-side utilities (no duplication).
//   3. Maps to a Claira kind and dispatches through CLAIRA_RUN_HANDLERS.
//   4. Responds immediately — heavy processing runs asynchronously via job tracker.
//
// Platform logic stays contained within its own route.
// DO NOT add logic from here into /__claira/run or /api/claira/run.
// =============================================================================

// ---------------------------------------------------------------------------
// Job Tracker — in-memory only, no external dependencies.
//
// Each job:
//   id         — matches the request rid
//   status     — "pending" | "processing" | "done" | "error"
//   attempts   — how many processing attempts have been made
//   lastError  — last failure message (if any)
//   createdAt  — ISO timestamp when job was registered
//   updatedAt  — ISO timestamp of last status change
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   id: string,
 *   status: "pending" | "processing" | "done" | "error",
 *   attempts: number,
 *   lastError?: string,
 *   createdAt: string,
 *   updatedAt: string,
 *   rawPayload?: Record<string, unknown>,
 * }} IntegrationJob
 */

/** @type {Map<string, IntegrationJob>} */
const integrationJobs = new Map();

const JOB_MAX_ATTEMPTS = 3;
const JOB_STORE_LIMIT = 500; // prevent unbounded growth; oldest entry pruned first

// ---------------------------------------------------------------------------
// Persistence — atomic file-based store (no external dependencies).
//
// Write pattern: serialize → temp file → rename over target.
// Rename is atomic on Linux/macOS; on Windows it is best-effort (NTFS).
// Writes are debounced (200 ms) so rapid state transitions cost one write.
// ---------------------------------------------------------------------------

const JOBS_STORE_PATH = path.join(engineRoot, "server", "jobsStore.json");
const JOBS_TMP_PATH   = path.join(engineRoot, "server", "jobsStore.tmp.json");

/**
 * Load jobs from disk into `integrationJobs` on server start.
 * Missing file → silent start with empty store.
 * Corrupt file → warn and start empty (never crashes the server).
 * Jobs stuck in "pending" or "processing" had their async work lost in the
 * previous process — they are marked "error" so operators can see them.
 */
async function loadJobsFromDisk() {
  try {
    const raw = await readFile(JOBS_STORE_PATH, "utf-8");
    const records = JSON.parse(raw);
    if (!Array.isArray(records)) throw new Error("expected array");

    let loaded = 0;
    for (const rec of records) {
      if (!rec || typeof rec.id !== "string") continue;

      // Jobs that were in-flight when the server died cannot be retried
      // automatically — mark them so they are visible in the debug route.
      if (rec.status === "pending" || rec.status === "processing") {
        rec.status = "error";
        rec.lastError = "Server restarted while job was in-flight";
        rec.updatedAt = new Date().toISOString();
      }

      integrationJobs.set(rec.id, rec);
      loaded += 1;
    }

    console.log(`[jobs] restored ${loaded} job(s) from disk`);
  } catch (err) {
    if (/** @type {any} */ (err).code !== "ENOENT") {
      console.warn("[jobs] could not load jobsStore.json — starting empty:", err.message);
    }
    // ENOENT = file doesn't exist yet; silently start with empty store.
  }
}

/** @type {ReturnType<typeof setTimeout> | null} */
let _persistTimer = null;

/**
 * Schedule a debounced async write of the jobs Map to disk.
 * Multiple calls within 200 ms are coalesced into a single write.
 * Never blocks the caller — errors are logged, not thrown.
 */
function schedulePersist() {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    _persistTimer = null;

    // Enforce size limit before saving (Map may have grown during the debounce).
    while (integrationJobs.size > JOB_STORE_LIMIT) {
      const oldest = integrationJobs.keys().next().value;
      integrationJobs.delete(oldest);
    }

    const records = Array.from(integrationJobs.values());
    const json = JSON.stringify(records, null, 2);

    // Atomic write: write to temp then rename over the target.
    writeFile(JOBS_TMP_PATH, json, "utf-8")
      .then(() => renameFile(JOBS_TMP_PATH, JOBS_STORE_PATH))
      .then(() => console.log(`[jobs] persisted ${records.length} job(s)`))
      .catch((err) => console.error("[jobs] persist failed:", err.message));
  }, 200);
}

// Restore jobs from the previous process before routes are registered.
await loadJobsFromDisk();

/**
 * Register a new job. Returns the job object.
 * @param {string} id
 * @param {Record<string, unknown>} [rawPayload] - Original raw request body, stored for retry replay.
 * @returns {IntegrationJob}
 */
function createJob(id, rawPayload) {
  if (integrationJobs.size >= JOB_STORE_LIMIT) {
    // Prune the oldest entry (Map preserves insertion order).
    const oldestKey = integrationJobs.keys().next().value;
    integrationJobs.delete(oldestKey);
  }
  /** @type {IntegrationJob} */
  const job = {
    id,
    status: "pending",
    attempts: 0,
    lastError: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rawPayload,
  };
  integrationJobs.set(id, job);
  schedulePersist();
  return job;
}

/**
 * Update fields on an existing job.
 * @param {string} id
 * @param {Partial<IntegrationJob>} fields
 */
function updateJob(id, fields) {
  const job = integrationJobs.get(id);
  if (!job) return;
  Object.assign(job, fields, { updatedAt: new Date().toISOString() });
  schedulePersist();
}

/**
 * Run `fn` with automatic retry on failure.
 * Transitions job status: pending → processing → done | error.
 * Retries up to JOB_MAX_ATTEMPTS times with exponential back-off (1 s, 2 s, 4 s).
 *
 * @param {string} jobId
 * @param {string} tag        - Log prefix shared with the calling route.
 * @param {() => Promise<void>} fn
 */
async function runWithRetry(jobId, tag, fn) {
  const job = integrationJobs.get(jobId);
  if (!job) return;

  while (job.attempts < JOB_MAX_ATTEMPTS) {
    job.attempts += 1;

    // Exponential back-off before each retry (not before the first attempt).
    if (job.attempts > 1) {
      const delayMs = 1000 * Math.pow(2, job.attempts - 2); // 1 s, 2 s, 4 s
      console.log(`${tag} retry attempt=${job.attempts}/${JOB_MAX_ATTEMPTS} delay=${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    updateJob(jobId, { status: "processing" });
    console.log(`${tag} status=processing attempt=${job.attempts}/${JOB_MAX_ATTEMPTS}`);

    try {
      await fn();
      updateJob(jobId, { status: "done" });
      console.log(`${tag} status=done attempt=${job.attempts}`);
      return; // success — stop retrying
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateJob(jobId, { status: "error", lastError: message });
      console.error(`${tag} status=error attempt=${job.attempts}/${JOB_MAX_ATTEMPTS} — ${message}`);

      if (job.attempts >= JOB_MAX_ATTEMPTS) {
        console.error(`${tag} max attempts reached — job ${jobId} failed permanently`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Wix processing function — shared by webhook handler and retry route.
// Extracted so neither caller duplicates logic.
// ---------------------------------------------------------------------------

/**
 * Execute the Wix product event processing pipeline for a given raw body.
 * Called by both the webhook handler (first run) and the retry route.
 *
 * @param {Record<string, unknown>} rawBody - Original Wix webhook body.
 * @param {string} tag                      - Log prefix shared with the caller.
 */
async function processWixPayload(rawBody, tag) {
  const summary = extractWixSummary(rawBody);
  const { eventType, instanceId, productData, siteData } = summary;

  if (productData == null) {
    console.log(`${tag} no product data — acknowledged`);
    return;
  }

  const clairaPayload = {
    kind: "ingestData",
    accountId: instanceId ?? undefined,
    environment: "production",
    metadata: {
      platform: "wix",
      eventType: eventType ?? null,
      instanceId: instanceId ?? null,
      siteData: siteData ?? null,
    },
    payload: {
      source: "wix",
      eventType: eventType ?? null,
      instanceId: instanceId ?? null,
      productData,
      siteData: siteData ?? null,
    },
  };

  const api = await import("../interfaces/api.js");
  const handler = CLAIRA_RUN_HANDLERS["ingestData"];
  if (handler) {
    await handler(clairaPayload, api);
    console.log(`${tag} ingestData dispatched ok`);
  }

  // Adapter-layer observation: log what was detected before forwarding.
  // No engine logic runs here — CLIP analysis happens inside buildProductCatalog.
  const productEntries = detectAndLogProductsFromData(rawBody);
  console.log(
    productEntries.length > 0
      ? `${tag} ${productEntries.length} product(s) detected — forwarding to engine`
      : `${tag} no product image URLs detected`,
  );

  // ── Forward to engine — grouping, CLIP, enrichment, and file output ────────
  // All processing runs inside the buildProductCatalog handler.
  // This adapter only provides the raw inputs.
  const catalogHandler = CLAIRA_RUN_HANDLERS["buildProductCatalog"];
  if (catalogHandler) {
    const catalog = await catalogHandler(
      {
        productData,
        platform:    "wix",
        useVision:   true,
        outputMode:  "files",
        // outputPath falls back to CLAIRA_PRODUCT_OUTPUT_PATH env var inside the handler.
      },
      api,
    );
    const fs = catalog.fileStructure;
    console.log(
      `${tag} buildProductCatalog: ${catalog.summary.totalProducts} product(s), ` +
      `${catalog.summary.totalImages} image(s) structured` +
      (fs.foldersCreated ? `, ${fs.foldersCreated.length} folder(s) written to ${fs.rootPath}` : ""),
    );
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/integrations/jobs/:id
 * Returns the current state of a tracked integration job.
 * Useful for debugging webhook processing without tailing server logs.
 */
app.get("/api/integrations/jobs/:id", (req, res) => {
  const job = integrationJobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: `Job "${req.params.id}" not found` });
  }
  return res.json({
    id: job.id,
    status: job.status,
    attempts: job.attempts,
    lastError: job.lastError ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
});

/**
 * POST /api/integrations/jobs/:id/retry
 *
 * Manually re-queue a failed integration job.
 * Only jobs with status "error" can be retried.
 *
 * Resets the job (status → pending, attempts → 0) and re-runs the original
 * processing pipeline using the stored raw payload — no data re-submission
 * needed from the caller.
 */
app.post("/api/integrations/jobs/:id/retry", (req, res) => {
  const { id } = req.params;
  const job = integrationJobs.get(id);

  if (!job) {
    return res.status(404).json({ error: `Job "${id}" not found` });
  }

  if (job.status !== "error") {
    return res.status(400).json({
      error: `Job "${id}" cannot be retried — current status is "${job.status}" (must be "error")`,
    });
  }

  if (!job.rawPayload) {
    return res.status(400).json({
      error: `Job "${id}" has no stored payload and cannot be replayed`,
    });
  }

  // Reset the job so runWithRetry gets a fresh attempt budget.
  updateJob(id, { status: "pending", attempts: 0, lastError: undefined });

  const tag = `[retry] rid=${id}`;
  console.log(`${tag} restarting job`);

  // Respond immediately — processing is async.
  res.json({ success: true, id, message: "Job re-queued" });

  // Capture payload reference before setImmediate (job object may be mutated).
  const rawPayload = job.rawPayload;

  setImmediate(() => {
    void runWithRetry(id, tag, () => processWixPayload(rawPayload, tag));
  });
});

/**
 * POST /api/integrations/wix
 *
 * Accepts any Wix webhook payload (catalog, product, site events).
 * Extracts structured fields using the existing extraction utilities, then
 * maps product events into Claira via the ingestData handler.
 *
 * Responds immediately with { success: true, rid } — Wix requires a fast ack.
 * All engine processing runs asynchronously, tracked by the job store.
 *
 * Event → kind mapping:
 *   product data present  →  kind: "ingestData"  (ingests product into engine)
 *                          + runProductImagePipeline (image analysis, if URLs found)
 *   no product data       →  acknowledge only — job marked done immediately
 *
 * Job lifecycle:
 *   webhook arrives → status: "pending"
 *   processing starts → status: "processing"
 *   success → status: "done"
 *   failure → status: "error", retry up to 3×
 */
app.post("/api/integrations/wix", (req, res) => {
  const rid = Math.random().toString(36).slice(2, 10);
  const rawBody = req.body ?? {};

  // ── Extract real Wix fields (existing utilities, zero duplication). ───────
  const summary = extractWixSummary(rawBody);
  const { eventType, instanceId, productData } = summary;

  const tag = `[integrations/wix] rid=${rid} account=${instanceId ?? "anon"} event=${eventType ?? "unknown"}`;

  // ── Resolve capability for this event ─────────────────────────────────────
  const capability = getCapabilityForEvent(eventType, "wix", { productData, images: [] });
  const capDesc = capability ? describeCapability(capability)?.description ?? capability : "none";
  console.log(`[capability] rid=${rid} event=${eventType ?? "unknown"} → ${capability ?? "null"} (${capDesc})`);

  // ── Register job — store raw body for retry replay. ──────────────────────
  createJob(rid, rawBody);
  console.log(`${tag} status=pending webhook received`);

  // ── Respond immediately — Wix requires acknowledgment within ~5 seconds. ──
  res.status(200).json({ success: true, receivedEvent: eventType ?? "unknown", rid });

  // ── Kick off async processing via the shared pipeline function. ───────────
  setImmediate(() => {
    void runWithRetry(rid, tag, () => processWixPayload(rawBody, tag));
  });
});

// =============================================================================
// PLATFORM-SPECIFIC WEBHOOKS
// These routes handle inbound calls from specific external platforms.
// They are SEPARATE from /__claira/run and must never be merged into it.
// Claira treats each platform as an external consumer, not a core dependency.
// =============================================================================

/**
 * Wix inbound webhook (POST /run).
 * Receives Wix catalog / product events and kicks off the image analysis pipeline.
 * This is Wix-specific and intentionally isolated from the core /__claira/run API.
 */
app.post("/run", (req, res) => {
  try {
    const body = req.body;
    const summary = extractWixSummary(body);

    console.log("Webhook received from Wix:");
    console.log("  eventType:", summary.eventType ?? "(not found)");
    console.log("  instanceId:", summary.instanceId ?? "(not found)");
    if (summary.productData != null) {
      console.log("  product / catalog data:", JSON.stringify(summary.productData, null, 2));
    } else {
      console.log("  product / catalog data: (not found)");
    }

    // Forward through the engine — grouping + CLIP run inside buildProductCatalog.
    const productEntries = detectAndLogProductsFromData(body);
    if (summary.productData != null) {
      void (async () => {
        try {
          const api = await import("../interfaces/api.js");
          const handler = CLAIRA_RUN_HANDLERS["buildProductCatalog"];
          if (handler) await handler({ productData: summary.productData, platform: "wix" }, api);
        } catch (err) {
          console.error("Product catalog pipeline error:", err);
        }
      })();
    } else if (productEntries.length > 0) {
      void runProductImagePipeline(productEntries).catch((err) => {
        console.error("Product image pipeline error:", err);
      });
    }

    if (summary.siteData != null) {
      console.log("  site data:", JSON.stringify(summary.siteData, null, 2));
    } else {
      console.log("  site data: (not found)");
    }
    console.log("  full body:", JSON.stringify(body, null, 2));

    _lastWixWebhook = {
      receivedAt: new Date().toISOString(),
      raw: body,
      summary,
    };

    const receivedEvent = summary.eventType ?? "unknown";

    return res.status(200).json({
      success: true,
      receivedEvent,
    });
  } catch (err) {
    console.error("Webhook error:", err);

    return res.status(200).json({
      success: false,
      error: "Handled safely",
    });
  }
});

// ---------------------------------------------------------------------------
// STATIC UI — serve the built React app in production / desktop mode.
// Only activates when ui/dist exists (i.e. after `npm run ui:build`).
// In dev mode the Vite dev server handles UI delivery instead.
// ---------------------------------------------------------------------------
const uiDist = path.join(engineRoot, "ui", "dist");
if (existsSync(uiDist)) {
  app.use(express.static(uiDist));
  // SPA catch-all: any unmatched GET returns index.html so client-side routing works.
  app.get("*", (_req, res) => res.sendFile(path.join(uiDist, "index.html")));
}

/**
 * Probe whether a TCP port is free. Resolves true if free, false if occupied.
 * @param {number} p
 */
function isPortFree(p) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(p, "127.0.0.1");
  });
}

/**
 * Return the first free TCP port at or above `start`.
 * @param {number} start
 */
async function findAvailablePort(start) {
  let p = start;
  while (!(await isPortFree(p))) {
    p += 1;
  }
  return p;
}

const preferredPort = Number(process.env.PORT) || 3000;
const port = await findAvailablePort(preferredPort);

if (port !== preferredPort) {
  console.warn(`[Claira] Port ${preferredPort} is in use — using port ${port} instead.`);
}

app.listen(port, "127.0.0.1", () => {
  // Structured signal parsed by the Electron main process to learn the actual port.
  // Keep this line intact — changing its format breaks Electron startup.
  process.stdout.write(`CLAIRA_SERVER_READY:${port}\n`);
  console.log(`Claira server running on http://127.0.0.1:${port}`);
});

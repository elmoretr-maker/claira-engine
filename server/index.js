import express from "express";
import { analyzeImage } from "./clairaImagePipeline.js";

/** Last POST /run body + extracted fields (in-memory only; resets on process restart). */
let lastWixWebhook = null;

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
async function runProductImagePipeline(entries) {
  for (const { name, id, images } of entries) {
    const results = await Promise.all(images.map((u) => analyzeImage(u)));
    processedProducts.push({ name, id, images, analysis: results });
    console.log("Analysis result:");
    console.log("  product name:", name ?? "(not found)");
    console.log("  image classifications:", results);
  }
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
app.use(express.json());

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

    const productEntries = detectAndLogProductsFromData(body);
    if (productEntries.length > 0) {
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

    lastWixWebhook = {
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

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Claira server running on port ${port}`);
});

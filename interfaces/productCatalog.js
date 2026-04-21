/**
 * interfaces/productCatalog.js
 *
 * Core image-to-product catalog builder.
 *
 * Accepts raw image URLs, local file paths, or structured product data and
 * returns a normalised, platform-ready product catalog using heuristic rules.
 * No external AI calls at runtime — CLIP analysis is handled separately by
 * the image pipeline (runProductImagePipeline in server/index.js).
 *
 * Entry point: buildProductCatalog(params)
 *
 * Supported platforms for optional output shaping:
 *   "wix"      → Wix Stores media + catalog shape
 *   "shopify"  → Shopify REST Product shape
 */

import { readdirSync, statSync } from "fs";
import { copyFile, mkdir, access, writeFile } from "fs/promises";
import { constants as fsConstants } from "fs";
import { extname, join } from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"]);

// Filename suffixes that mark variant angles of the same product, not a
// separate product. Stripping these reveals the shared product group key.
const VARIANT_SUFFIX_RE =
  /[-_](main|alt|front|back|side|detail|zoom|thumb|thumbnail|hero|lifestyle|\d+)$/i;

// Words too generic to be useful product tags.
const TAG_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that",
  "img", "image", "photo", "pic", "asset", "file",
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the filename stem (no extension, no query-string) from a URL or path.
 * @param {string} urlOrPath
 */
function getStem(urlOrPath) {
  const clean = urlOrPath.replace(/\?.*$/, "").replace(/\\/g, "/");
  const file = clean.split("/").pop() ?? "";
  return file.replace(/\.[^.]+$/, "");
}

/**
 * Strip trailing variant suffixes to reveal the product group key.
 * "leather-wallet-1"   → "leather-wallet"
 * "classic-bag-front"  → "classic-bag"
 * "desk-lamp"          → "desk-lamp"   (unchanged)
 * @param {string} stem
 */
function toGroupKey(stem) {
  let key = stem.replace(VARIANT_SUFFIX_RE, "");
  // Strip any trailing separator left behind.
  key = key.replace(/[-_\s]+$/, "");
  return key || stem;
}

/**
 * Convert kebab/underscore-separated words to Title Case.
 * "leather-wallet" → "Leather Wallet"
 * @param {string} key
 */
function toTitleCase(key) {
  return key
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Extract meaningful single-word tags from a product group key.
 * "premium-leather-wallet" → ["premium", "leather", "wallet"]
 * @param {string} key
 * @returns {string[]}
 */
function extractTags(key) {
  return key
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !TAG_STOPWORDS.has(w));
}

/**
 * Build a stable, URL-safe product id from an index and group key.
 * @param {number} index  0-based
 * @param {string} key
 */
function makeProductId(index, key) {
  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `product-${String(index + 1).padStart(3, "0")}-${slug}`;
}

// ---------------------------------------------------------------------------
// Public: groupImagesByProduct
// ---------------------------------------------------------------------------

/**
 * Group an array of image URLs or file paths by product using filename
 * pattern heuristics (strip variant suffixes, cluster by group key).
 *
 * @param {string[]} images
 * @returns {{ key: string, images: string[] }[]}
 */
export function groupImagesByProduct(images) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();

  for (const img of images) {
    if (typeof img !== "string" || !img.trim()) continue;
    const stem = getStem(img);
    const key = toGroupKey(stem) || stem;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(img);
  }

  return Array.from(groups.entries()).map(([key, imgs]) => ({ key, images: imgs }));
}

// ---------------------------------------------------------------------------
// Public: scanFolderForImages
// ---------------------------------------------------------------------------

/**
 * Walk a local directory and return image file paths.
 * Non-recursive by default; pass { recursive: true } for deep scans.
 *
 * Errors (missing folder, permission denied) are swallowed — the function
 * returns an empty array, never throws.
 *
 * @param {string} folderPath
 * @param {{ recursive?: boolean }} [opts]
 * @returns {string[]}
 */
export function scanFolderForImages(folderPath, opts = {}) {
  /** @type {string[]} */
  const results = [];
  try {
    for (const entry of readdirSync(folderPath)) {
      const full = join(folderPath, entry);
      const stat = statSync(full);
      if (stat.isDirectory() && opts.recursive) {
        results.push(...scanFolderForImages(full, opts));
      } else if (stat.isFile() && IMAGE_EXTENSIONS.has(extname(entry).toLowerCase())) {
        results.push(full);
      }
    }
  } catch {
    // Non-fatal.
  }
  return results;
}

// ---------------------------------------------------------------------------
// Platform formatters (internal)
// ---------------------------------------------------------------------------

/**
 * @param {{ name: string, images: string[], metadata: { suggestedTitle: string, tags: string[], description: string } }} product
 */
function formatForWix(product) {
  const [main, ...rest] = product.images;
  return {
    title: product.metadata.suggestedTitle,
    productType: "physical",
    description: product.metadata.description,
    media: main ? { mainMedia: { url: main, type: "image" } } : undefined,
    mediaItems: rest.map((url) => ({ url, type: "image" })),
    tags: product.metadata.tags,
  };
}

/**
 * @param {{ name: string, images: string[], metadata: { suggestedTitle: string, tags: string[], description: string } }} product
 */
function formatForShopify(product) {
  return {
    title: product.metadata.suggestedTitle,
    body_html: `<p>${product.metadata.description}</p>`,
    tags: product.metadata.tags.join(", "),
    images: product.images.map((src) => ({ src })),
    variants: [{ title: "Default Title", price: "0.00" }],
  };
}

// ---------------------------------------------------------------------------
// Internal: collect image URLs from a structured product record
// ---------------------------------------------------------------------------

/**
 * Pull every image URL out of a structured product record (Wix / generic shape).
 * Understands: .image, .media.mainMedia.url, .mainMedia.url, .mediaItems[].url,
 * .images[] (string or { url }).
 *
 * @param {Record<string, any>} rec
 * @returns {string[]}
 */
function collectUrlsFromRecord(rec) {
  /** @type {string[]} */
  const urls = [];
  if (!rec || typeof rec !== "object") return urls;

  if (typeof rec.image === "string" && rec.image.startsWith("http")) urls.push(rec.image);
  if (rec.media?.mainMedia?.url) urls.push(rec.media.mainMedia.url);
  if (rec.mainMedia?.url) urls.push(rec.mainMedia.url);

  if (Array.isArray(rec.mediaItems)) {
    for (const item of rec.mediaItems) {
      if (item?.url) urls.push(item.url);
    }
  }

  if (Array.isArray(rec.images)) {
    for (const img of rec.images) {
      if (typeof img === "string") urls.push(img);
      else if (img?.url) urls.push(img.url);
    }
  }

  return urls;
}

// ---------------------------------------------------------------------------
// Public: buildProductCatalog
// ---------------------------------------------------------------------------

/**
 * Convert raw product images into a structured, platform-ready catalog.
 *
 * Input sources (any combination):
 *   images      — array of image URLs or local file paths
 *   productData — structured product object(s) from Wix / generic webhook
 *   folderPath  — local directory to scan for images
 *
 * @param {{
 *   images?:      string[],
 *   productData?: unknown,
 *   folderPath?:  string | null,
 *   platform?:    "wix" | "shopify" | string | null,
 *   recursive?:   boolean,
 * }} params
 *
 * @returns {{
 *   products: Array<{
 *     id:       string,
 *     name:     string,
 *     images:   string[],
 *     variants: any[],
 *     metadata: { suggestedTitle: string, tags: string[], description: string },
 *     platformReady?: Record<string, any>,
 *   }>,
 *   fileStructure: { organized: boolean, rootPath: string | null, productCount: number },
 *   summary:       { totalImages: number, totalProducts: number, platform: string | null },
 * }}
 */
export function buildProductCatalog(params) {
  const {
    images = [],
    productData = null,
    folderPath = null,
    platform = null,
    recursive = false,
  } = params;

  // ── Collect all image sources ─────────────────────────────────────────────

  /** @type {string[]} */
  const raw = [...images.filter((u) => typeof u === "string" && u.trim())];

  if (folderPath) {
    raw.push(...scanFolderForImages(folderPath, { recursive }));
  }

  if (productData != null) {
    const records = Array.isArray(productData) ? productData : [productData];
    for (const rec of records) {
      raw.push(...collectUrlsFromRecord(/** @type {any} */ (rec)));
    }
  }

  // Deduplicate while preserving order.
  const uniqueImages = [...new Set(raw.filter(Boolean))];

  // ── Group images by product ───────────────────────────────────────────────

  /** @type {{ key: string, images: string[] }[]} */
  let groups;

  if (uniqueImages.length > 0) {
    groups = groupImagesByProduct(uniqueImages);
  } else if (productData != null) {
    // productData present but no image URLs — represent as one unnamed product.
    groups = [{ key: "product", images: [] }];
  } else {
    groups = [];
  }

  // ── Build product records ─────────────────────────────────────────────────

  const products = groups.map((group, idx) => {
    const suggestedTitle = toTitleCase(group.key);
    const tags = extractTags(group.key);

    /** @type {any} */
    const product = {
      id: makeProductId(idx, group.key),
      name: suggestedTitle,
      images: group.images,
      variants: [],
      metadata: {
        suggestedTitle,
        tags,
        description: `Product images for ${suggestedTitle}.`,
      },
    };

    if (platform === "wix") product.platformReady = formatForWix(product);
    else if (platform === "shopify") product.platformReady = formatForShopify(product);

    return product;
  });

  // ── Result ────────────────────────────────────────────────────────────────

  return {
    products,
    fileStructure: {
      organized: true,
      rootPath: folderPath ?? null,
      productCount: products.length,
    },
    summary: {
      totalImages: uniqueImages.length,
      totalProducts: products.length,
      platform,
    },
  };
}

// =============================================================================
// CLIP RESULT NORMALISATION
// =============================================================================

/**
 * Normalise a single per-image CLIP analysis result to a stable
 * `{ label, confidence }` shape regardless of which output format the
 * upstream model produces.
 *
 * Supported input shapes:
 *   { classification: { predicted_label: string, confidence: number } }
 *     — current clairaImagePipeline output
 *   { label: string, confidence: number }
 *     — future / alternative normalised shape
 *   { label: "error", ... }
 *     — pipeline error sentinel; returns null
 *
 * @param {unknown} raw
 * @returns {{ label: string, confidence: number } | null}
 */
function normaliseClipResult(raw) {
  if (!raw || typeof raw !== "object") return null;

  const r = /** @type {Record<string, any>} */ (raw);

  // Shape A: { classification: { predicted_label, confidence } }
  if (r.classification && typeof r.classification === "object") {
    const label = r.classification.predicted_label ?? null;
    if (typeof label === "string" && label !== "error") {
      return { label, confidence: r.classification.confidence ?? 0 };
    }
    return null;
  }

  // Shape B: { label, confidence }
  if (typeof r.label === "string" && r.label !== "error") {
    return { label: r.label, confidence: typeof r.confidence === "number" ? r.confidence : 0 };
  }

  return null;
}

// =============================================================================
// CLIP RESULT ENRICHMENT
// =============================================================================

/**
 * Filename stems that are too generic to be reliable product names.
 * When CLIP identifies a consistent label for images in such a group, the
 * CLIP label is preferred as the product title.
 */
const GENERIC_STEMS = new Set([
  "img", "image", "photo", "pic", "picture", "dsc", "dcim", "scan",
  "file", "screenshot", "snap", "untitled", "default", "thumb", "frame",
]);

/** @param {string} key */
function isGenericKey(key) {
  const lower = key.toLowerCase();
  return GENERIC_STEMS.has(lower) || /^[a-z]{1,4}\d+$/i.test(lower);
}

/**
 * Enrich a product catalog with CLIP classification results.
 *
 * Uses the analysis already produced by runProductImagePipeline — CLIP is
 * NOT re-run.  Products are matched by their `id` field.
 *
 * Enrichment effects:
 *   - Adds `metadata.clipLabels`  — unique predicted_label strings from CLIP
 *   - Adds CLIP labels into `metadata.tags`
 *   - When the original product name was a generic filename stem (e.g. "Img001"),
 *     replaces it with the top CLIP label for a more meaningful title
 *
 * @param {{
 *   products: Array<{
 *     id: string, name: string, images: string[], variants: any[],
 *     metadata: { suggestedTitle: string, tags: string[], description: string },
 *     platformReady?: any,
 *   }>,
 *   fileStructure: Record<string, any>,
 *   summary: Record<string, any>,
 * }} catalog
 *
 * @param {Array<{
 *   id:       string | null,
 *   name:     string | null,
 *   images:   string[],
 *   analysis: Array<Record<string, any>>,
 * }>} clipResults  Return value of runProductImagePipeline.
 *
 * @returns {typeof catalog}
 */
export function enrichCatalogWithClipResults(catalog, clipResults) {
  if (!clipResults || clipResults.length === 0) return catalog;

  /** @type {Map<string, Array<Record<string, any>>>} */
  const analysisMap = new Map();
  for (const result of clipResults) {
    if (result.id) analysisMap.set(result.id, result.analysis ?? []);
  }

  const enrichedProducts = catalog.products.map((product) => {
    const analysis = analysisMap.get(product.id);
    if (!analysis || analysis.length === 0) return product;

    // Normalise each per-image CLIP result to { label, confidence } and
    // extract the label string.  Supports both output shapes:
    //   { classification: { predicted_label, confidence } }  ← current CLIP pipeline
    //   { label, confidence }                                ← future normalised shape
    const clipLabels = /** @type {string[]} */ (
      analysis.map(normaliseClipResult).map((r) => r?.label ?? null).filter(Boolean)
    );

    const uniqueLabels = [...new Set(clipLabels)];
    if (uniqueLabels.length === 0) return product;

    // Merge CLIP labels into tags (deduplicated, normalised to kebab-case).
    const clipTagTokens = uniqueLabels.map((l) =>
      l.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    );
    const mergedTags = [...new Set([...product.metadata.tags, ...clipTagTokens])];

    // If the product name came from a generic filename, prefer the CLIP label.
    const nameKey = product.name.toLowerCase().replace(/\s+/g, "-");
    const betterTitle = isGenericKey(nameKey) && uniqueLabels[0]
      ? toTitleCase(uniqueLabels[0])
      : product.metadata.suggestedTitle;

    const updatedDescription = betterTitle !== product.metadata.suggestedTitle
      ? `Product images for ${betterTitle}.`
      : product.metadata.description;

    return {
      ...product,
      name: betterTitle,
      metadata: {
        ...product.metadata,
        suggestedTitle:  betterTitle,
        tags:            mergedTags,
        description:     updatedDescription,
        clipLabels:      uniqueLabels,
        clipEnriched:    true,
      },
    };
  });

  return { ...catalog, products: enrichedProducts };
}

// =============================================================================
// FILE OUTPUT
// =============================================================================

/**
 * Return true when `s` is an http(s) URL string.
 * @param {unknown} s
 */
function isHttpUrl(s) {
  return typeof s === "string" && (s.startsWith("http://") || s.startsWith("https://"));
}

/**
 * Infer an image file extension from a URL or path.
 * Falls back to `.jpg` when the extension is not in the known set.
 * @param {string} urlOrPath
 */
function resolveExtension(urlOrPath) {
  const clean = urlOrPath.replace(/\?.*$/, "");
  const ext = extname(clean).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) ? ext : ".jpg";
}

/**
 * Return true when `destPath` already exists (async, non-blocking).
 * @param {string} destPath
 */
async function fileExists(destPath) {
  try {
    await access(destPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Download an image URL to a local file path using the global fetch API
 * (Node.js 18+).  Throws on non-2xx responses.
 * @param {string} url
 * @param {string} destPath
 */
async function downloadImageUrl(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  await writeFile(destPath, Buffer.from(await res.arrayBuffer()));
}

/**
 * Write a structured product catalog to disk.
 *
 * Creates the directory tree:
 *   <outputPath>/
 *     product-001-leather-wallet/
 *       main.jpg
 *       alt-1.jpg
 *     product-002-classic-bag/
 *       main.jpg
 *
 * Rules:
 *   - Existing files are NEVER overwritten (safe by default).
 *   - URL images are downloaded; local-path images are copied.
 *   - Write errors per-file are logged and skipped (non-fatal).
 *   - The function returns after file I/O completes — call without await
 *     if you want non-blocking fire-and-forget behaviour.
 *
 * @param {{
 *   products: Array<{ id: string, images: string[] }>,
 *   [key: string]: any,
 * }} catalog
 *
 * @param {string | null} [outputPath]
 *   Root directory for output.  Defaults to `<cwd>/output/products`.
 *
 * @returns {Promise<{
 *   organized:      boolean,
 *   rootPath:       string,
 *   productCount:   number,
 *   foldersCreated: string[],
 *   filesWritten:   number,
 * }>}
 */
/**
 * Derive a safe folder name from a product.
 * Prefers a slug built from `product.name`; falls back to `product.id`.
 * This means user-edited names naturally change the output folder name.
 *
 * "Premium Brown Wallet" → "premium-brown-wallet"
 * "product-001-leather-wallet" (id fallback) → "product-001-leather-wallet"
 *
 * @param {{ id: string, name?: string }} product
 */
function productFolderName(product) {
  const src = (typeof product.name === "string" && product.name.trim()) ? product.name : product.id;
  const slug = src
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || product.id;
}

export async function writeProductCatalogFiles(catalog, outputPath) {
  const base = (typeof outputPath === "string" && outputPath.trim())
    ? outputPath.trim()
    : join(process.cwd(), "output", "products");

  await mkdir(base, { recursive: true });

  /** @type {string[]} */
  const foldersCreated = [];
  let filesWritten = 0;

  // Track slugs claimed in this write pass so two products with the same
  // derived name don't clobber each other.
  /** @type {Set<string>} */
  const claimedSlugs = new Set();

  /**
   * Return a unique slug for `base` that is neither already claimed within
   * this batch nor already present on disk.
   * wallet        (free)   → "wallet"
   * wallet        (taken)  → "wallet-2"
   * wallet        (taken)  → "wallet-3"  …
   * @param {string} slug
   */
  async function uniqueSlug(slug) {
    let candidate = slug;
    let n = 2;
    while (claimedSlugs.has(candidate) || await fileExists(join(base, candidate))) {
      candidate = `${slug}-${n}`;
      n += 1;
    }
    claimedSlugs.add(candidate);
    return candidate;
  }

  for (const product of catalog.products) {
    if (product.images.length === 0) continue;

    // Resolve a unique, collision-free folder name for this product.
    const slug = await uniqueSlug(productFolderName(product));
    const productDir = join(base, slug);
    const dirAlreadyExists = await fileExists(productDir);
    await mkdir(productDir, { recursive: true });
    if (!dirAlreadyExists) foldersCreated.push(productDir);

    for (let i = 0; i < product.images.length; i++) {
      const src = product.images[i];
      const label = i === 0 ? "main" : `alt-${i}`;
      const dest = join(productDir, `${label}${resolveExtension(src)}`);

      // Never overwrite existing files.
      if (await fileExists(dest)) continue;

      try {
        if (isHttpUrl(src)) {
          await downloadImageUrl(src, dest);
        } else {
          await copyFile(src, dest);
        }
        filesWritten += 1;
      } catch (err) {
        console.warn(
          `[buildProductCatalog] file write skipped: ${dest} — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return {
    organized:    true,
    rootPath:     base,
    productCount: catalog.products.length,
    foldersCreated,
    filesWritten,
  };
}

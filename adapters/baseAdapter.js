import { isSupportedImageFilename } from "./supportedImages.js";

/**
 * Standard adapter output shape (all adapters normalize to this).
 * Type `image` supports file paths/buffers for: .png, .jpg, .jpeg, .webp (case-insensitive on path).
 * @typedef {"image" | "document" | "product"} StandardType
 * @typedef {{
 *   filePath: string | null,
 *   buffer: Buffer | Uint8Array | null,
 *   url: string | null
 * }} StandardData
 * @typedef {{
 *   source: string,
 *   originalName: string,
 *   extractedText?: string
 * }} StandardMetadata
 * @typedef {{
 *   type: StandardType,
 *   data: StandardData,
 *   metadata: StandardMetadata
 * }} StandardInput
 */

const TYPES = new Set(["image", "document", "product"]);

/**
 * Coerce unknown input into the standard format and validate required fields.
 * @param {unknown} input
 * @returns {StandardInput}
 */
export function normalizeInput(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("adapter: input must be a non-null object");
  }
  const o = /** @type {Record<string, unknown>} */ (input);
  const type = o.type;
  if (typeof type !== "string" || !TYPES.has(/** @type {string} */ (type))) {
    throw new Error(`adapter: type must be one of: image, document, product (got ${String(type)})`);
  }

  const dataIn = o.data != null && typeof o.data === "object" && !Array.isArray(o.data) ? o.data : {};
  const d = /** @type {Record<string, unknown>} */ (dataIn);
  const filePath = d.filePath != null ? String(d.filePath) : null;
  const url = d.url != null ? String(d.url) : null;
  let buffer = null;
  if (d.buffer != null) {
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(d.buffer)) buffer = d.buffer;
    else if (d.buffer instanceof Uint8Array) buffer = d.buffer;
    else throw new Error("adapter: data.buffer must be Buffer or Uint8Array when set");
  }

  const metaIn =
    o.metadata != null && typeof o.metadata === "object" && !Array.isArray(o.metadata)
      ? o.metadata
      : {};
  const m = /** @type {Record<string, unknown>} */ (metaIn);
  const source = m.source != null ? String(m.source) : "";
  const originalName = m.originalName != null ? String(m.originalName) : "";
  if (!source.length) throw new Error("adapter: metadata.source is required");
  if (!originalName.length) throw new Error("adapter: metadata.originalName is required");

  if (type === "image" && filePath != null && filePath.length) {
    const leaf = filePath.split(/[/\\]/).pop() ?? filePath;
    if (!isSupportedImageFilename(leaf)) {
      throw new Error(
        `adapter: image filePath must end with .png, .jpg, .jpeg, or .webp (got ${leaf})`,
      );
    }
  }

  /** @type {StandardMetadata} */
  const metadata = { source, originalName };
  if (Object.prototype.hasOwnProperty.call(m, "extractedText")) {
    metadata.extractedText = String(m.extractedText ?? "");
  }

  return {
    type: /** @type {StandardType} */ (type),
    data: { filePath, buffer, url },
    metadata,
  };
}

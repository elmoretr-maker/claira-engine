/**
 * In-memory caches for one attach-capabilities session (per batch).
 * Cleared when attachCapabilityResults starts.
 */

/** @type {Map<string, string>} path -> sha256 hex */
const hashCache = new Map();

/** @type {Map<string, unknown>} path -> sharp metadata snapshot */
const metadataCache = new Map();

export function clearCapabilitySessionCaches() {
  hashCache.clear();
  metadataCache.clear();
}

/**
 * @param {string} absPath
 * @param {() => string} compute
 */
export function getCachedFileHash(absPath, compute) {
  const key = String(absPath ?? "");
  if (!key) return compute();
  if (hashCache.has(key)) return /** @type {string} */ (hashCache.get(key));
  const h = compute();
  hashCache.set(key, h);
  return h;
}

/**
 * @param {string} absPath
 * @param {() => Promise<unknown>} compute
 */
export async function getCachedImageMetadata(absPath, compute) {
  const key = String(absPath ?? "");
  if (!key) return compute();
  if (metadataCache.has(key)) return metadataCache.get(key);
  const meta = await compute();
  metadataCache.set(key, meta);
  return meta;
}

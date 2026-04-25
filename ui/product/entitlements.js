/**
 * Additive product layer — mock user and entitlement helpers.
 * No server auth yet; entitlements are derived from vertical + dev query overrides.
 */

/** @typedef {"personal" | "business" | "commerce"} AppVertical */

/**
 * @typedef {{
 *   vertical: AppVertical,
 *   features: { insight: boolean, photo: boolean, catalog: boolean }
 * }} AppEntitlements
 */

/** Placeholder until real auth; UI and future API can read the same shape. */
export const mockUser = Object.freeze({
  id: "local-placeholder",
  email: "placeholder@local",
});

/** @type {string} Same key for session + clearVertical */
export const SESSION_KEY_VERTICAL = "claira.product.vertical";
const DEV_UNLOCK_PARAM = "unlock";

/**
 * @param {AppEntitlements} ent
 * @param {keyof AppEntitlements["features"]} feature
 * @returns {boolean}
 */
export function canAccess(ent, feature) {
  return ent?.features?.[feature] === true;
}

/**
 * Default tier: commerce starts with Photo; Catalog is the upgrade. Personal/business: Insight.
 * @param {AppVertical} vertical
 * @returns {AppEntitlements}
 */
export function getDefaultEntitlementsForVertical(vertical) {
  if (vertical === "commerce") {
    return {
      vertical: "commerce",
      features: { insight: false, photo: true, catalog: false },
    };
  }
  if (vertical === "personal") {
    return {
      vertical: "personal",
      features: { insight: true, photo: false, catalog: false },
    };
  }
  if (vertical === "business") {
    return {
      vertical: "business",
      features: { insight: true, photo: false, catalog: false },
    };
  }
  return {
    vertical: "business",
    features: { insight: true, photo: true, catalog: true },
  };
}

/**
 * `?unlock=all` or `?unlock=catalog` (comma-separated) — development / QA only.
 * @param {string} [search]
 * @param {AppEntitlements} base
 * @returns {AppEntitlements}
 */
export function applyDevUnlockFromSearch(search, base) {
  if (typeof search !== "string" || !search) return base;
  if (import.meta.env.PROD) return base;
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = q.get(DEV_UNLOCK_PARAM);
  if (!raw) return base;
  const parts = raw.split(",").map((s) => s.trim().toLowerCase());
  if (parts.includes("all")) {
    return {
      ...base,
      features: { insight: true, photo: true, catalog: true },
    };
  }
  const next = { ...base.features };
  for (const p of parts) {
    if (p === "insight" || p === "photo" || p === "catalog") next[p] = true;
  }
  return { ...base, features: next };
}

/**
 * @param {string | null | undefined} slug
 * @returns {AppVertical | null}
 */
export function parseVerticalPathParam(slug) {
  const s = String(slug ?? "")
    .trim()
    .toLowerCase();
  if (s === "personal" || s === "wellness") return "personal";
  if (s === "business" || s === "ops" || s === "operations") return "business";
  if (s === "commerce" || s === "store" || s === "shop") return "commerce";
  return null;
}

/**
 * @param {AppVertical} vertical
 */
export function writeSessionVertical(vertical) {
  try {
    sessionStorage.setItem(SESSION_KEY_VERTICAL, vertical);
  } catch {
    /* ignore */
  }
}

/**
 * @returns {AppVertical | null}
 */
export function readSessionVertical() {
  try {
    const v = sessionStorage.getItem(SESSION_KEY_VERTICAL);
    return v === "personal" || v === "business" || v === "commerce" ? v : null;
  } catch {
    return null;
  }
}

/**
 * @param {AppVertical} vertical
 */
export function replaceUrlPathParam(vertical) {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("path", vertical);
    window.history.replaceState({}, "", u.toString());
  } catch {
    /* ignore */
  }
}

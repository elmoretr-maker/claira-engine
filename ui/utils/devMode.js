/**
 * Developer override: `?dev=true` grants full feature access in the product layer only.
 * Does not change server-side auth; safe for production (only when the param is present).
 */

/**
 * @returns {boolean}
 */
export function isDevMode() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("dev") === "true";
}

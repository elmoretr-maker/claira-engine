import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  applyDevUnlockFromSearch,
  canAccess,
  getDefaultEntitlementsForVertical,
  parseVerticalPathParam,
  readSessionVertical,
  replaceUrlPathParam,
  SESSION_KEY_VERTICAL,
  writeSessionVertical,
} from "./entitlements.js";

/**
 * @typedef {import("./entitlements.js").AppVertical} AppVertical
 * @typedef {import("./entitlements.js").AppEntitlements} AppEntitlements
 */

/**
 * @typedef {{
 *   vertical: AppVertical | null,
 *   setVertical: (v: AppVertical) => void,
 *   clearVertical: () => void,
 *   entitlements: AppEntitlements,
 *   canAccess: (feature: keyof AppEntitlements["features"]) => boolean,
 *   isProductVerticalActive: boolean,
 * }} VerticalContextValue
 */

/** @type {import("react").Context<VerticalContextValue | null>} */
const VerticalContext = createContext(null);

/**
 * @param {{ children: import("react").ReactNode }} props
 */
export function VerticalProvider({ children }) {
  const [vertical, setVerticalState] = useState(/** @type {AppVertical | null} */ (null));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = parseVerticalPathParam(new URLSearchParams(window.location.search).get("path"));
    if (fromUrl) {
      setVerticalState(fromUrl);
      writeSessionVertical(fromUrl);
      return;
    }
    const fromSession = readSessionVertical();
    if (fromSession) {
      setVerticalState(fromSession);
    }
  }, []);

  const setVertical = useCallback((v) => {
    setVerticalState(v);
    writeSessionVertical(v);
    replaceUrlPathParam(v);
  }, []);

  const clearVertical = useCallback(() => {
    setVerticalState(null);
    try {
      sessionStorage.removeItem(SESSION_KEY_VERTICAL);
    } catch {
      /* ignore */
    }
    if (typeof window === "undefined") return;
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("path");
      window.history.replaceState({}, "", u.toString());
    } catch {
      /* ignore */
    }
  }, []);

  const entitlements = useMemo(() => {
    if (vertical == null) {
      return {
        vertical: "business",
        features: { insight: false, photo: false, catalog: false },
      };
    }
    const base = getDefaultEntitlementsForVertical(vertical);
    if (typeof window === "undefined") return base;
    return applyDevUnlockFromSearch(window.location.search, base);
  }, [vertical]);

  const canAccessFeature = useCallback(
    (/** @type {keyof AppEntitlements["features"]} */ feature) => canAccess(entitlements, feature),
    [entitlements],
  );

  const value = useMemo(
    () => ({
      vertical,
      setVertical,
      clearVertical,
      entitlements,
      canAccess: canAccessFeature,
      isProductVerticalActive: vertical != null,
    }),
    [vertical, setVertical, clearVertical, entitlements, canAccessFeature],
  );

  return <VerticalContext.Provider value={value}>{children}</VerticalContext.Provider>;
}

/**
 * @returns {VerticalContextValue}
 */
export function useVertical() {
  const ctx = useContext(VerticalContext);
  if (!ctx) {
    throw new Error("useVertical must be used within VerticalProvider");
  }
  return ctx;
}

/**
 * Safe when provider missing (e.g. tests) — returns permissive entitlements.
 * @returns {VerticalContextValue}
 */
export function useVerticalOptional() {
  const ctx = useContext(VerticalContext);
  if (ctx) return ctx;
  return {
    vertical: null,
    setVertical: () => {},
    clearVertical: () => {},
    entitlements: {
      vertical: "business",
      features: { insight: true, photo: true, catalog: true },
    },
    canAccess: () => true,
    isProductVerticalActive: false,
  };
}

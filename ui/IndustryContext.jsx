import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { loadIndustryPack as apiLoadIndustryPack } from "../interfaces/api.js";
import { STORAGE_INDUSTRY, clearTunnelState } from "./userPrefs.js";

/** @typedef {{ industrySlug: string, setIndustrySlug: (slug: string) => void, loadIndustryPack: (industry: string) => Promise<{ ok: boolean, industry: string }> }} IndustryContextValue */

/** @type {import("react").Context<IndustryContextValue | null>} */
const IndustryContext = createContext(null);

/**
 * @param {{ children: import("react").ReactNode }} props
 */
export function IndustryProvider({ children }) {
  const [industrySlug, setIndustrySlugState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_INDUSTRY) ?? "";
    } catch {
      return "";
    }
  });

  const setIndustrySlug = useCallback((slug) => {
    const s = String(slug ?? "").trim();
    setIndustrySlugState(s);
    try {
      if (s) localStorage.setItem(STORAGE_INDUSTRY, s);
      else localStorage.removeItem(STORAGE_INDUSTRY);
    } catch {
      /* private mode */
    }
  }, []);

  const loadIndustryPack = useCallback(
    async (industry) => {
      const prev = industrySlug;
      await apiLoadIndustryPack(industry);
      const slug = String(industry ?? "")
        .trim()
        .toLowerCase();
      if (prev && prev !== slug) {
        clearTunnelState();
      }
      setIndustrySlug(slug);
      return { ok: true, industry: slug };
    },
    [industrySlug, setIndustrySlug],
  );

  const value = useMemo(
    () => ({
      industrySlug,
      setIndustrySlug,
      loadIndustryPack,
    }),
    [industrySlug, setIndustrySlug, loadIndustryPack],
  );

  return <IndustryContext.Provider value={value}>{children}</IndustryContext.Provider>;
}

export function useIndustry() {
  const ctx = useContext(IndustryContext);
  if (!ctx) throw new Error("useIndustry must be used within IndustryProvider");
  return ctx;
}

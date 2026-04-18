import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { loadIndustryPack as apiLoadIndustryPack } from "../interfaces/api.js";
import { STORAGE_INDUSTRY, clearTunnelState, getPackDomainMode, setPackDomainMode } from "./userPrefs.js";

/** @typedef {{ industrySlug: string, packDomainMode: string, setIndustrySlug: (slug: string) => void, loadIndustryPack: (industry: string) => Promise<{ ok: boolean, industry: string, domainMode?: string }> }} IndustryContextValue */

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

  const [packDomainMode, setPackDomainModeState] = useState(() => getPackDomainMode() || "general");

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
      const out = await apiLoadIndustryPack(industry);
      if (out && /** @type {{ ok?: boolean }} */ (out).ok === false) {
        const details = Array.isArray(/** @type {{ details?: string[] }} */ (out).details)
          ? /** @type {{ details: string[] }} */ (out).details
          : [];
        const msg =
          details.length > 0
            ? `Cannot load pack — fix the following:\n${details.map((d) => `- ${d}`).join("\n")}`
            : String(/** @type {{ error?: string }} */ (out).error ?? "Could not load pack");
        throw new Error(msg);
      }
      const slug = String(industry ?? "")
        .trim()
        .toLowerCase();
      if (prev && prev !== slug) {
        clearTunnelState();
      }
      setIndustrySlug(slug);
      const dm =
        out && typeof /** @type {{ domainMode?: string }} */ (out).domainMode === "string"
          ? /** @type {{ domainMode: string }} */ (out).domainMode.trim()
          : "general";
      setPackDomainModeState(dm);
      setPackDomainMode(dm);
      return { ok: true, industry: slug, domainMode: dm };
    },
    [industrySlug, setIndustrySlug],
  );

  const value = useMemo(
    () => ({
      industrySlug,
      packDomainMode,
      setIndustrySlug,
      loadIndustryPack,
    }),
    [industrySlug, packDomainMode, setIndustrySlug, loadIndustryPack],
  );

  return <IndustryContext.Provider value={value}>{children}</IndustryContext.Provider>;
}

export function useIndustry() {
  const ctx = useContext(IndustryContext);
  if (!ctx) throw new Error("useIndustry must be used within IndustryProvider");
  return ctx;
}

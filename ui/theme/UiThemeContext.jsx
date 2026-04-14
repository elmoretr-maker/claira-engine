import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { applyUiThemeToDocument, readStoredUiTheme, writeStoredUiTheme } from "./uiThemeStorage.js";

/** @typedef {import("./uiThemeStorage.js").UiThemeId} UiThemeId */

/** @type {import("react").Context<{ theme: UiThemeId, setTheme: (t: UiThemeId) => void, toggleTheme: () => void } | null>} */
const UiThemeContext = createContext(null);

/**
 * @param {{ children: import("react").ReactNode }} props
 */
export function UiThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => readStoredUiTheme());

  useEffect(() => {
    applyUiThemeToDocument(theme);
    writeStoredUiTheme(theme);
  }, [theme]);

  const setTheme = useCallback((/** @type {UiThemeId} */ t) => {
    setThemeState(t === "standard" ? "standard" : "cinematic");
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === "cinematic" ? "standard" : "cinematic"));
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <UiThemeContext.Provider value={value}>{children}</UiThemeContext.Provider>;
}

export function useUiTheme() {
  const ctx = useContext(UiThemeContext);
  if (!ctx) {
    throw new Error("useUiTheme must be used within UiThemeProvider");
  }
  return ctx;
}

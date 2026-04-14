/** @typedef {"cinematic" | "standard"} UiThemeId */

export const UI_THEME_STORAGE_KEY = "claira_ui_theme";

/** @type {UiThemeId} */
export const UI_THEME_DEFAULT = "cinematic";

/**
 * @returns {UiThemeId}
 */
export function readStoredUiTheme() {
  try {
    const raw = localStorage.getItem(UI_THEME_STORAGE_KEY);
    if (raw === "standard" || raw === "cinematic") return raw;
  } catch {
    /* ignore */
  }
  return UI_THEME_DEFAULT;
}

/**
 * @param {UiThemeId} theme
 */
export function writeStoredUiTheme(theme) {
  try {
    localStorage.setItem(UI_THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

/**
 * @param {UiThemeId} theme
 */
export function applyUiThemeToDocument(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * @returns {UiThemeId}
 */
export function getInitialUiTheme() {
  return readStoredUiTheme();
}

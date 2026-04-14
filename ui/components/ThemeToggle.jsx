import { useUiTheme } from "../theme/UiThemeContext.jsx";
import "./ThemeToggle.css";

/**
 * @param {{ className?: string }} props
 */
export default function ThemeToggle({ className = "" }) {
  const { theme, toggleTheme } = useUiTheme();
  const cinematic = theme === "cinematic";

  return (
    <button
      type="button"
      className={`theme-toggle btn btn-ghost ${className}`.trim()}
      onClick={toggleTheme}
      aria-pressed={cinematic}
      title={
        cinematic
          ? "Switch to standard appearance (softer grays, less neon)"
          : "Switch to cinematic appearance (deep black, logo neon accents)"
      }
    >
      <span className="theme-toggle__swatch" aria-hidden="true" />
      <span className="theme-toggle__label">{cinematic ? "Cinematic" : "Standard"}</span>
    </button>
  );
}

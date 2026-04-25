import "./VerticalModeBanner.css";
import { useVertical } from "./VerticalContext.jsx";

const LABELS = {
  personal: "Personal mode",
  business: "Business mode",
  commerce: "Commerce mode",
};

/**
 * @param {{ className?: string }} props
 */
export default function VerticalModeBanner({ className = "" }) {
  const { vertical, isProductVerticalActive } = useVertical();
  if (!isProductVerticalActive || !vertical) return null;
  const label = LABELS[vertical] ?? "Claira";
  return (
    <div className={["app-vertical-mode-banner", className].filter(Boolean).join(" ")} role="status">
      <span className="app-vertical-mode-banner__dot" aria-hidden="true" />
      <span className="app-vertical-mode-banner__label">{label}</span>
    </div>
  );
}

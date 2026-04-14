import "./BrandMark.css";

/**
 * @param {{
 *   size?: "sm" | "md" | "lg",
 *   className?: string,
 *   variant?: "full" | "icon",
 * }} props
 */
export default function BrandMark({ size = "md", className = "", variant = "full" }) {
  const src = "/claira-engine-logo.png";
  const iconSrc = "/claira-engine-logo.png";

  return (
    <img
      src={variant === "icon" ? iconSrc : src}
      alt="Claira Engine"
      className={`brand-mark brand-mark--${size} ${variant === "icon" ? "brand-mark--icon-only" : ""} ${className}`.trim()}
      decoding="async"
    />
  );
}

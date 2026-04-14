import "./ClairaClaritySignature.css";

/**
 * Secondary wordmark: script “Claira” + gradient tagline, angled. Decorative only.
 *
 * @param {{ className?: string }} props
 */
export default function ClairaClaritySignature({ className = "" }) {
  return (
    <div
      className={`claira-clarity-signature ${className}`.trim()}
      aria-hidden="true"
    >
      <div className="claira-clarity-signature__stack">
        <span className="claira-clarity-signature__name">Claira</span>
        <span className="claira-clarity-signature__tagline">Clarity for your work</span>
      </div>
    </div>
  );
}

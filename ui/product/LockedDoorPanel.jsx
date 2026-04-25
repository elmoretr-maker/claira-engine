import "./LockedDoorPanel.css";

/**
 * Product-pitch copy per locked feature. `insightVariant` only applies to insight.
 * @satisfies {Record<string, { title: string, description: string, benefits: string[], cta: string }>}
 */
const COPY = {
  insight: {
    personal: {
      title: "See What’s Happening—and What to Do Next",
      description:
        "A clear read on your goals and your progress so you can adjust with confidence — not guesswork.",
      benefits: [
        "Understand what your numbers and habits are really saying",
        "Spot trends, gaps, and what to lean into next",
        "Get concrete, doable next steps — not a generic dashboard",
      ],
      cta: "Unlock Insight",
    },
    business: {
      title: "See What’s Happening—and What to Do Next",
      description:
        "See how your operation is performing, where the friction is, and what to fix first — in plain language.",
      benefits: [
        "Break down performance across the data you care about",
        "Surface trends, pressure points, and blind spots",
        "Leave with a short list of what to do next, not a pile of charts",
      ],
      cta: "Unlock Insight Engine",
    },
  },
  photo: {
    title: "Sort and Rank Your Photos Like a Pro",
    description: "Triage, score, and filter so the right shots float to the top before you do anything else.",
    benefits: [
      "Find your strongest images without endless scrolling",
      "Filter by what matters to your shoot, batch, or listing",
      "Move faster from “pile of files” to “ready for the next step”",
    ],
    cta: "Unlock Photo Sorter",
  },
  catalog: {
    title: "Turn Photos into Products",
    description:
      "Move from sorted images to structured product fields you can use in a store — without starting from a blank form.",
    benefits: [
      "Generate structured product listings from your best shots",
      "Organize and prep catalog data the same way your workflow runs",
      "Export-friendly output for ecommerce and merchandising",
    ],
    cta: "Unlock Catalog Builder",
  },
};

/**
 * @param {{
 *   feature: "insight" | "photo" | "catalog",
 *   insightVariant?: "personal" | "business",
 *   onUpgrade?: () => void,
 *   onClose?: () => void,
 *   ctaOverride?: string,
 * }} props
 */
export default function LockedDoorPanel({
  feature,
  insightVariant = "business",
  onUpgrade,
  onClose,
  ctaOverride,
}) {
  const block =
    feature === "insight"
      ? COPY.insight[insightVariant === "personal" ? "personal" : "business"]
      : feature === "photo" || feature === "catalog"
        ? COPY[feature]
        : COPY.insight.business;
  const cta = ctaOverride ?? ("cta" in block ? block.cta : "Upgrade");

  return (
    <div className="locked-door-panel card" role="region" aria-labelledby="locked-door-title">
      {typeof onClose === "function" ? (
        <div className="locked-door-panel__row">
          <button type="button" className="btn btn-ghost locked-door-panel__close" onClick={onClose}>
            Back
          </button>
        </div>
      ) : null}
      <h2 id="locked-door-title" className="locked-door-panel__title">
        {block.title}
        <span className="locked-door-panel__badge">Upgrade</span>
      </h2>
      <p className="locked-door-panel__description">{block.description}</p>
      <ul className="locked-door-panel__benefits">
        {block.benefits.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <div className="locked-door-panel__actions">
        <button type="button" className="btn btn-primary locked-door-panel__cta" onClick={onUpgrade ?? (() => {})}>
          {cta}
        </button>
        {typeof onClose === "function" ? (
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Not now
          </button>
        ) : null}
      </div>
    </div>
  );
}

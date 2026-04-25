import { isDevMode } from "../utils/devMode.js";
import LockedDoorPanel from "./LockedDoorPanel.jsx";
import { useVertical } from "./VerticalContext.jsx";

/**
 * Entry-point gate: full tool UI or locked panel. Does not change child components.
 * @param {{
 *   feature: "insight" | "photo" | "catalog",
 *   children: import("react").ReactNode,
 *   onBackFromLocked?: () => void,
 * }} props
 */
export default function RequireEntitlement({ feature, children, onBackFromLocked }) {
  const { canAccess, vertical } = useVertical();
  if (isDevMode()) {
    return children;
  }
  if (canAccess(feature)) {
    return children;
  }
  const insightVariant = vertical === "personal" ? "personal" : "business";
  return (
    <div className="locked-door-panel--center-screen app-screen-fade">
      <LockedDoorPanel
        feature={feature}
        insightVariant={feature === "insight" ? insightVariant : "business"}
        onClose={onBackFromLocked}
        onUpgrade={() => {
          if (import.meta.env.DEV) {
            // Placeholder: Stripe TBD
            // eslint-disable-next-line no-console
            console.info("[Claira] upgrade placeholder for", feature);
          }
        }}
      />
    </div>
  );
}

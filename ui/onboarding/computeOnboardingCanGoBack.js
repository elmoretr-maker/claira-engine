/**
 * @param {{
 *   industryGateDone: boolean,
 *   preAppPhase: "packEntry" | "welcome",
 *   screen: string,
 *   appMode: "setup" | "runtime",
 * }} ctx
 * @returns {boolean}
 */
export function computeOnboardingCanGoBack({ industryGateDone, preAppPhase, screen, appMode }) {
  if (!industryGateDone) {
    if (preAppPhase === "packEntry") return true;
    return false;
  }

  switch (screen) {
    case "capabilities":
    case "structure":
    case "tunnel":
    case "processing":
    case "report":
    case "waiting":
    case "rooms":
    case "workspace":
    case "progress":
    case "logs":
      return true;
    case "entrance":
      return appMode === "setup";
    default:
      return false;
  }
}

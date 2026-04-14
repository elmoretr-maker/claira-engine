import { createContext, useContext } from "react";

/**
 * @typedef {{
 *   goBack: () => void,
 *   startOver: () => void,
 *   goToWelcome: () => void,
 *   canGoBack: boolean,
 * }} OnboardingNavValue
 */

/** @type {import("react").Context<OnboardingNavValue | null>} */
const OnboardingNavContext = createContext(null);

/**
 * @param {{ value: OnboardingNavValue | null, children: import("react").ReactNode }} props
 */
export function OnboardingNavProvider({ value, children }) {
  return <OnboardingNavContext.Provider value={value}>{children}</OnboardingNavContext.Provider>;
}

/**
 * @returns {OnboardingNavValue | null}
 */
export function useOnboardingNav() {
  return useContext(OnboardingNavContext);
}

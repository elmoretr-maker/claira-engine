import { useContext } from "react";
import { VoiceOnboardingContext } from "./VoiceOnboardingContext.jsx";

/**
 * Returns the current voice-onboarding context value.
 * Must be used inside {@link VoiceOnboardingProvider}.
 *
 * Kept in its own file so that `VoiceOnboardingContext.jsx` only exports React
 * components, satisfying Vite Fast Refresh's single-export-type requirement.
 *
 * @returns {ReturnType<typeof import("./VoiceOnboardingContext.jsx").VoiceOnboardingProvider> extends never ? any : any}
 */
export function useVoiceOnboarding() {
  const ctx = useContext(VoiceOnboardingContext);
  if (!ctx) throw new Error("useVoiceOnboarding must be used within VoiceOnboardingProvider");
  return /** @type {any} */ (ctx);
}

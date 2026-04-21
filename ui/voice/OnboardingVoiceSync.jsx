import { useEffect, useRef } from "react";
import { useVoiceOnboarding } from "./useVoiceOnboarding.js";

/**
 * Stops speech when voice guidance is turned off. Autoplay for each page is handled in
 * {@link VoiceOnboardingContext.jsx} `syncVoiceFromRoute` (single source, no duplicate speak).
 */
export default function OnboardingVoiceSync() {
  const { cancelAllSpeech, voiceEnabled } = useVoiceOnboarding();
  const cancelRef = useRef(cancelAllSpeech);
  cancelRef.current = cancelAllSpeech;

  useEffect(() => {
    if (!voiceEnabled) {
      cancelRef.current();
    }
  }, [voiceEnabled]);

  return null;
}

import { useEffect, useRef } from "react";
import { ONBOARDING_TOTAL_STEPS } from "../onboarding/onboardingFlowMeta.js";
import { getVoiceScriptForStep } from "./clairaVoiceSteps.js";
import { useVoiceOnboarding } from "./VoiceOnboardingContext.jsx";

/**
 * Onboarding phase: auto line from `step` only. `voiceSyncKey` remounts the sync when re-entering
 * the same step from outside (e.g. pack → welcome again).
 *
 * @param {{ step: number | null, voiceSyncKey?: string }} props
 */
export default function OnboardingVoiceSync({ step, voiceSyncKey = "default" }) {
  const { speakOnboardingLine, cancelAllSpeech, voiceEnabled } = useVoiceOnboarding();
  const speakRef = useRef(speakOnboardingLine);
  speakRef.current = speakOnboardingLine;
  const cancelRef = useRef(cancelAllSpeech);
  cancelRef.current = cancelAllSpeech;

  useEffect(() => {
    if (!voiceEnabled) {
      cancelRef.current();
    }
  }, [voiceEnabled]);

  useEffect(() => {
    if (import.meta.env?.DEV) {
      console.log("[Claira] OnboardingVoiceSync step triggered:", step, voiceSyncKey, {
        voiceEnabled,
        maxStep: ONBOARDING_TOTAL_STEPS,
      });
    }
    if (!voiceEnabled) {
      if (import.meta.env?.DEV) console.log("[Claira] OnboardingVoiceSync: voice off, skip speak");
      return;
    }
    if (step == null || step < 0 || step > ONBOARDING_TOTAL_STEPS) {
      if (import.meta.env?.DEV) {
        console.warn("[Claira] OnboardingVoiceSync: invalid step (expected 0–" + ONBOARDING_TOTAL_STEPS + ")", step);
      }
      return;
    }
    const text = getVoiceScriptForStep(step);
    if (!text) {
      if (import.meta.env?.DEV) {
        console.error("[Claira] OnboardingVoiceSync: no script for step", step, "(check CLAIRA_VOICE_STEPS)");
      }
      return;
    }
    if (import.meta.env?.DEV) {
      console.log("[Claira] OnboardingVoiceSync: speaking step", step, "len", text.length);
    }
    speakRef.current(text, { interrupt: true });
    return () => {
      cancelRef.current();
    };
  }, [step, voiceEnabled, voiceSyncKey]);

  return null;
}

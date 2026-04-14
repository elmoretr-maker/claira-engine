import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelClairaSpeech,
  primeClairaVoicePlayback,
  speakClairaByMode,
} from "./clairaSpeech.js";

const DEBOUNCE_MS = 380;

/** @type {import("react").Context<unknown>} */
const VoiceOnboardingContext = createContext(null);

/**
 * @param {{ children: import("react").ReactNode }} props
 */
export function VoiceOnboardingProvider({ children }) {
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  /** ElevenLabs-only: controls are shown whenever output is enabled (no browser TTS). */
  const [voiceSupported] = useState(() => typeof window !== "undefined");

  const voiceEnabledRef = useRef(voiceEnabled);
  const scheduleRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);

  useEffect(() => {
    const onFirstPointer = () => {
      document.removeEventListener("pointerdown", onFirstPointer, true);
      void primeClairaVoicePlayback();
    };
    document.addEventListener("pointerdown", onFirstPointer, { capture: true, passive: true });
    return () => document.removeEventListener("pointerdown", onFirstPointer, true);
  }, []);

  const clearSchedule = useCallback(() => {
    if (scheduleRef.current != null) {
      clearTimeout(scheduleRef.current);
      scheduleRef.current = null;
    }
  }, []);

  const cancelAllSpeech = useCallback(() => {
    clearSchedule();
    cancelClairaSpeech();
  }, [clearSchedule]);

  /** Clears debounced auto-play only (does not stop current audio). */
  const cancelPendingVoiceSchedule = useCallback(() => {
    clearSchedule();
  }, [clearSchedule]);

  /**
   * Automated lines: default `interrupt: false` (queue / wait — no cutoff mid-sentence).
   * Pass `interrupt: true` on onboarding step change or explicit takeover.
   *
   * @param {string} text
   * @param {{ interrupt?: boolean }} [opts]
   */
  const speakOnboardingLine = useCallback(
    (text, opts = {}) => {
      const interrupt = opts.interrupt === true;
      clearSchedule();
      const t = String(text ?? "").trim();
      if (import.meta.env?.DEV) {
        console.log("[Claira] speakOnboardingLine called", {
          interrupt,
          voiceEnabled: voiceEnabledRef.current,
          textLen: t.length,
          preview: t.slice(0, 80) + (t.length > 80 ? "…" : ""),
        });
      }
      if (!t) {
        if (import.meta.env?.DEV) console.warn("[Claira] speakOnboardingLine: empty text, skip");
        return;
      }
      if (!voiceEnabledRef.current) {
        if (import.meta.env?.DEV) console.warn("[Claira] speakOnboardingLine: voice disabled, skip");
        return;
      }

      if (interrupt) {
        cancelClairaSpeech();
        void speakClairaByMode(t, { interrupt: true });
        return;
      }

      scheduleRef.current = setTimeout(() => {
        scheduleRef.current = null;
        if (!voiceEnabledRef.current) return;
        void speakClairaByMode(t, { interrupt: false });
      }, DEBOUNCE_MS);
    },
    [clearSchedule],
  );

  const speakOnboardingLineRef = useRef(speakOnboardingLine);
  useEffect(() => {
    speakOnboardingLineRef.current = speakOnboardingLine;
  }, [speakOnboardingLine]);

  const replayOnboardingLine = useCallback(
    (text) => {
      if (import.meta.env?.DEV) console.log("[Claira] replayOnboardingLine (Hear it again)");
      clearSchedule();
      cancelClairaSpeech();
      const t = String(text ?? "").trim();
      if (!t || !voiceEnabledRef.current) return;
      void speakClairaByMode(t, { interrupt: true });
    },
    [clearSchedule],
  );

  const toggleVoice = useCallback(() => {
    void (async () => {
      await primeClairaVoicePlayback();
      setVoiceEnabled((v) => {
        if (v) cancelAllSpeech();
        return !v;
      });
    })();
  }, [cancelAllSpeech]);

  const value = useMemo(
    () => ({
      voiceEnabled,
      voiceSupported,
      setVoiceEnabled,
      toggleVoice,
      speakOnboardingLine,
      speakOnboardingLineRef,
      replayOnboardingLine,
      cancelAllSpeech,
      cancelPendingVoiceSchedule,
    }),
    [
      voiceEnabled,
      voiceSupported,
      toggleVoice,
      speakOnboardingLine,
      replayOnboardingLine,
      cancelAllSpeech,
      cancelPendingVoiceSchedule,
    ],
  );

  return <VoiceOnboardingContext.Provider value={value}>{children}</VoiceOnboardingContext.Provider>;
}

export function useVoiceOnboarding() {
  const ctx = useContext(VoiceOnboardingContext);
  if (!ctx) throw new Error("useVoiceOnboarding must be used within VoiceOnboardingProvider");
  return ctx;
}

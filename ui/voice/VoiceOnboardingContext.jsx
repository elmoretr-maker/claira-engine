import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelClairaSpeech,
  initClairaVoiceClient,
  primeClairaVoicePlayback,
  speakClaira,
  speakClairaByMode,
} from "./clairaSpeech.js";
import { getVoiceScriptForStep } from "./clairaVoiceSteps.js";
import {
  getHtmlVoiceAudio,
  isVoiceOutputMuted,
  pauseVoiceAudio,
  resumeVoiceAudio,
  setVoiceOutputMuted,
  subscribeVoiceAudio,
} from "./localVoicePlayback.js";
import { ONBOARDING_TOTAL_STEPS } from "../onboarding/onboardingFlowMeta.js";

const DEBOUNCE_MS = 380;

/**
 * Exported so `useVoiceOnboarding.js` can import the context object without
 * re-exporting it from this file (keeping Fast Refresh happy — all exports here
 * are React components, not hooks).
 *
 * @type {import("react").Context<unknown>}
 */
export const VoiceOnboardingContext = createContext(null);

/**
 * @param {{ children: import("react").ReactNode }} props
 */
export function VoiceOnboardingProvider({ children }) {
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  /** Mirrors {@link isVoiceOutputMuted} for UI (volume mute, not OS mixer). */
  const [voiceOutputMuted, setVoiceOutputMutedState] = useState(() => isVoiceOutputMuted());
  /** Voice: local pre-baked MP3 first (voice-manifest), then stream fallback — in-browser `HTMLAudioElement` only. */
  const [voiceSupported] = useState(() => typeof window !== "undefined");

  /** Route-derived voice step (0–9) for the current onboarding page; drives replay and "current line". */
  const [currentVoiceStep, setCurrentVoiceStep] = useState(/** @type {number | null} */ (null));
  const [currentVoiceScript, setCurrentVoiceScript] = useState("");
  const currentVoiceScriptRef = useRef("");
  const routeVoiceStepRef = useRef(/** @type {number | null} */ (null));

  const voiceEnabledRef = useRef(voiceEnabled);
  const scheduleRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);

  useEffect(() => {
    currentVoiceScriptRef.current = currentVoiceScript;
  }, [currentVoiceScript]);

  useEffect(() => {
    void initClairaVoiceClient();
  }, []);

  useEffect(() => {
    return subscribeVoiceAudio(() => setVoiceOutputMutedState(isVoiceOutputMuted()));
  }, []);

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
      if (isVoiceOutputMuted()) {
        if (import.meta.env?.DEV) console.warn("[Claira] speakOnboardingLine: output muted, skip");
        return;
      }

      if (interrupt) {
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

  /**
   * Sync route → current page script. On step change, stops prior speech so autoplay/replay never overlap.
   * @param {number | null} step
   */
  const syncVoiceFromRoute = useCallback(
    (step) => {
      let n = null;
      if (typeof step === "number" && Number.isFinite(step)) {
        n = Math.floor(step);
      }
      const prev = routeVoiceStepRef.current;
      if (prev !== n) {
        routeVoiceStepRef.current = n;
        cancelClairaSpeech();
      }
      setCurrentVoiceStep(n);
      let text = "";
      if (n != null && n >= 0 && n <= ONBOARDING_TOTAL_STEPS) {
        text = String(getVoiceScriptForStep(n) ?? "").trim();
      }
      currentVoiceScriptRef.current = text;
      setCurrentVoiceScript(text);
      // Step 0 = Welcome screen: user-triggered only, never autoplay on mount.
      if (prev !== n && n !== 0 && text && voiceEnabledRef.current && !isVoiceOutputMuted()) {
        void speakClaira(text, { interrupt: true });
      }
    },
    [cancelClairaSpeech],
  );

  const replayCurrentVoice = useCallback(async () => {
    if (import.meta.env?.DEV) console.log("[Claira] replayCurrentVoice (Hear it again)");
    await primeClairaVoicePlayback();
    clearSchedule();
    const t = String(currentVoiceScriptRef.current ?? "").trim();
    if (!t || !voiceEnabledRef.current) return;
    if (isVoiceOutputMuted()) return;
    cancelClairaSpeech();
    void speakClaira(t, { interrupt: true });
  }, [clearSchedule]);

  const pauseVoicePlayback = useCallback(() => {
    pauseVoiceAudio();
  }, []);

  const playOrResumeCurrentPageVoice = useCallback(async () => {
    await primeClairaVoicePlayback();
    if (!voiceEnabledRef.current || isVoiceOutputMuted()) return;
    const html = getHtmlVoiceAudio();
    if (html && !html.paused && !html.ended) {
      return;
    }
    if (html && html.paused && !html.ended) {
      const ok = await resumeVoiceAudio();
      if (ok) return;
    }
    const t = String(currentVoiceScriptRef.current ?? "").trim();
    if (!t) return;
    void speakClaira(t, { interrupt: true });
  }, []);

  /**
   * Toggles output **mute** — sets `audio.volume` to 0 or restores it.
   * Does NOT pause the audio element; video keeps playing, audio plays silently when muted.
   */
  const toggleVoice = useCallback(() => {
    const nextMuted = !isVoiceOutputMuted();
    setVoiceOutputMuted(nextMuted);
    setVoiceOutputMutedState(nextMuted);
  }, []);

  const value = useMemo(
    () => ({
      voiceEnabled,
      voiceOutputMuted,
      voiceSupported,
      currentVoiceStep,
      currentVoiceScript,
      setVoiceEnabled,
      toggleVoice,
      speakOnboardingLine,
      speakOnboardingLineRef,
      syncVoiceFromRoute,
      replayCurrentVoice,
      pauseVoicePlayback,
      playOrResumeCurrentPageVoice,
      cancelAllSpeech,
      cancelPendingVoiceSchedule,
    }),
    [
      voiceEnabled,
      voiceOutputMuted,
      voiceSupported,
      currentVoiceStep,
      currentVoiceScript,
      toggleVoice,
      speakOnboardingLine,
      syncVoiceFromRoute,
      replayCurrentVoice,
      pauseVoicePlayback,
      playOrResumeCurrentPageVoice,
      cancelAllSpeech,
      cancelPendingVoiceSchedule,
    ],
  );

  return <VoiceOnboardingContext.Provider value={value}>{children}</VoiceOnboardingContext.Provider>;
}

/**
 * Keeps {@link VoiceOnboardingProvider}'s `currentVoiceStep` / `currentVoiceScript` aligned with route
 * and triggers one autoplay per step change via `speakClaira` inside `syncVoiceFromRoute`.
 *
 * Uses `useContext` directly (not the `useVoiceOnboarding` hook) to avoid a circular
 * module dependency with `useVoiceOnboarding.js`.
 *
 * @param {{ step: number | null }} props
 */
export function VoiceOnboardingRouteSync({ step }) {
  const { syncVoiceFromRoute } = /** @type {{ syncVoiceFromRoute: (s: number | null) => void }} */ (
    useContext(VoiceOnboardingContext)
  );
  useEffect(() => {
    syncVoiceFromRoute(step);
  }, [step, syncVoiceFromRoute]);
  return null;
}

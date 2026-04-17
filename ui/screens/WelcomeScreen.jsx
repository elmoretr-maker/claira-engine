import { useCallback, useEffect, useRef, useState } from "react";
import BrandMark from "../components/BrandMark.jsx";
import ClairaClaritySignature from "../components/ClairaClaritySignature.jsx";
import {
  pauseClairaSpeechPlayback,
  primeClairaVoicePlayback,
  resumeClairaSpeechPlayback,
} from "../voice/clairaSpeech.js";
import { getVoiceScriptForStep } from "../voice/clairaVoiceSteps.js";
import { useVoiceOnboarding } from "../voice/VoiceOnboardingContext.jsx";
import GuidedStepChrome from "../onboarding/GuidedStepChrome.jsx";
import { ONBOARDING_STEP } from "../onboarding/onboardingFlowMeta.js";
import "./WelcomeScreen.css";

const WELCOME_VOICE_STEP = 0;

/**
 * @param {{ onStart: () => void }} props
 */
export default function WelcomeScreen({ onStart }) {
  const videoRef = useRef(/** @type {HTMLVideoElement | null} */ (null));
  const [videoFailed, setVideoFailed] = useState(false);
  const [staticVideoOnly, setStaticVideoOnly] = useState(false);
  const [mediaPaused, setMediaPaused] = useState(true);

  const { speakOnboardingLine, cancelAllSpeech, voiceEnabled, setVoiceEnabled } = useVoiceOnboarding();

  const isStatic = videoFailed || staticVideoOnly;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setStaticVideoOnly(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || isStatic) return;
    const onPlay = () => setMediaPaused(false);
    const onPause = () => setMediaPaused(true);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [isStatic, videoFailed]);

  const welcomeScript = getVoiceScriptForStep(WELCOME_VOICE_STEP) ?? "";

  const speakWelcomeLine = useCallback(() => {
    const t = String(welcomeScript).trim();
    if (!t || !voiceEnabled) return;
    speakOnboardingLine(t, { interrupt: true });
  }, [speakOnboardingLine, voiceEnabled, welcomeScript]);

  const isVideoAtStart = useCallback(() => {
    const v = videoRef.current;
    if (!v) return true;
    return v.ended || v.currentTime < 0.05;
  }, []);

  const handlePlay = useCallback(async () => {
    await primeClairaVoicePlayback();
    if (isStatic) {
      speakWelcomeLine();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused && isVideoAtStart()) {
      speakWelcomeLine();
    } else if (v.paused && voiceEnabled) {
      resumeClairaSpeechPlayback();
    }
    try {
      await v.play();
    } catch {
      /* ignore */
    }
  }, [isStatic, isVideoAtStart, speakWelcomeLine, voiceEnabled]);

  const handlePause = useCallback(() => {
    if (isStatic) return;
    videoRef.current?.pause();
    pauseClairaSpeechPlayback();
  }, [isStatic]);

  const handleReplay = useCallback(async () => {
    await primeClairaVoicePlayback();
    if (isStatic) {
      speakWelcomeLine();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
    speakWelcomeLine();
    try {
      await v.play();
    } catch {
      /* ignore */
    }
  }, [isStatic, speakWelcomeLine]);

  const handleNarrationToggle = useCallback(() => {
    if (voiceEnabled) {
      cancelAllSpeech();
      setVoiceEnabled(false);
    } else {
      void primeClairaVoicePlayback();
      setVoiceEnabled(true);
    }
  }, [voiceEnabled, cancelAllSpeech, setVoiceEnabled]);

  const handleVideoEnded = useCallback(() => {
    videoRef.current?.pause();
  }, []);

  const handleStart = useCallback(() => {
    void (async () => {
      await primeClairaVoicePlayback();
      onStart();
    })();
  }, [onStart]);

  return (
    <main className="welcome-screen">
      <ClairaClaritySignature className="claira-clarity-signature--corner-bottom" />
      <div className="welcome-screen-inner">
        <GuidedStepChrome
          step={ONBOARDING_STEP.welcome}
          voiceReplayStep={WELCOME_VOICE_STEP}
          phaseLabel="Welcome"
          hideBack
          hideHome
          hideStartOver
          hideStepProgress
          hidePhaseLabel
        />
        <div className="welcome-card card">
          <BrandMark size="lg" className="welcome-brand-mark" />
          <h1 className="welcome-page-title">Welcome</h1>
          <div className="welcome-card__video-shell">
            {isStatic ? (
              <img
                className="welcome-card__video-fallback"
                src="/claira-welcome-hero.png"
                alt=""
                decoding="async"
              />
            ) : (
              <video
                ref={videoRef}
                className="welcome-card__video"
                muted
                playsInline
                preload="metadata"
                poster="/claira-welcome-hero.png"
                onError={() => setVideoFailed(true)}
                onEnded={handleVideoEnded}
              >
                <source src="/assets/Claira_video_silent.mp4" type="video/mp4" />
              </video>
            )}
            <div className="welcome-card__video-controls" role="group" aria-label="Welcome video">
              <button
                type="button"
                className="btn btn-secondary welcome-card__ctrl"
                disabled={!isStatic && !mediaPaused}
                onClick={() => void handlePlay()}
              >
                Play
              </button>
              <button
                type="button"
                className="btn btn-secondary welcome-card__ctrl"
                disabled={isStatic || mediaPaused}
                onClick={handlePause}
              >
                Pause
              </button>
              <button type="button" className="btn btn-secondary welcome-card__ctrl" onClick={() => void handleReplay()}>
                Replay
              </button>
              <button
                type="button"
                className="btn btn-secondary welcome-card__ctrl"
                onClick={handleNarrationToggle}
                aria-pressed={!voiceEnabled}
              >
                {voiceEnabled ? "Silence" : "Voice"}
              </button>
            </div>
          </div>
          <p className="welcome-card__video-hint">Watch how Claira works</p>
          <p className="welcome-kicker">Claira</p>
          <h2 className="welcome-title">Hi, I&apos;m Claira</h2>
          <p className="welcome-lead">
            I'll help you keep everything organized—tracking, sorting, and managing what matters most to you—whether that's in your life or your industry.
          </p>
          <p className="welcome-lead">
            I'll stay beside you every step of the way as we get things set up and running smoothly.
          </p>
          <p className="welcome-lead">Ready to begin? Let's get everything set up.</p>
          <div className="welcome-actions">
            <button type="button" className="btn btn-primary welcome-start" onClick={handleStart}>
              Start
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

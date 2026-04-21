import { useCallback, useEffect, useRef, useState } from "react";
import BrandMark from "../components/BrandMark.jsx";
import ClairaClaritySignature from "../components/ClairaClaritySignature.jsx";
import { primeClairaVoicePlayback, speakClaira } from "../voice/clairaSpeech.js";
import { getHtmlVoiceAudio } from "../voice/localVoicePlayback.js";
import { useVoiceOnboarding } from "../voice/useVoiceOnboarding.js";
import GuidedStepChrome from "../onboarding/GuidedStepChrome.jsx";
import { ONBOARDING_STEP } from "../onboarding/onboardingFlowMeta.js";
import "./WelcomeScreen.css";

/**
 * @param {{ onStart: () => void }} props
 */
export default function WelcomeScreen({ onStart }) {
  const videoRef = useRef(/** @type {HTMLVideoElement | null} */ (null));
  const [videoFailed, setVideoFailed] = useState(false);
  const [staticVideoOnly, setStaticVideoOnly] = useState(false);
  /** true when video is NOT playing — used for the unified Play/Pause toggle */
  const [mediaPaused, setMediaPaused] = useState(true);

  const { currentVoiceScript, pauseVoicePlayback } = useVoiceOnboarding();

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

  /**
   * Play: resume audio if it's paused mid-clip, or start the welcome script fresh.
   * Resume calls `htmlAudio.play()` directly — volume is already correct on the element
   * (0 when muted, normal otherwise), so this works regardless of mute state.
   */
  const handlePlay = useCallback(async () => {
    await primeClairaVoicePlayback();
    const html = getHtmlVoiceAudio();
    if (html && html.paused && !html.ended) {
      void html.play().catch(() => {});
    } else if (!html || html.ended) {
      const t = String(currentVoiceScript ?? "").trim();
      if (t) void speakClaira(t, { interrupt: true });
    }
    if (!isStatic && videoRef.current && videoRef.current.paused) {
      void videoRef.current.play().catch(() => {});
    }
  }, [isStatic, currentVoiceScript]);

  /**
   * Pause: stops BOTH video and audio element.
   * `pauseVoicePlayback` calls `pauseVoiceAudio()` in the controller which pauses `htmlAudio`.
   * Because Bug 1 is fixed, `htmlAudio` correctly points to the current audio after a Replay.
   */
  const handlePause = useCallback(() => {
    pauseVoicePlayback();
    if (!isStatic) videoRef.current?.pause();
  }, [isStatic, pauseVoicePlayback]);

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
        {/* Top bar: no voice controls — Play is next to the Welcome heading below */}
        <GuidedStepChrome
          step={ONBOARDING_STEP.welcome}
          phaseLabel="Welcome"
          hideBack
          hideHome
          hideStartOver
          hideStepProgress
          hidePhaseLabel
          hideVoiceControls
        />
        <div className="welcome-card card">
          <BrandMark size="lg" className="welcome-brand-mark" />
          <div className="welcome-heading-row">
            <h1 className="welcome-page-title">Welcome</h1>
            <button
              type="button"
              className="btn btn-primary welcome-play-btn"
              onClick={mediaPaused ? () => void handlePlay() : handlePause}
              title={mediaPaused ? "Play video and voice" : "Pause"}
            >
              {mediaPaused ? "▶ Play" : "⏸ Pause"}
            </button>
          </div>
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
            {/* No controls inside the video box — all controls are in the top bar */}
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

import { useCallback } from "react";
import BrandMark from "../components/BrandMark.jsx";
import ClairaClaritySignature from "../components/ClairaClaritySignature.jsx";
import { primeClairaVoicePlayback } from "../voice/clairaSpeech.js";
import GuidedStepChrome from "../onboarding/GuidedStepChrome.jsx";
import { ONBOARDING_STEP } from "../onboarding/onboardingFlowMeta.js";
import "./WelcomeScreen.css";

/**
 * @param {{ onStart: () => void }} props
 */
export default function WelcomeScreen({ onStart }) {
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

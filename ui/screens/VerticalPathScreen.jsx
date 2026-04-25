import ClairaClaritySignature from "../components/ClairaClaritySignature.jsx";
import GuidedStepChrome from "../onboarding/GuidedStepChrome.jsx";
import { ONBOARDING_STEP } from "../onboarding/onboardingFlowMeta.js";
import "./WelcomeScreen.css";
import "./VerticalPathScreen.css";

/**
 * @param {{
 *   onSelectVertical: (v: "personal" | "business" | "commerce") => void,
 * }} props
 */
export default function VerticalPathScreen({ onSelectVertical }) {
  return (
    <main className="welcome-screen vertical-path-screen">
      <ClairaClaritySignature className="claira-clarity-signature--corner" />
      <div className="welcome-screen-inner welcome-screen-inner--category-wide">
        <GuidedStepChrome
          step={ONBOARDING_STEP.welcome}
          phaseLabel="Choose path"
          hideBack
          hideStartOver={false}
          hideHome
        >
          <div className="vertical-path-screen__inner">
            <h1 className="vertical-path-screen__title">What are you using Claira for?</h1>
            <p className="vertical-path-screen__lead">
              Pick a focus. You’ll only see what fits—one experience at a time.
            </p>
            <div className="vertical-path-grid">
              <button
                type="button"
                className="vertical-path-card card"
                onClick={() => onSelectVertical("personal")}
              >
                <span className="vertical-path-card__label">Personal</span>
                <span className="vertical-path-card__title">Wellness &amp; goals</span>
                <span className="vertical-path-card__desc">
                  Know exactly how to reach your goals—and what to change.
                </span>
              </button>
              <button
                type="button"
                className="vertical-path-card card"
                onClick={() => onSelectVertical("business")}
              >
                <span className="vertical-path-card__label">Business</span>
                <span className="vertical-path-card__title">How things are running</span>
                <span className="vertical-path-card__desc">
                  Know what’s happening—and what to do next.
                </span>
              </button>
              <button
                type="button"
                className="vertical-path-card card"
                onClick={() => onSelectVertical("commerce")}
              >
                <span className="vertical-path-card__label">Commerce</span>
                <span className="vertical-path-card__title">Photos &amp; products</span>
                <span className="vertical-path-card__desc">
                  Turn photos into products and build your catalog faster.
                </span>
              </button>
            </div>
          </div>
        </GuidedStepChrome>
      </div>
    </main>
  );
}

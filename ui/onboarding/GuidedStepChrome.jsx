import { SYSTEM_MODE } from "../../core/systemMode.js";
import ThemeToggle from "../components/ThemeToggle.jsx";
import { GuidedVoiceControls } from "../voice/GuidedVoiceControls.jsx";
import { useVoiceOnboarding } from "../voice/useVoiceOnboarding.js";
import { useOnboardingNav } from "./OnboardingNavContext.jsx";
import { getGuidedTaskProgress } from "./onboardingFlowMeta.js";
import "./GuidedStepChrome.css";

/**
 * @param {{
 *   step: number,
 *   phaseLabel: string,
 *   onBack?: () => void,
 *   backLabel?: string,
 *   hideBack?: boolean,
 *   hideStartOver?: boolean,
 *   hideHome?: boolean,
 *   hideStepProgress?: boolean,
 *   hidePhaseLabel?: boolean,
 *   showHome?: boolean,
 *   onHome?: () => void,
 *   voiceReplayStep?: number | null,
 *   hideVoiceControls?: boolean,
 *   children?: import("react").ReactNode,
 * }} props
 * `voiceReplayStep` kept for call-site clarity.
 * `hideVoiceControls` — pass true on Welcome to suppress top-bar voice buttons (Play lives inline next to heading).
 */
export default function GuidedStepChrome({
  step,
  phaseLabel,
  onBack,
  backLabel = "Back",
  hideBack = false,
  hideStartOver = false,
  hideHome = false,
  hideStepProgress = false,
  hidePhaseLabel = false,
  showHome = false,
  onHome,
  voiceReplayStep: _voiceReplayStep = null,
  hideVoiceControls = false,
  children,
}) {
  const modeLabel = SYSTEM_MODE === "simulation" ? "Practice" : "Live";
  const nav = useOnboardingNav();
  const { cancelAllSpeech } = useVoiceOnboarding();

  const useNavBack = Boolean(nav) && typeof onBack !== "function";
  const showBack =
    !hideBack &&
    (typeof onBack === "function" || (useNavBack && nav != null && nav.canGoBack === true));

  const handleBack = () => {
    cancelAllSpeech();
    if (useNavBack && nav?.goBack && nav.canGoBack) {
      nav.goBack();
      return;
    }
    onBack?.();
  };

  const handleStartOver = () => {
    nav?.startOver();
  };

  const handleHome = () => {
    cancelAllSpeech();
    if (showHome && typeof onHome === "function") {
      onHome();
      return;
    }
    nav?.goToWelcome?.();
  };

  const showStartOver = !hideStartOver && nav != null && typeof nav.startOver === "function";
  const showHomeButton =
    !hideHome &&
    ((showHome && typeof onHome === "function") || (nav != null && typeof nav.goToWelcome === "function"));

  const task = getGuidedTaskProgress(step);
  const progressLabel = `${task.taskLabel} (Step ${task.taskIndex} of ${task.taskTotal})`;

  return (
    <div className="guided-step-wrap">
      <div className="guided-step-bar">
        <div className="guided-step-bar-left">
          {showBack ? (
            <button type="button" className="btn btn-secondary guided-step-back" onClick={handleBack}>
              {backLabel}
            </button>
          ) : null}
          {hideStepProgress ? null : (
            <div className="guided-step-progress-cluster">
              <span className="guided-step-pill">{progressLabel}</span>
              <progress
                className="guided-task-progress-meter"
                max={task.taskTotal}
                value={task.taskIndex}
                aria-label={`Onboarding progress: ${progressLabel}`}
              />
            </div>
          )}
          {hidePhaseLabel ? null : <span className="guided-phase-label">{phaseLabel}</span>}
          <span className="guided-mode-pill">{modeLabel}</span>
        </div>
        <div className="guided-step-bar-right">
          <ThemeToggle className="guided-theme-toggle" />
          {showHomeButton ? (
            <button type="button" className="btn btn-ghost guided-step-home" onClick={handleHome}>
              Home
            </button>
          ) : null}
          {showStartOver ? (
            <button type="button" className="btn btn-ghost guided-start-over" onClick={handleStartOver}>
              Start over
            </button>
          ) : null}
          {hideVoiceControls ? null : <GuidedVoiceControls />}
        </div>
      </div>
      {children}
    </div>
  );
}

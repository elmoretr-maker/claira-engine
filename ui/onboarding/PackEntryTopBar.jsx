import { SYSTEM_MODE } from "../../core/systemMode.js";
import ThemeToggle from "../components/ThemeToggle.jsx";
import { VoiceGuidanceTools } from "../voice/VoiceGuidanceTools.jsx";
import "./GuidedStepChrome.css";

/**
 * Entry screen only: theme + voice tools, no onboarding step count or nav.
 *
 * @param {{ replayScript: string }} props
 */
export default function PackEntryTopBar({ replayScript }) {
  const modeLabel = SYSTEM_MODE === "simulation" ? "Practice" : "Live";

  return (
    <div className="guided-step-wrap">
      <div className="guided-step-bar">
        <div className="guided-step-bar-left">
          <span className="guided-mode-pill">{modeLabel}</span>
        </div>
        <div className="guided-step-bar-right">
          <ThemeToggle className="guided-theme-toggle" />
          <VoiceGuidanceTools replayScript={replayScript} />
        </div>
      </div>
    </div>
  );
}

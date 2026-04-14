import { primeClairaVoicePlayback } from "./clairaSpeech.js";
import { getVoiceScriptForStep } from "./clairaVoiceSteps.js";
import { useVoiceOnboarding } from "./VoiceOnboardingContext.jsx";
import "./ClairaVoiceChrome.css";

/**
 * @param {{ step?: number, overrideScript?: string }} props
 */
export function ClairaVoiceReplay({ step, overrideScript }) {
  const { replayOnboardingLine, voiceEnabled, voiceSupported } = useVoiceOnboarding();
  if (!voiceSupported) return null;

  const fromOverride = typeof overrideScript === "string" ? overrideScript.trim() : "";
  const fromStep =
    typeof step === "number" && Number.isFinite(step) ? getVoiceScriptForStep(step) ?? "" : "";
  const resolved = fromOverride || fromStep;

  return (
    <button
      type="button"
      className="claira-voice-replay btn btn-secondary"
      disabled={!voiceEnabled || !resolved}
      onClick={() =>
        void (async () => {
          await primeClairaVoicePlayback();
          replayOnboardingLine(resolved);
        })()
      }
      title={voiceEnabled ? "Hear Claira’s line again" : "Turn on voice to hear it again"}
      aria-label="Hear Claira’s guidance again"
    >
      Hear it again
    </button>
  );
}

import { primeClairaVoicePlayback } from "./clairaSpeech.js";
import { ClairaVoiceReplay } from "./ClairaVoiceReplay.jsx";
import { VoiceToggleButton } from "./VoiceToggleButton.jsx";
import { useVoiceOnboarding } from "./VoiceOnboardingContext.jsx";

/**
 * Mute + “Hear it again” as separate controls inside one grouped container.
 *
 * @param {{ step?: number | null, replayScript?: string }} props
 */
export function VoiceGuidanceTools({ step, replayScript }) {
  const { voiceSupported, speakOnboardingLine, voiceEnabled } = useVoiceOnboarding();
  if (!voiceSupported) return null;

  const hasScript = typeof replayScript === "string" && replayScript.trim().length > 0;
  const hasStep = typeof step === "number" && Number.isFinite(step);
  const showReplay = hasScript || hasStep;

  return (
    <div className="guided-voice-tools" role="group" aria-label="Voice guidance">
      <VoiceToggleButton />
      {import.meta.env.DEV ? (
        <button
          type="button"
          className="btn btn-secondary claira-voice-test"
          disabled={!voiceEnabled}
          title={voiceEnabled ? "Dev: run TTS pipeline" : "Turn on voice to test"}
          onClick={() =>
            void (async () => {
              await primeClairaVoicePlayback();
              speakOnboardingLine("Test voice working", { interrupt: true });
            })()
          }
        >
          Test Voice
        </button>
      ) : null}
      {showReplay ? <ClairaVoiceReplay step={hasStep ? step : undefined} overrideScript={hasScript ? replayScript : undefined} /> : null}
    </div>
  );
}

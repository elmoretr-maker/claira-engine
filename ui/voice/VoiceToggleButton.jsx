import { useVoiceOnboarding } from "./useVoiceOnboarding.js";
import "./ClairaVoiceChrome.css";

export function VoiceToggleButton() {
  const { voiceOutputMuted, toggleVoice, voiceSupported } = useVoiceOnboarding();
  if (!voiceSupported) return null;
  return (
    <button
      type="button"
      className="btn btn-secondary claira-voice-toggle"
      onClick={() => void toggleVoice()}
      aria-pressed={voiceOutputMuted}
      title={voiceOutputMuted ? "Unmute Claira voice (app)" : "Mute Claira voice (app volume)"}
      aria-label={voiceOutputMuted ? "Unmute Claira voice guidance" : "Mute Claira voice guidance"}
    >
      {voiceOutputMuted ? "\u{1F507}" : "\u{1F50A}"}
    </button>
  );
}

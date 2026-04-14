import { useVoiceOnboarding } from "./VoiceOnboardingContext.jsx";
import "./ClairaVoiceChrome.css";

export function VoiceToggleButton() {
  const { voiceEnabled, toggleVoice, voiceSupported } = useVoiceOnboarding();
  if (!voiceSupported) return null;
  return (
    <button
      type="button"
      className="btn btn-secondary claira-voice-toggle"
      onClick={() => void toggleVoice()}
      aria-pressed={voiceEnabled}
      title={voiceEnabled ? "Mute Claira voice" : "Turn on Claira voice"}
      aria-label={voiceEnabled ? "Mute Claira voice guidance" : "Unmute Claira voice guidance"}
    >
      {voiceEnabled ? "\u{1F50A}" : "\u{1F507}"}
    </button>
  );
}

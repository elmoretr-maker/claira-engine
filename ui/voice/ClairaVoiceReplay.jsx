import { useVoiceOnboarding } from "./useVoiceOnboarding.js";
import "./ClairaVoiceChrome.css";

/**
 * "Hear it again" button.
 * @param {{ onReplay?: () => void | Promise<void> }} props
 *   When `onReplay` is provided (Welcome screen), clicking restarts both video and voice.
 *   Otherwise falls back to `replayCurrentVoice` (voice only).
 */
export function ClairaVoiceReplay({ onReplay }) {
  const { replayCurrentVoice, voiceEnabled, voiceOutputMuted, voiceSupported, currentVoiceScript } = useVoiceOnboarding();
  if (!voiceSupported) return null;

  const resolved = String(currentVoiceScript ?? "").trim();
  const handleClick = onReplay ?? (() => void replayCurrentVoice());

  return (
    <button
      type="button"
      className="claira-voice-replay btn btn-secondary"
      disabled={!voiceEnabled || voiceOutputMuted || !resolved}
      onClick={() => void handleClick()}
      title={
        !voiceEnabled
          ? "Turn on voice guidance to hear it again"
          : voiceOutputMuted
            ? "Unmute voice to hear it again"
            : "Hear Claira's line again"
      }
      aria-label="Hear Claira's guidance again"
    >
      Hear it again
    </button>
  );
}

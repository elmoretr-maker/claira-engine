import { useEffect, useState } from "react";
import { subscribeVoiceAudio, isVoiceAudioActivelyPlaying } from "./voiceAudioController.js";
import { useVoiceOnboarding } from "./useVoiceOnboarding.js";

/**
 * Top-bar voice controls for onboarding pages (all pages EXCEPT Welcome).
 * Controls ONLY global narration via voiceAudioController / speakClaira.
 * Does NOT interact with inline audio.
 *
 * Renders: [Mute/Unmute] [Play ↔ Pause toggle] [Replay]
 */
export function GuidedVoiceControls() {
  const {
    voiceSupported,
    voiceEnabled,
    voiceOutputMuted,
    toggleVoice,
    pauseVoicePlayback,
    playOrResumeCurrentPageVoice,
    replayCurrentVoice,
  } = useVoiceOnboarding();

  const [audioPlaying, setAudioPlaying] = useState(() => isVoiceAudioActivelyPlaying());
  useEffect(() => {
    return subscribeVoiceAudio(() => setAudioPlaying(isVoiceAudioActivelyPlaying()));
  }, []);

  if (!voiceSupported) return null;

  return (
    <div className="guided-voice-tools" role="group" aria-label="Voice guidance">
      {/* Mute/Unmute — adjusts audio.volume only, does NOT pause playback */}
      <button
        type="button"
        className="btn btn-secondary claira-voice-toggle"
        onClick={() => toggleVoice()}
        aria-pressed={voiceOutputMuted}
        title={voiceOutputMuted ? "Unmute voice" : "Mute voice"}
      >
        {voiceOutputMuted ? "🔇 Unmute" : "🔊 Mute"}
      </button>

      {/* Unified Play ↔ Pause toggle */}
      <button
        type="button"
        className="btn btn-secondary claira-voice-playpause"
        disabled={!voiceEnabled}
        onClick={() => (audioPlaying ? pauseVoicePlayback() : void playOrResumeCurrentPageVoice())}
      >
        {audioPlaying ? "Pause" : "Play"}
      </button>

      {/* Replay — restarts current page's narration from the beginning */}
      <button
        type="button"
        className="btn btn-secondary claira-voice-replay"
        disabled={!voiceEnabled}
        onClick={() => void replayCurrentVoice()}
        title="Replay guidance"
        aria-label="Replay voice guidance"
      >
        Replay
      </button>
    </div>
  );
}

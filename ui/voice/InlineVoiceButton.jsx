/**
 * Inline speaker button — plays a pre-baked voice clip in isolation.
 *
 * Uses its OWN Audio() instance via inlineAudio.js.
 * Does NOT use voiceAudioController, speakClaira, pauseVoiceAudio, or resumeVoiceAudio.
 * Does NOT affect top-bar controls.
 *
 * Behavior:
 *  🔊 idle    → click → stop narration + play this clip
 *  ⏸ playing → click → stop this clip
 *  Clicking another button stops this one automatically (singleton).
 */

import { useEffect, useRef, useState } from "react";
import { resolveLocalVoiceFilename, localVoiceAssetUrl } from "./localVoicePlayback.js";
import { CLAIRA_INLINE_VOICE_KEYS } from "./clairaInlineVoiceKeys.js";
import { subscribeInlineAudio, getCurrentInlineAudio, playInlineAudio, stopInlineAudio } from "./inlineAudio.js";

/**
 * @param {{
 *   voiceKey: keyof typeof CLAIRA_INLINE_VOICE_KEYS,
 *   className?: string,
 * }} props
 */
export function InlineVoiceButton({ voiceKey, className = "" }) {
  const text = CLAIRA_INLINE_VOICE_KEYS[voiceKey] ?? "";

  /** Resolved URL for this clip, set once on mount. */
  const urlRef = useRef(/** @type {string | null} */ (null));

  /** The Audio element WE started (null when not playing). */
  const myAudioRef = useRef(/** @type {HTMLAudioElement | null} */ (null));

  const [isPlaying, setIsPlaying] = useState(false);

  // Resolve the local MP3 URL from the manifest once.
  useEffect(() => {
    if (!text) return;
    void resolveLocalVoiceFilename(text).then((filename) => {
      if (filename) urlRef.current = localVoiceAssetUrl(filename);
    });
  }, [text]);

  // Detect when someone else (another button or global narration) stops our audio.
  useEffect(() => {
    return subscribeInlineAudio(() => {
      const active = getCurrentInlineAudio();
      if (myAudioRef.current !== null && active !== myAudioRef.current) {
        myAudioRef.current = null;
        setIsPlaying(false);
      }
    });
  }, []);

  if (!text) return null;

  function handleClick() {
    if (isPlaying) {
      stopInlineAudio();
      myAudioRef.current = null;
      setIsPlaying(false);
    } else {
      if (!urlRef.current) return;
      const audio = playInlineAudio(urlRef.current);
      myAudioRef.current = audio;
      setIsPlaying(true);
    }
  }

  return (
    <button
      type="button"
      className={`inline-voice-btn${className ? ` ${className}` : ""}`}
      onClick={handleClick}
      title={isPlaying ? "Stop" : "Hear this section"}
      aria-label={isPlaying ? "Stop audio" : "Play audio for this section"}
    >
      {isPlaying ? "⏸" : "🔊"}
    </button>
  );
}

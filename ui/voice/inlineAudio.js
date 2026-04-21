/**
 * Isolated inline audio — completely separate from voiceAudioController and speakClaira.
 *
 * Rules:
 *  - Never calls attachHtmlVoiceAudio / detachHtmlVoiceAudio.
 *  - Never touches transport or lastUtterance on the controller.
 *  - Calls cancelClairaSpeech() before playing so only ONE audio is ever active.
 *  - Stops itself if global narration attaches a new audio to the controller.
 */

import { subscribeVoiceAudio, getHtmlVoiceAudio } from "./voiceAudioController.js";
import { cancelClairaSpeech } from "./clairaSpeech.js";

/** @type {HTMLAudioElement | null} */
let current = null;

/** @type {Set<() => void>} */
const listeners = new Set();

function emitInline() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

// When global narration attaches a new audio element → stop any inline audio.
// This fires any time the controller emits (attach or detach).
// We only act when the controller has an element (new narration started).
subscribeVoiceAudio(() => {
  if (getHtmlVoiceAudio() !== null && current !== null) {
    current.pause();
    current.src = "";
    current = null;
    emitInline();
  }
});

/**
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribeInlineAudio(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** @returns {HTMLAudioElement | null} */
export function getCurrentInlineAudio() {
  return current;
}

/** Stop the current inline audio clip (if any). */
export function stopInlineAudio() {
  if (current) {
    current.pause();
    current.src = "";
    current = null;
    emitInline();
  }
}

/**
 * Play a URL as isolated inline audio.
 * - Stops any active global narration (cancelClairaSpeech).
 * - Stops any existing inline audio first.
 * - Does NOT attach to voiceAudioController.
 *
 * @param {string} url
 * @returns {HTMLAudioElement} the new audio element
 */
export function playInlineAudio(url) {
  cancelClairaSpeech();
  stopInlineAudio();

  const audio = new Audio(url);
  current = audio;

  const clear = () => {
    if (current === audio) {
      current = null;
      emitInline();
    }
  };

  audio.onended = clear;
  audio.onerror = clear;

  void audio.play().catch(clear);

  emitInline();
  return audio;
}

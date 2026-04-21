/**
 * Single transport for Claira voice: one logical `HTMLAudioElement` at a time (`attachHtmlVoiceAudio`).
 * Pause / resume / replay operate on that instance (replay: `currentTime = 0`, then `play()`).
 */

/**
 * @param {string} s
 */
function normUtteranceText(s) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/** @typedef {'idle' | 'html-local' | 'html-stream'} VoiceTransport */

/** @type {HTMLAudioElement | null} */
let htmlAudio = null;

/** @type {VoiceTransport} */
let transport = "idle";

/** @type {{ text: string, filename: string | null } | null} */
let lastUtterance = null;

/** User mute: drives `audio.volume`, not system mixer. */
let outputMuted = false;

/** @type {number} */
let savedVolume = 1;

/** @type {Set<() => void>} */
const listeners = new Set();

/** Listeners attached to the current htmlAudio element so we can remove them on detach. */
let _htmlPlayListener = null;
let _htmlPauseListener = null;

function emit() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

/**
 * @returns {{
 *   transport: VoiceTransport,
 *   outputMuted: boolean,
 *   hasHtml: boolean,
 * }}
 */
export function getVoiceAudioState() {
  return {
    transport,
    outputMuted,
    hasHtml: htmlAudio != null,
  };
}

/**
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribeVoiceAudio(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function applyVolumeToHtml() {
  if (!htmlAudio) return;
  try {
    htmlAudio.volume = outputMuted ? 0 : savedVolume;
  } catch {
    /* ignore */
  }
}

/**
 * @param {HTMLAudioElement} audio
 * @param {{ text: string, filename?: string | null, source: 'local' | 'stream' }} meta
 */
export function attachHtmlVoiceAudio(audio, meta) {
  // Remove stale listeners from the previous element (if any).
  if (htmlAudio && _htmlPlayListener) {
    htmlAudio.removeEventListener("play", _htmlPlayListener);
    htmlAudio.removeEventListener("pause", _htmlPauseListener);
  }
  htmlAudio = audio;
  transport = meta.source === "stream" ? "html-stream" : "html-local";
  lastUtterance = { text: normUtteranceText(meta.text), filename: meta.filename ?? null };
  applyVolumeToHtml();
  // Re-emit whenever the element actually starts or pauses so subscribers
  // (e.g. GuidedVoiceControls Play↔Pause toggle) see the correct state.
  _htmlPlayListener = () => emit();
  _htmlPauseListener = () => emit();
  audio.addEventListener("play", _htmlPlayListener);
  audio.addEventListener("pause", _htmlPauseListener);
  emit();
}

export function detachHtmlVoiceAudio() {
  if (htmlAudio && _htmlPlayListener) {
    htmlAudio.removeEventListener("play", _htmlPlayListener);
    htmlAudio.removeEventListener("pause", _htmlPauseListener);
    _htmlPlayListener = null;
    _htmlPauseListener = null;
  }
  htmlAudio = null;
  if (transport === "html-local" || transport === "html-stream") {
    transport = "idle";
  }
  emit();
}

/**
 * @param {string} filename
 * @param {string} text
 * @returns {HTMLAudioElement}
 */
function createLocalHtmlAudio(filename, text) {
  const url = `/assets/audio/voice/${encodeURIComponent(filename)}`;
  const audio = new Audio();
  try {
    audio.playsInline = true;
    audio.setAttribute("playsInline", "");
  } catch {
    /* ignore */
  }
  audio.preload = "auto";
  audio.src = url;
  attachHtmlVoiceAudio(audio, { text, filename, source: "local" });
  return audio;
}

/**
 * Pause in-page voice playback.
 * @returns {Promise<void>}
 */
export async function pauseVoiceAudio() {
  try {
    if (htmlAudio && !htmlAudio.ended) {
      htmlAudio.pause();
    }
  } catch {
    /* ignore */
  }
  emit();
}

/**
 * Resume after pause, or cold-start the last local file line if needed.
 * Does NOT bail out when muted — `audio.volume` is already 0 on the element,
 * so resuming while muted plays silently (correct behaviour for Pause/Play toggle with mute).
 * @returns {Promise<boolean>}
 */
export async function resumeVoiceAudio() {
  try {
    if (htmlAudio && htmlAudio.paused && !htmlAudio.ended) {
      await htmlAudio.play();
      emit();
      return true;
    }
  } catch {
    return false;
  }
  if (lastUtterance?.filename) {
    const a = createLocalHtmlAudio(lastUtterance.filename, lastUtterance.text);
    try {
      await a.play();
      emit();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Replay: same `HTMLAudioElement` when still attached — seek to 0 and play.
 * @returns {Promise<boolean>}
 */
export async function replayVoiceUtterance() {
  if (!lastUtterance) return false;
  if (outputMuted) return false;

  if (htmlAudio) {
    try {
      htmlAudio.pause();
      htmlAudio.currentTime = 0;
      await htmlAudio.play();
      emit();
      return true;
    } catch {
      return false;
    }
  }

  if (lastUtterance.filename) {
    const a = createLocalHtmlAudio(lastUtterance.filename, lastUtterance.text);
    try {
      await a.play();
      emit();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * @param {boolean} muted
 */
export function setVoiceOutputMuted(muted) {
  outputMuted = muted;
  if (muted) {
    savedVolume = htmlAudio && htmlAudio.volume > 0 ? htmlAudio.volume : savedVolume || 1;
  }
  applyVolumeToHtml();
  emit();
}

export function toggleVoiceOutputMuted() {
  setVoiceOutputMuted(!outputMuted);
}

/** @returns {boolean} */
export function isVoiceOutputMuted() {
  return outputMuted;
}

/**
 * Hard stop for superseded lines / cancel.
 */
export async function stopVoiceAudioHard() {
  await pauseVoiceAudio();
  try {
    if (htmlAudio) {
      htmlAudio.pause();
    }
  } catch {
    /* ignore */
  }
  detachHtmlVoiceAudio();
  lastUtterance = null;
  transport = "idle";
  emit();
}

/** @returns {boolean} */
export function isVoiceAudioActivelyPlaying() {
  try {
    if (htmlAudio && !htmlAudio.paused && !htmlAudio.ended) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** @returns {HTMLAudioElement | null} */
export function getHtmlVoiceAudio() {
  return htmlAudio;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function lastUtteranceMatchesText(text) {
  if (!lastUtterance?.text) return false;
  return normUtteranceText(text) === lastUtterance.text;
}

/**
 * @returns {{ text: string, filename: string | null } | null}
 */
export function getLastUtteranceMeta() {
  return lastUtterance;
}

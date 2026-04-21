/**
 * Claira voice — **local pre-baked MP3 first** (`/assets/audio/voice/voice-manifest.json`),
 * then optional **stream fallback** (`POST /__claira/tts`) when `VITE_VOICE_STREAM_FALLBACK` is not `0`.
 *
 * - **interrupt: true** (default) — stop everything, then play.
 * - **interrupt: false** — queue after current clip if one is playing.
 *
 * Native / Play Store: call {@link setNativeVoicePlayer} from `localVoicePlayback.js`.
 */

import {
  tryPlayLocalVoiceAsset,
  setNativeVoicePlayer,
  attachHtmlVoiceAudio,
  detachHtmlVoiceAudio,
  getHtmlVoiceAudio,
  pauseVoiceAudio,
  resumeVoiceAudio,
  stopVoiceAudioHard,
  isVoiceAudioActivelyPlaying,
  isVoiceOutputMuted,
  loadVoiceManifest,
} from "./localVoicePlayback.js";

export { setNativeVoicePlayer };

/** @type {Set<() => void>} */
const speechCompleteListeners = new Set();

function voiceDbg(...args) {
  if (import.meta.env?.DEV) {
    console.log("[Claira]", ...args);
  }
}

function logTtsBackendUnavailableHint(status) {
  if (status === 500 || status === 502 || status === 503) {
    console.warn(
      `[Claira] TTS unavailable (HTTP ${status}). Start API + UI: npm run dev:full — or start:server + npm run dev.`,
    );
  }
}

function logIfUnexpectedAudioMime(headerCt, blobType, blobSize) {
  if (!blobSize) return;
  const h = (headerCt || "").toLowerCase();
  const b = (blobType || "").toLowerCase();
  const ok =
    h.includes("audio/mpeg") ||
    h.includes("audio/mp3") ||
    b.includes("audio/mpeg") ||
    b.includes("audio/mp3");
  if (!ok) {
    console.error("[Claira] invalid stream audio response", {
      contentType: headerCt || "(none)",
      blobType: blobType || "(none)",
      blobSize,
    });
  }
}

/**
 * @param {() => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeClairaSpeechComplete(listener) {
  speechCompleteListeners.add(listener);
  return () => speechCompleteListeners.delete(listener);
}

function notifyClairaSpeechComplete() {
  voiceDbg("notifyClairaSpeechComplete (utterance ended)");
  for (const fn of [...speechCompleteListeners]) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
  void tryDrainQueuedUtterance();
}

/** @type {number} */
let playbackGeneration = 0;

/** @type {string | null} */
let currentObjectUrl = null;

let queuedNonInterruptText = null;

/** @type {string} */
const VOICE_CLIENT_INIT_KEY = "__clairaVoiceClientInitPromise";

/**
 * @returns {boolean}
 */
export function isClairaVoicePlaying() {
  return isVoiceAudioActivelyPlaying();
}

export const isClairaElevenLabsPlaying = isClairaVoicePlaying;

/**
 * @returns {Promise<void>}
 */
export function afterCurrentClairaUtteranceOrNow() {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !isClairaVoicePlaying()) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        unsub();
      } catch {
        /* ignore */
      }
      resolve();
    };
    const unsub = subscribeClairaSpeechComplete(finish);
    window.setTimeout(finish, 30000);
  });
}

async function tryDrainQueuedUtterance() {
  const next = queuedNonInterruptText;
  if (!next) return;
  queuedNonInterruptText = null;
  if (isClairaVoicePlaying()) {
    queuedNonInterruptText = next;
    return;
  }
  voiceDbg("drain queue → speakClairaByMode (non-interrupt)");
  await speakClairaByMode(next, { interrupt: false });
}

/**
 * @returns {number}
 */
function getPlaybackGeneration() {
  return playbackGeneration;
}

/**
 * Stream fallback — Edge TTS bytes via API (optional).
 * @param {string} t
 * @param {number} myGen
 * @returns {Promise<boolean>}
 */
async function playStreamTtsUtterance(t, myGen) {
  if (import.meta.env?.VITE_VOICE_STREAM_FALLBACK === "0") {
    console.warn("[Claira] no local asset and stream fallback disabled (VITE_VOICE_STREAM_FALLBACK=0)");
    return false;
  }

  const res = await fetch("/__claira/tts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: t }),
  });

  if (!res.ok) {
    logTtsBackendUnavailableHint(res.status);
    return false;
  }

  const ab = await res.arrayBuffer();
  const headerCt = res.headers.get("content-type") || "";
  const mimePart = headerCt.split(";")[0].trim().toLowerCase();
  const blobMime = mimePart.startsWith("audio/") ? mimePart : "audio/mpeg";
  logIfUnexpectedAudioMime(headerCt, blobMime, ab.byteLength);
  if (!ab.byteLength) return false;

  const safeBlob = new Blob([ab], { type: blobMime });
  const url = URL.createObjectURL(safeBlob);
  currentObjectUrl = url;

  const audio = new Audio();
  attachHtmlVoiceAudio(audio, { text: t, filename: null, source: "stream" });
  try {
    audio.playsInline = true;
    audio.setAttribute("playsInline", "");
  } catch {
    /* ignore */
  }
  audio.preload = "auto";
  audio.src = url;

  const ok = await new Promise((resolve) => {
    const iv = setInterval(() => {
      if (myGen !== playbackGeneration) {
        clearInterval(iv);
        try {
          audio.pause();
        } catch {
          /* ignore */
        }
        if (getHtmlVoiceAudio() === audio) detachHtmlVoiceAudio();
        resolve(false);
      }
    }, 80);
    audio.onended = () => {
      clearInterval(iv);
      resolve(true);
    };
    audio.onerror = () => {
      clearInterval(iv);
      if (getHtmlVoiceAudio() === audio) detachHtmlVoiceAudio();
      resolve(false);
    };
    void audio.play().catch(() => {
      clearInterval(iv);
      if (getHtmlVoiceAudio() === audio) detachHtmlVoiceAudio();
      resolve(false);
    });
  });

  return ok && myGen === playbackGeneration;
}

/**
 * @param {string} t
 * @param {number} myGen
 * @returns {Promise<boolean>}
 */
async function playClairaTtsUtterance(t, myGen) {
  voiceDbg("playClairaTtsUtterance", { gen: myGen, textLen: t.length });

  const localOk = await tryPlayLocalVoiceAsset(t, myGen, getPlaybackGeneration);
  if (localOk) {
    notifyClairaSpeechComplete();
    return true;
  }

  if (myGen !== playbackGeneration) return false;

  if (import.meta.env?.DEV) {
    console.log("[Claira] voice: using stream fallback (POST /__claira/tts)", { textLen: t.length });
  }

  const streamOk = await playStreamTtsUtterance(t, myGen);
  if (streamOk) {
    notifyClairaSpeechComplete();
    return true;
  }

  return false;
}

/**
 * @returns {Promise<void>}
 */
export function initClairaVoiceClient() {
  if (typeof window === "undefined") return Promise.resolve();
  const g = /** @type {Window & { [VOICE_CLIENT_INIT_KEY]?: Promise<void> }} */ (window);
  const existing = g[VOICE_CLIENT_INIT_KEY];
  if (existing) return existing;
  const p = Promise.resolve().then(() =>
    loadVoiceManifest().catch(() => {
      if (import.meta.env?.DEV) {
        console.warn("[Claira] voice: could not preload voice-manifest.json (will retry on first line)");
      }
    }),
  );
  g[VOICE_CLIENT_INIT_KEY] = p;
  return p;
}

/**
 * No-op unlock for stream path (optional user gesture still helps some browsers).
 * @returns {Promise<void>}
 */
export async function primeClairaVoicePlayback() {
  voiceDbg("primeClairaVoicePlayback (optional)");
}

export function pauseClairaSpeechPlayback() {
  if (typeof window === "undefined") return;
  void pauseVoiceAudio();
}

export function resumeClairaSpeechPlayback() {
  if (typeof window === "undefined") return;
  void resumeVoiceAudio();
}

export function cancelClairaSpeech() {
  voiceDbg("cancelClairaSpeech()");
  playbackGeneration += 1;
  queuedNonInterruptText = null;
  void stopVoiceAudioHard();
  if (currentObjectUrl) {
    try {
      URL.revokeObjectURL(currentObjectUrl);
    } catch {
      /* ignore */
    }
    currentObjectUrl = null;
  }
}

/**
 * @param {string} text
 * @param {{ interrupt?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function speakClaira(text, options = {}) {
  const interrupt = options.interrupt !== false;
  await speakClairaByMode(text, { interrupt });
}

/**
 * @param {string} text
 * @param {{ interrupt?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function speakClairaByMode(text, options = {}) {
  try {
    const interrupt = options.interrupt === true;
    const t = String(text ?? "").trim();
    if (import.meta.env?.DEV) {
      console.log("[Claira] speak called:", t.slice(0, 100) + (t.length > 100 ? "…" : ""));
    }
    voiceDbg("speakClairaByMode", { interrupt, empty: !t, textLen: t.length });

    if (!t) return;

    if (isVoiceOutputMuted()) {
      voiceDbg("speakClairaByMode: output muted, skip");
      return;
    }

    if (!interrupt && isClairaVoicePlaying()) {
      voiceDbg("queue non-interrupt line (audio playing)");
      queuedNonInterruptText = t;
      return;
    }

    if (interrupt) {
      queuedNonInterruptText = null;
    }

    cancelClairaSpeech();
    const myGen = playbackGeneration;
    const ok = await playClairaTtsUtterance(t, myGen);
    if (ok) {
      voiceDbg("speakClairaByMode: playback finished OK");
      return;
    }
    if (myGen !== playbackGeneration) {
      voiceDbg("speakClairaByMode: aborted (superseded)");
      return;
    }
    if (import.meta.env?.DEV) {
      console.warn("[Claira] speakClairaByMode: playback did not complete");
    }
  } catch (e) {
    console.warn("[Claira] speakClairaByMode:", e instanceof Error ? e.message : e);
  }
}

/**
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function speakLiveVoice(text) {
  await speakClaira(text, { interrupt: true });
}

/**
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function speakClairaUtterance(text) {
  await speakClaira(text, { interrupt: true });
}

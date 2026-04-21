/**
 * Permanent local voice assets (pre-generated MP3) + {@link ./voiceAudioController.js} for UI control.
 *
 * - Manifest: `/assets/audio/voice/voice-manifest.json` (see `npm run generate:voice-assets`)
 * - Lookup: SHA-256 of normalized text (must match `dev/generateVoiceAssets.mjs`)
 * - Playback: `HTMLAudioElement` only (or {@link setNativeVoicePlayer} for native shells).
 */

import { attachHtmlVoiceAudio, detachHtmlVoiceAudio, getHtmlVoiceAudio } from "./voiceAudioController.js";

/**
 * Only clear the controller's `htmlAudio` ref if it still points to THIS element.
 * If a newer speakClaira has already attached a different element, leave it alone.
 * @param {HTMLAudioElement} audio
 */
function detachIfCurrent(audio) {
  if (getHtmlVoiceAudio() === audio) detachHtmlVoiceAudio();
}

export {
  getVoiceAudioState,
  subscribeVoiceAudio,
  attachHtmlVoiceAudio,
  detachHtmlVoiceAudio,
  pauseVoiceAudio,
  resumeVoiceAudio,
  replayVoiceUtterance,
  setVoiceOutputMuted,
  toggleVoiceOutputMuted,
  isVoiceOutputMuted,
  stopVoiceAudioHard,
  isVoiceAudioActivelyPlaying,
  getHtmlVoiceAudio,
  lastUtteranceMatchesText,
  getLastUtteranceMeta,
} from "./voiceAudioController.js";

/**
 * @typedef {{
 *   version: number,
 *   basePath?: string,
 *   byTextSha256: Record<string, string>,
 *   lines?: Record<string, unknown>,
 *   elevenLabs?: Record<string, unknown>,
 * }} VoiceManifest
 */

/** @type {VoiceManifest | null} */
let manifestCache = null;

/** @type {((url: string) => Promise<boolean>) | null} */
let nativeVoicePlayer = null;

/**
 * @param {(url: string) => Promise<boolean>} fn — return true when playback finished
 */
export function setNativeVoicePlayer(fn) {
  nativeVoicePlayer = fn;
}

/**
 * @param {string} s
 * @returns {string}
 */
export function normalizeVoiceText(s) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function sha256HexOfVoiceText(text) {
  const n = normalizeVoiceText(text);
  const enc = new TextEncoder().encode(n);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const MANIFEST_URL = "/assets/audio/voice/voice-manifest.json";

/**
 * @returns {Promise<VoiceManifest>}
 */
export async function loadVoiceManifest() {
  if (manifestCache) return manifestCache;
  try {
    const r = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!r.ok) {
      manifestCache = { version: 0, basePath: "/assets/audio/voice", byTextSha256: {}, lines: {} };
      return manifestCache;
    }
    manifestCache = await r.json();
    return manifestCache;
  } catch {
    manifestCache = { version: 0, basePath: "/assets/audio/voice", byTextSha256: {}, lines: {} };
    return manifestCache;
  }
}

/** @param {string} filename */
export function localVoiceAssetUrl(filename) {
  const base = "/assets/audio/voice";
  return `${base}/${encodeURIComponent(filename)}`;
}

/**
 * @param {string} text
 * @returns {Promise<string | null>} mp3 filename or null
 */
export async function resolveLocalVoiceFilename(text) {
  const m = await loadVoiceManifest();
  const h = await sha256HexOfVoiceText(text);
  const fn = m.byTextSha256?.[h];
  return typeof fn === "string" && fn.endsWith(".mp3") ? fn : null;
}

/**
 * Play a pre-baked voice line if present in the manifest.
 * @param {string} text
 * @param {number} myGen
 * @param {() => number} getPlaybackGeneration
 * @returns {Promise<boolean>}
 */
export async function tryPlayLocalVoiceAsset(text, myGen, getPlaybackGeneration) {
  const tRaw = String(text ?? "").trim();
  const filename = await resolveLocalVoiceFilename(tRaw);
  if (!filename) {
    if (import.meta.env?.DEV) {
      const h = await sha256HexOfVoiceText(tRaw);
      console.warn(
        "[Claira] voice: no manifest entry for this text — check hash vs voice-manifest.json (generator uses normalized text).",
        { textSha256: h, textPreview: tRaw.slice(0, 72) + (tRaw.length > 72 ? "…" : "") },
      );
      console.warn("[Claira] voice: falling back to stream TTS (POST /__claira/tts) unless VITE_VOICE_STREAM_FALLBACK=0");
    }
    return false;
  }

  const t = tRaw;
  const isSuperseded = () => myGen !== getPlaybackGeneration();

  if (nativeVoicePlayer) {
    const url = new URL(localVoiceAssetUrl(filename), window.location.origin).href;
    try {
      return await nativeVoicePlayer(url);
    } catch {
      return false;
    }
  }

  const url = localVoiceAssetUrl(filename);
  if (import.meta.env?.DEV) {
    console.log("[Claira] local voice (static URL):", url);
  }
  const audio = new Audio();
  attachHtmlVoiceAudio(audio, { text: t, filename, source: "local" });
  audio.preload = "auto";
  try {
    audio.playsInline = true;
    audio.setAttribute("playsInline", "");
  } catch {
    /* ignore */
  }
  audio.src = url;

  const ok = await new Promise((resolve) => {
    const iv = setInterval(() => {
      if (isSuperseded()) {
        clearInterval(iv);
        try {
          audio.pause();
        } catch {
          /* ignore */
        }
        detachIfCurrent(audio);
        resolve(false);
      }
    }, 80);
    audio.onended = () => {
      clearInterval(iv);
      resolve(true);
    };
    audio.onerror = () => {
      clearInterval(iv);
      detachIfCurrent(audio);
      resolve(false);
    };
    void audio.play().catch(() => {
      clearInterval(iv);
      detachIfCurrent(audio);
      resolve(false);
    });
  });
  return ok && !isSuperseded();
}

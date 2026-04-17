/**
 * Claira TTS — **Edge (Microsoft neural) is the default** for a single consistent voice path.
 *
 * CLAIRA_TTS_PROVIDER:
 * - `edge` (default) — Edge only (no ElevenLabs).
 * - `elevenlabs` — ElevenLabs first; on failure, fall back to Edge (never throws to callers if Edge works).
 * - `auto` — try ElevenLabs when ELEVENLABS_API_KEY is set; on failure, fall back to Edge.
 *
 * Service bootstrap: `initClairaTtsService()` — idempotent, non-blocking, safe if imports fail.
 */

import { synthesizeClairaSpeechEdge } from "./clairaEdgeTtsVoice.mjs";
import {
  getResolvedElevenLabsVoiceId,
  synthesizeClairaSpeech as synthesizeClairaSpeechElevenLabs,
} from "./clairaElevenLabsVoice.mjs";

/** @type {Promise<void> | null} */
let ttsServiceInitPromise = null;

function providerMode() {
  return (process.env.CLAIRA_TTS_PROVIDER ?? "edge").trim().toLowerCase();
}

function hasElevenLabsKey() {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

/**
 * One-time TTS subsystem load + dev log. Safe to call multiple times; never throws to caller.
 * @returns {Promise<void>}
 */
export function initClairaTtsService() {
  if (ttsServiceInitPromise) return ttsServiceInitPromise;
  ttsServiceInitPromise = (async () => {
    try {
      void synthesizeClairaSpeechEdge;
      void synthesizeClairaSpeechElevenLabs;
      const mode = providerMode();
      if (process.env.NODE_ENV !== "production") {
        console.log("[Claira TTS] service initialized", {
          provider: mode,
          elevenLabsConfigured: hasElevenLabsKey(),
          elevenLabsVoiceId: getResolvedElevenLabsVoiceId(),
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[Claira TTS] service init (non-fatal):", msg);
    }
  })();
  return ttsServiceInitPromise;
}

/**
 * Non-secret snapshot for `/__claira/tts/status` and debugging.
 * @returns {Record<string, unknown>}
 */
export function getClairaTtsRuntimeSummary() {
  return {
    provider: providerMode(),
    elevenLabsConfigured: hasElevenLabsKey(),
    elevenLabsVoiceId: getResolvedElevenLabsVoiceId(),
    edgeVoice: (process.env.CLAIRA_EDGE_TTS_VOICE ?? "").trim() || "(default)",
    modelId: (process.env.ELEVENLABS_MODEL_ID ?? "").trim() || "eleven_turbo_v2_5",
  };
}

/**
 * @param {string} text
 * @param {unknown} err
 */
function warnElevenLabsFallback(text, err) {
  void text;
  const msg = err instanceof Error ? err.message : String(err);
  console.warn("[Claira TTS] ElevenLabs failed; using Edge TTS fallback.", msg.slice(0, 200));
}

/**
 * @param {string} text
 * @returns {Promise<import("node:buffer").Buffer>}
 */
export async function synthesizeClairaSpeech(text) {
  const mode = providerMode();

  if (mode === "edge") {
    return synthesizeClairaSpeechEdge(text);
  }

  if (mode === "elevenlabs") {
    if (!hasElevenLabsKey()) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[Claira TTS] elevenlabs mode but no ELEVENLABS_API_KEY — using Edge TTS");
      }
      return synthesizeClairaSpeechEdge(text);
    }
    try {
      return await synthesizeClairaSpeechElevenLabs(text);
    } catch (err) {
      warnElevenLabsFallback(text, err);
      return synthesizeClairaSpeechEdge(text);
    }
  }

  // auto
  if (!hasElevenLabsKey()) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[Claira TTS] auto: no ELEVENLABS_API_KEY — using Edge TTS");
    }
    return synthesizeClairaSpeechEdge(text);
  }

  try {
    return await synthesizeClairaSpeechElevenLabs(text);
  } catch (err) {
    warnElevenLabsFallback(text, err);
    return synthesizeClairaSpeechEdge(text);
  }
}

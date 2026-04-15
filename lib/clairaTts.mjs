/**
 * Claira TTS — **Edge (Microsoft neural) is the default** for a single consistent voice path.
 *
 * CLAIRA_TTS_PROVIDER:
 * - `edge` (default) — Edge only (no ElevenLabs).
 * - `elevenlabs` — ElevenLabs only (paid / quota; optional).
 * - `auto` — try ElevenLabs when ELEVENLABS_API_KEY is set; on failure, fall back to Edge.
 */

import { synthesizeClairaSpeechEdge } from "./clairaEdgeTtsVoice.mjs";

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function shouldFallbackFromElevenLabsError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/CLAIRA_TTS_QUOTA_EXCEEDED/i.test(msg)) return true;
  if (/quota_exceeded/i.test(msg)) return true;
  if (/model_deprecated_free_tier/i.test(msg)) return true;
  if (/subscription_required/i.test(msg)) return true;
  if (/removed from the free tier/i.test(msg)) return true;
  if (/exceeds your quota/i.test(msg)) return true;
  if (/credits remaining/i.test(msg)) return true;
  if (/\(\s*402\s*\)/.test(msg)) return true;
  if (/\(\s*429\s*\)/.test(msg)) return true;
  if (/exceed.*(quota|limit|characters)/i.test(msg)) return true;
  if (/insufficient/i.test(msg)) return true;
  return false;
}

function providerMode() {
  return (process.env.CLAIRA_TTS_PROVIDER ?? "edge").trim().toLowerCase();
}

function hasElevenLabsKey() {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

/**
 * @param {string} text
 * @returns {Promise<Buffer>} MP3
 */
export async function synthesizeClairaSpeech(text) {
  const mode = providerMode();

  if (mode === "edge") {
    return synthesizeClairaSpeechEdge(text);
  }

  if (mode === "elevenlabs") {
    const { synthesizeClairaSpeech: el } = await import("./clairaElevenLabsVoice.mjs");
    return el(text);
  }

  // auto
  if (!hasElevenLabsKey()) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[Claira TTS] auto: no ELEVENLABS_API_KEY — using Edge TTS");
    }
    return synthesizeClairaSpeechEdge(text);
  }

  const { synthesizeClairaSpeech: el } = await import("./clairaElevenLabsVoice.mjs");
  try {
    return await el(text);
  } catch (err) {
    if (!shouldFallbackFromElevenLabsError(err)) {
      throw err;
    }
    console.warn("[Claira TTS] ElevenLabs unavailable (quota or limit); using Edge TTS fallback.");
    return synthesizeClairaSpeechEdge(text);
  }
}

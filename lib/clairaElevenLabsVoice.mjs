/**
 * Claira × ElevenLabs TTS (Node / server-side).
 *
 * Default model is `eleven_turbo_v2_5` (free tier as of 2026; v1 monolingual models were removed).
 * Override with `ELEVENLABS_MODEL_ID` if needed.
 *
 * Load env: Node 20+ → `node --env-file=.env server/index.js`
 */

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

/** Claira voice — all TTS requests use this ID (not overridable via env). */
export const CLAIRA_ELEVENLABS_VOICE_ID = "g7LVvkPWALzPxOQbF6OE";

/** @deprecated Use {@link CLAIRA_ELEVENLABS_VOICE_ID}. Kept for any external imports. */
export const ELEVENLABS_PREMADE_SARAH_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

/**
 * @returns {string} Always {@link CLAIRA_ELEVENLABS_VOICE_ID} for TTS.
 */
export function resolveClairaVoiceId(_explicitVoiceId) {
  return CLAIRA_ELEVENLABS_VOICE_ID;
}

/** @returns {string} */
function resolveElevenLabsModelId() {
  const fromEnv = typeof process !== "undefined" ? process.env.ELEVENLABS_MODEL_ID?.trim() : "";
  return fromEnv || "eleven_turbo_v2_5";
}

/** Model and voice_settings sent on every request. */
export const CLAIRA_VOICE_SETTINGS = {
  get modelId() {
    return resolveElevenLabsModelId();
  },
  stability: 0.5,
  similarityBoost: 0.75,
};

/**
 * @returns {string}
 */
export function getElevenLabsApiKey() {
  const key = typeof process !== "undefined" ? process.env.ELEVENLABS_API_KEY?.trim() : "";
  if (!key) {
    throw new Error(
      "Missing ELEVENLABS_API_KEY. Add it to `.env` and run the server with `node --env-file=.env …` (Node 20+).",
    );
  }
  return key;
}

/**
 * @param {unknown} bodyText
 * @returns {boolean}
 */
export function responseIndicatesQuotaIssue(bodyText) {
  const s = String(bodyText ?? "");
  if (/quota_exceeded/i.test(s)) return true;
  if (/exceeds your quota/i.test(s)) return true;
  if (/credits remaining/i.test(s)) return true;
  if (/character.*limit/i.test(s)) return true;
  if (/model_deprecated_free_tier/i.test(s)) return true;
  if (/subscription_required/i.test(s)) return true;
  if (/removed from the free tier/i.test(s)) return true;
  if (/eleven_monolingual_v1|eleven_multilingual_v1/i.test(s) && /deprecated|free tier/i.test(s)) {
    return true;
  }
  try {
    const j = JSON.parse(s);
    const blob = JSON.stringify(j);
    return (
      /quota_exceeded/i.test(blob) ||
      /exceeds your quota/i.test(blob) ||
      /credits remaining/i.test(blob) ||
      /model_deprecated_free_tier/i.test(blob) ||
      /subscription_required/i.test(blob)
    );
  } catch {
    return false;
  }
}

/**
 * @param {string} text
 * @param {object} [options] — ignored for voice/model; kept for API compatibility.
 * @returns {Promise<Buffer>} MP3 audio bytes
 */
export async function synthesizeClairaSpeech(text, options = {}) {
  void options;
  const apiKey = getElevenLabsApiKey();
  const voiceId = CLAIRA_ELEVENLABS_VOICE_ID;
  const modelId = CLAIRA_VOICE_SETTINGS.modelId;
  const stability = CLAIRA_VOICE_SETTINGS.stability;
  const similarityBoost = CLAIRA_VOICE_SETTINGS.similarityBoost;

  if (process.env.NODE_ENV !== "production") {
    console.log("[Claira] voice_id:", voiceId);
    console.log("[Claira] model_id:", modelId);
  }

  const payload = {
    text: String(text ?? ""),
    model_id: modelId,
    voice_settings: {
      stability,
      similarity_boost: similarityBoost,
    },
  };

  const url = `${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      Accept: "audio/mpeg",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text();
    if (responseIndicatesQuotaIssue(detail)) {
      console.error(
        "[Claira] ElevenLabs blocked (quota, plan, or deprecated model) — Edge fallback or fix ELEVENLABS_MODEL_ID",
      );
      throw new Error(
        `CLAIRA_TTS_QUOTA_EXCEEDED ElevenLabs TTS failed (${res.status}): ${detail.slice(0, 800)}`,
      );
    }
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${detail.slice(0, 800)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

/**
 * @param {string} text
 * @param {object} [options]
 * @returns {Promise<Buffer>}
 */
export async function speakClaira(text, options) {
  return synthesizeClairaSpeech(text, options);
}

/**
 * Claira × ElevenLabs TTS (Node / server-side).
 *
 * All synthesis uses a fixed Claira voice and `eleven_monolingual_v1` to match product expectations
 * and avoid premium models that burn quota.
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

/** Model and voice_settings sent on every request (no premium / v2 / v3 models). */
export const CLAIRA_VOICE_SETTINGS = {
  modelId: "eleven_monolingual_v1",
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
function responseIndicatesQuotaIssue(bodyText) {
  const s = String(bodyText ?? "");
  if (/quota_exceeded/i.test(s)) return true;
  try {
    const j = JSON.parse(s);
    const blob = JSON.stringify(j);
    return /quota_exceeded/i.test(blob);
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
      console.error("[Claira] ElevenLabs quota issue — likely wrong model or voice");
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

/**
 * Claira × Microsoft Edge online TTS (via node-edge-tts).
 *
 * No API key. Uses the same neural voices as Edge “Read aloud.” Not identical to any
 * ElevenLabs voice — closest free option when quota is exhausted.
 *
 * @see https://learn.microsoft.com/azure/ai-services/speech-service/language-support */

import { randomBytes } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EdgeTTS } from "node-edge-tts";

/** Young US English neural voice; override with CLAIRA_EDGE_TTS_VOICE */
export const CLAIRA_EDGE_DEFAULT_VOICE = "en-US-JennyNeural";

function edgeVoiceId() {
  return (process.env.CLAIRA_EDGE_TTS_VOICE ?? CLAIRA_EDGE_DEFAULT_VOICE).trim() || CLAIRA_EDGE_DEFAULT_VOICE;
}

function edgeTimeoutMs() {
  const n = Number(process.env.CLAIRA_EDGE_TTS_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

/**
 * @param {string} text
 * @returns {Promise<Buffer>} MP3 audio bytes
 */
export async function synthesizeClairaSpeechEdge(text) {
  const t = String(text ?? "");
  if (!t.trim()) {
    throw new Error("Edge TTS: empty text");
  }

  const tmpPath = join(tmpdir(), `claira-edge-tts-${randomBytes(12).toString("hex")}.mp3`);
  const tts = new EdgeTTS({
    voice: edgeVoiceId(),
    lang: "en-US",
    outputFormat: "audio-24khz-96kbitrate-mono-mp3",
    timeout: edgeTimeoutMs(),
  });

  try {
    await tts.ttsPromise(t, tmpPath);
    return await readFile(tmpPath);
  } finally {
    try {
      await unlink(tmpPath);
    } catch {
      /* ignore */
    }
  }
}

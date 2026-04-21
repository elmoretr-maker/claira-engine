/**
 * Play a pre-baked warning/key clip using the isolated inline audio path.
 * Does NOT use speakClaira or voiceAudioController.
 * Stops any current narration + inline audio before playing.
 * Fire-and-forget (no await needed at call sites).
 */

import { CLAIRA_INLINE_VOICE_KEYS } from "./clairaInlineVoiceKeys.js";
import { resolveLocalVoiceFilename, localVoiceAssetUrl } from "./localVoicePlayback.js";
import { playInlineAudio } from "./inlineAudio.js";

/**
 * @param {keyof typeof CLAIRA_INLINE_VOICE_KEYS} key
 * @returns {Promise<void>}
 */
export async function speakVoiceKey(key) {
  const text = CLAIRA_INLINE_VOICE_KEYS[key];
  if (!text) return;
  const filename = await resolveLocalVoiceFilename(text);
  if (!filename) return;
  playInlineAudio(localVoiceAssetUrl(filename));
}

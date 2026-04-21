#!/usr/bin/env node
/**
 * Pre-generate onboarding (and future) voice lines as MP3 + voice-manifest.json.
 * Uses ElevenLabs with the same voice_settings as lib/clairaElevenLabsVoice.mjs (accepted sound).
 *
 * Run: npm run generate:voice-assets
 * Requires: ELEVENLABS_API_KEY in .env (same as server)
 * Skip existing files unless --force
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CLAIRA_VOICE_STEPS } from "../ui/voice/clairaVoiceSteps.js";
import { CLAIRA_INLINE_VOICE_KEYS } from "../ui/voice/clairaInlineVoiceKeys.js";
import {
  getResolvedElevenLabsVoiceId,
  synthesizeClairaSpeech,
  CLAIRA_VOICE_SETTINGS,
} from "../lib/clairaElevenLabsVoice.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "ui", "public", "assets", "audio", "voice");

/**
 * @param {string} s
 */
function normalizeVoiceText(s) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * @param {string} text
 */
function sha256Hex(text) {
  return createHash("sha256").update(normalizeVoiceText(text), "utf8").digest("hex");
}

const force = process.argv.includes("--force");

async function main() {
  await mkdir(outDir, { recursive: true });

  /** @type {Record<string, { textPreview: string, file: string, textSha256: string }>} */
  const lines = {};
  /** @type {Record<string, string>} */
  const byTextSha256 = {};

  /** @param {string} id @param {string} text */
  async function generateEntry(id, text) {
    const file = `${id}.mp3`;
    const outPath = path.join(outDir, file);
    const h = sha256Hex(text);
    lines[id] = {
      textPreview: text.slice(0, 160) + (text.length > 160 ? "…" : ""),
      file,
      textSha256: h,
    };
    byTextSha256[h] = file;

    if (!force) {
      try {
        await access(outPath, constants.F_OK);
        console.log("skip (exists):", file);
        return;
      } catch {
        /* generate */
      }
    }
    console.log("generate:", id, "chars=", text.length);
    const buf = await synthesizeClairaSpeech(text);
    await writeFile(outPath, buf);
  }

  for (const [stepKey, text] of Object.entries(CLAIRA_VOICE_STEPS)) {
    await generateEntry(`onboarding_step_${stepKey}`, text);
  }

  for (const [key, text] of Object.entries(CLAIRA_INLINE_VOICE_KEYS)) {
    await generateEntry(`inline_${key}`, text);
  }

  const manifest = {
    version: 1,
    basePath: "/assets/audio/voice",
    generator: "dev/generateVoiceAssets.mjs",
    generatedAt: new Date().toISOString(),
    elevenLabs: {
      voiceId: getResolvedElevenLabsVoiceId(),
      modelId: CLAIRA_VOICE_SETTINGS.modelId,
      stability: CLAIRA_VOICE_SETTINGS.stability,
      similarityBoost: CLAIRA_VOICE_SETTINGS.similarityBoost,
    },
    lines,
    byTextSha256,
  };

  const manifestPath = path.join(outDir, "voice-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log("wrote", path.relative(root, manifestPath));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

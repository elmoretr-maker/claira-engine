/**
 * Onboarding voice lines. Step 1 = Welcome (first screen); step 0 = choose category (after Welcome); 2–9 = rest of setup.
 */

import { ONBOARDING_TOTAL_STEPS } from "../onboarding/onboardingFlowMeta.js";

/** @type {Record<number, string>} */
export const CLAIRA_VOICE_STEPS = {
  0: "Choose a category from the list, or make a new one on the right. Press Continue when you’re ready to load it.",
  1: "I’m ready to help you get everything set up. When you’re ready, click Start.",
  2: "Now choose what you want me to manage. You can keep it simple to start.",
  3: "Before we add your items, I want to understand how your items are structured so I can organize them correctly.",
  4: "These examples help me learn how your items should be organized. Just add a few so I know what to look for.",
  5: "Add your files, then start when you’re ready.",
  6: "Here’s what I found. Take a quick look and make sure everything looks right before you continue.",
  7: "I need your help with a few items. Just tell me where these belong.",
  8: "I’m organizing your items now. This should only take a moment.",
  9: "You’re all set. You can manage everything from here.",
};

/** @deprecated Use {@link CLAIRA_VOICE_STEPS}[0] / step 0 via OnboardingVoiceSync. */
export const PACK_ENTRY_VOICE = CLAIRA_VOICE_STEPS[0];

/**
 * @param {number} step
 * @returns {string | undefined}
 */
export function getVoiceScriptForStep(step) {
  const n = Math.floor(Number(step));
  if (n === 0) return CLAIRA_VOICE_STEPS[0];
  if (!Number.isFinite(n) || n < 1 || n > ONBOARDING_TOTAL_STEPS) return undefined;
  return CLAIRA_VOICE_STEPS[n];
}

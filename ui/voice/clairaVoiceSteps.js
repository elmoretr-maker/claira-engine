/**
 * Onboarding voice lines. Step 0 = Welcome; step 1 = Industry/category; 2–9 = post-gate setup.
 * UI flow: welcome screen first, then category; those screens map to voice steps 0 and 1 via deriveOnboardingVoiceStep.
 */

import { ONBOARDING_TOTAL_STEPS } from "../onboarding/onboardingFlowMeta.js";

/** @type {Record<number, string>} */
export const CLAIRA_VOICE_STEPS = {
  0: "Welcome!.. Hi, I’m Claira. I’m your Classification, Learning, and Intelligent Resource Assistant. I help you take what you’re working with… and turn it into something clear, structured, and easy to manage. ..Whether that’s your business, your clients, or your day-to-day operations. For example.. I can organize your products, track your clients, or keep your inventory and workflows structured and under control. My job is to take complexity off your plate… and turn it into clarity you can actually use. So you always know where things are… what’s happening… and what comes next. Hit the start button to begin.",
  1: "On this page, select the industry category you want me to assist you with, or create one specific to your needs. Press Continue when you’re ready to load it, or click on Build Industry Pack if you want me to create a package specific to your unique needs. Don’t forget to write an industry name so I can research it before you click Build Industry Pack.",
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

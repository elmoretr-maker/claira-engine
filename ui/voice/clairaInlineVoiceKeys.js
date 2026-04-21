/**
 * Stable key → text mapping for inline (click-to-hear) voice buttons on setup pages.
 * Keys are arbitrary identifiers; values are the exact text that gets hashed and
 * matched against voice-manifest.json at playback time.
 *
 * To add a new entry: add a key/text pair here, then re-run:
 *   npm run generate:voice-assets
 */

/** @type {Record<string, string>} */
export const CLAIRA_INLINE_VOICE_KEYS = {
  industry_existing_intro:
    "This path is for when you already have a category you trust—something you or your team set up earlier and want to keep using. I'll load it so the way I sort, label, and think about your items matches that world, without you rebuilding everything from scratch. You keep consistency, save time, and avoid the small mismatches that show up when every tool invents its own system. You stay in charge—I'm aligning with what you chose, not replacing your judgment. Pick what fits what you're doing now, then press Continue when you want me to bring it in.",

  industry_create_intro:
    "If you don't have a category yet—or you want a fresh one shaped around what you do—we'll build one from the name you give, after you confirm which workflow modules you want. When your description doesn't match clear signals, we'll ask a short set of questions—nothing is assumed or auto-selected without you. You get a real starting point you can refine anytime, instead of staring at a blank page. First check that we're online, then describe what you're aiming for. You'll review modules, adjust the selection, and confirm before any build runs. Think of me as your launchpad—not as legal, medical, or compliance advice, where your own experts still need the final say.",

  capability_intro:
    "I've grouped what your pack can handle—tick the areas you want me to help with. Open a group anytime to see the exact categories I'll watch.",

  structure_setup_intro:
    "This is only to set expectations in the UI—it doesn't change how the engine runs. Answer in whatever way feels closest; you can always adjust later.",

  workflow_hub_intro:
    "Choose a workflow to open. Your industry pack updates when you pick one from a different pack so processing stays in sync.",

  warning_start_over:
    "Warning: starting over will reset your entire setup. All onboarding progress and category settings will be cleared.",

  warning_delete_rule:
    "You are about to permanently delete this rule. This cannot be undone.",
};

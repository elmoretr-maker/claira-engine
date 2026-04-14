/** Guided onboarding: step indices for the setup journey. `packPick` is category/pack selection (voice + chrome only). */

export const ONBOARDING_TOTAL_STEPS = 9;

/** Task-based progress groups shown in the UI (internal steps 1–9 map here). */
export const ONBOARDING_TASK_PHASE_TOTAL = 4;

export const ONBOARDING_STEP = {
  /** First screen: choose or create category / pack (shown as Setup · Step 1 of 4). */
  packPick: 0,
  welcome: 1,
  capabilities: 2,
  structure: 3,
  tunnel: 4,
  upload: 5,
  /** Report / “here’s what I found” */
  review: 6,
  /** Waiting room / conflict resolution */
  learning: 7,
  /** Processing pipeline screen */
  processing: 8,
  complete: 9,
};

/**
 * Maps internal guided step (1–9) to a task phase for display only.
 *
 * @param {number} internalStep
 * @returns {{ taskIndex: number, taskTotal: number, taskLabel: string }}
 */
export function getGuidedTaskProgress(internalStep) {
  const n = Math.floor(Number(internalStep));
  const T = ONBOARDING_TASK_PHASE_TOTAL;
  if (!Number.isFinite(n) || n < 1) {
    /* Step 0 (packPick): same “Setup ·1 of 4” bucket as welcome + capabilities. */
    return { taskIndex: 1, taskTotal: T, taskLabel: "Setup" };
  }
  if (n <= 2) return { taskIndex: 1, taskTotal: T, taskLabel: "Setup" };
  if (n <= 4) return { taskIndex: 2, taskTotal: T, taskLabel: "Structure" };
  if (n === 5 || n === 8) return { taskIndex: 3, taskTotal: T, taskLabel: "Add Items" };
  if (n === 6 || n === 7 || n === 9) return { taskIndex: 4, taskTotal: T, taskLabel: "Review" };
  return { taskIndex: 1, taskTotal: T, taskLabel: "Setup" };
}

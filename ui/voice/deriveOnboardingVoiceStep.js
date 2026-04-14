/**
 * @param {{
 *   industryGateDone: boolean,
 *   preAppPhase: "packEntry" | "welcome",
 *   screen: string,
 * }} p
 * @param {{ replayForRooms?: boolean }} opts
 * @returns {number | null}
 */
function resolveVoiceStepForShell(p, opts = {}) {
  const replayForRooms = opts.replayForRooms === true;
  if (!p.industryGateDone) {
    if (p.preAppPhase === "welcome") return 1;
    if (p.preAppPhase === "packEntry") return 0;
    return null;
  }
  switch (p.screen) {
    case "capabilities":
      return 2;
    case "structure":
      return 3;
    case "tunnel":
      return 4;
    case "entrance":
      return 5;
    case "report":
      return 6;
    case "waiting":
      return 7;
    case "processing":
      return 8;
    case "workspace":
      return 9;
    case "rooms":
      return replayForRooms ? 6 : null;
    default:
      return null;
  }
}

/**
 * Maps app navigation state to onboarding voice step (1–9), or null when no auto-play line applies.
 *
 * @param {{
 *   industryGateDone: boolean,
 *   preAppPhase: "packEntry" | "welcome",
 *   screen: string,
 * }} p
 * @returns {number | null}
 */
export function deriveOnboardingVoiceStep(p) {
  return resolveVoiceStepForShell(p, { replayForRooms: false });
}

/**
 * @param {{
 *   industryGateDone: boolean,
 *   preAppPhase: "packEntry" | "welcome",
 *   screen: string,
 * }} p
 * @returns {number | null}
 */
export function deriveVoiceReplayStep(p) {
  return resolveVoiceStepForShell(p, { replayForRooms: true });
}

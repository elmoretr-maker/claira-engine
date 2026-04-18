/**
 * Deterministic timer descriptor — no wall clock (no Date.now in output math).
 */

import { assertCapabilityModule } from "./capabilityContract.js";

export const timerModule = {
  id: "timer",
  name: "Timer",
  description: "Structured countdown parameters from duration (deterministic; no live clock).",
  supportedIntents: ["timer", "countdown", "duration", "schedule", "alarm", "wait"],

  /**
   * @param {Record<string, unknown>} input
   */
  run(input) {
    const raw = input.durationMs ?? input.duration ?? 60_000;
    const durationMs =
      typeof raw === "number" && Number.isFinite(raw) && raw > 0
        ? Math.min(86_400_000, Math.floor(raw))
        : 60_000;
    return {
      durationMs,
      tickCount: 10,
      tickIntervalMs: Number((durationMs / 10).toFixed(0)),
      phase: "configured",
      summary: `Timer span ${durationMs} ms (dry-run schedule; no wall clock).`,
    };
  },
};

assertCapabilityModule(timerModule, "timerModule");

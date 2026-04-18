/**
 * Build image comparison pairs from ordered timeline stages (no I/O).
 * @param {"sequential" | "baseline"} mode
 * @param {string[]} orderedStages
 * @param {Record<string, string>} pathsByStage stage folder name → image path
 * @returns {{ ok: true, pairs: { stageA: string, stageB: string, pathA: string, pathB: string }[] } | { ok: false, error: string }}
 */
export function buildFitnessImagePairs(mode, orderedStages, pathsByStage) {
  if (mode !== "sequential" && mode !== "baseline") {
    return { ok: false, error: `buildFitnessImagePairs: invalid mode ${mode}` };
  }
  const stages = orderedStages.map((s) => String(s ?? "").trim()).filter(Boolean);
  if (stages.length < 2) {
    return { ok: false, error: "At least two ordered stages are required for multi-compare." };
  }
  const paths = pathsByStage && typeof pathsByStage === "object" && !Array.isArray(pathsByStage) ? pathsByStage : {};

  /** @type {{ stageA: string, stageB: string, pathA: string, pathB: string }[]} */
  const pairs = [];

  if (mode === "sequential") {
    for (let i = 0; i < stages.length - 1; i++) {
      const stageA = stages[i];
      const stageB = stages[i + 1];
      const pathA = String(paths[stageA] ?? "").trim();
      const pathB = String(paths[stageB] ?? "").trim();
      if (!pathA || !pathB) {
        return {
          ok: false,
          error: `Missing image path for stage "${!pathA ? stageA : stageB}" (sequential ${stageA} → ${stageB}).`,
        };
      }
      if (pathA === pathB) {
        return { ok: false, error: `Identical paths for stages ${stageA} and ${stageB}.` };
      }
      pairs.push({ stageA, stageB, pathA, pathB });
    }
  } else {
    const base = stages[0];
    const pathBase = String(paths[base] ?? "").trim();
    if (!pathBase) {
      return { ok: false, error: `Missing image path for baseline stage "${base}".` };
    }
    for (let i = 1; i < stages.length; i++) {
      const stageB = stages[i];
      const pathB = String(paths[stageB] ?? "").trim();
      if (!pathB) {
        return { ok: false, error: `Missing image path for stage "${stageB}" (baseline vs ${base}).` };
      }
      if (pathBase === pathB) {
        return { ok: false, error: `Identical paths for baseline ${base} and ${stageB}.` };
      }
      pairs.push({ stageA: base, stageB, pathA: pathBase, pathB });
    }
  }

  if (!pairs.length) {
    return { ok: false, error: "No comparison pairs could be built." };
  }
  return { ok: true, pairs };
}

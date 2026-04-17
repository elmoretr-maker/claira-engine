/**
 * Warn if build output paths (dist/, build/) are tracked by git — they should stay generated, not committed.
 * Run: node dev/checkBuildArtifacts.mjs
 */
import { execSync } from "node:child_process";

function listTrackedFiles() {
  try {
    return execSync("git ls-files", { encoding: "utf8", cwd: new URL("..", import.meta.url) })
      .split("\n")
      .filter(Boolean);
  } catch {
    console.warn("WARNING: could not run git ls-files — is this a git repository?");
    return [];
  }
}

/** @param {string} p */
function looksLikeBuildArtifact(p) {
  return /(^|\/)dist\//.test(p) || /(^|\/)build\//.test(p);
}

const tracked = listTrackedFiles();
const bad = tracked.filter(looksLikeBuildArtifact);

if (bad.length > 0) {
  console.warn(`WARNING: build artifacts detected in git tracking: ${bad.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("ok: no dist/ or build/ paths in git tracking");
}

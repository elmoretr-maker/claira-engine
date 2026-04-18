/**
 * Scan one `Projects/{name}/Rooms/.../Timeline/...` tree (shared with contractor timeline API).
 */

import { existsSync, readdirSync } from "fs";
import { basename, join, relative } from "path";
import { orderFitnessStages } from "./fitnessTimelineOrder.js";

const FITNESS_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

/**
 * @param {string} cwd workspace root
 * @param {string} projectBaseAbs absolute path to `Projects/{projectFolder}`
 * @returns {{ name: string, rooms: Array<{ name: string, stages: Array<{ name: string, images: Array<{ path: string, relPath: string, basename: string }> }>, orderedStages: string[] }> }}
 */
export function scanContractorProjectFolder(cwd, projectBaseAbs) {
  const projectName = basename(projectBaseAbs);
  const roomsDir = join(projectBaseAbs, "Rooms");
  const receiptsDir = join(projectBaseAbs, "Receipts");
  /** @type {Array<{ name: string, stages: Array<{ name: string, images: Array<{ path: string, relPath: string, basename: string }> }>, orderedStages: string[] }>} */
  const rooms = [];
  if (existsSync(roomsDir)) {
    for (const rEnt of readdirSync(roomsDir, { withFileTypes: true })) {
      if (!rEnt.isDirectory()) continue;
      const roomName = rEnt.name;
      const timelineDir = join(roomsDir, roomName, "Timeline");
      if (!existsSync(timelineDir)) continue;
      /** @type {Array<{ name: string, images: Array<{ path: string, relPath: string, basename: string }> }>} */
      const stages = [];
      for (const sEnt of readdirSync(timelineDir, { withFileTypes: true })) {
        if (!sEnt.isDirectory()) continue;
        const stageName = sEnt.name;
        const stageDir = join(timelineDir, stageName);
        /** @type {Array<{ path: string, relPath: string, basename: string }>} */
        const images = [];
        for (const f of readdirSync(stageDir, { withFileTypes: true })) {
          if (!f.isFile()) continue;
          const lower = f.name.toLowerCase();
          const dot = lower.lastIndexOf(".");
          const ext = dot >= 0 ? lower.slice(dot) : "";
          if (!FITNESS_IMAGE_EXT.has(ext)) continue;
          const absPath = join(stageDir, f.name);
          const relPath = relative(cwd, absPath);
          images.push({ path: absPath, relPath, basename: f.name });
        }
        images.sort((a, b) => a.basename.localeCompare(b.basename));
        stages.push({ name: stageName, images });
      }
      const orderedStages = orderFitnessStages(stages);
      const orderedStageNames = orderedStages.map((s) => s.name);
      if (orderedStages.length) rooms.push({ name: roomName, stages: orderedStages, orderedStages: orderedStageNames });
    }
    rooms.sort((a, b) => a.name.localeCompare(b.name));
  }
  if (rooms.length > 0 || existsSync(receiptsDir)) {
    return { name: projectName, rooms };
  }
  return { name: projectName, rooms: [] };
}

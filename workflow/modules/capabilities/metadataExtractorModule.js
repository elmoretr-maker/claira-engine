/**
 * Image metadata via sharp (read-only).
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { assertCapabilityModule } from "./capabilityContract.js";
import { getCachedImageMetadata } from "./capabilitySessionCache.js";

export const metadataExtractorModule = {
  id: "metadata_extractor",
  name: "Metadata extractor",
  description: "Width, height, format, size, EXIF subset via sharp.metadata (read-only).",
  supportedIntents: ["metadata", "exif", "dimensions", "format", "properties", "image info", "file info"],

  /**
   * @param {Record<string, unknown>} input
   * @param {import("./capabilityContract.js").CapabilityRunContext} context
   */
  async run(input, context) {
    const cwd = String(input.cwd ?? context.inputData?.cwd ?? process.cwd());
    const p = String(
      input.primaryFile ?? input.sourcePath ?? context.inputData?.primaryFile ?? context.inputData?.sourcePath ?? "",
    ).trim();
    const abs = p ? (path.isAbsolute(p) ? p : path.resolve(cwd, p)) : "";
    if (!abs || !fs.existsSync(abs)) {
      return {
        width: null,
        height: null,
        format: null,
        sizeBytes: null,
        exif: null,
        summary: "No readable primaryFile / sourcePath for this row.",
      };
    }
    const st = fs.statSync(abs);
    const meta = await getCachedImageMetadata(abs, () => sharp(abs).metadata());
    const fmt = meta.format ?? null;
    const w = meta.width ?? null;
    const h = meta.height ?? null;
    const exif = meta.exif
      ? {
          hasExif: true,
          orientation: meta.orientation ?? null,
        }
      : { hasExif: false };

    return {
      width: w,
      height: h,
      format: fmt,
      sizeBytes: st.size,
      exif,
      summary: `${fmt ?? "?"} ${w ?? "?"}×${h ?? "?"} · ${st.size} bytes`,
    };
  },
};

assertCapabilityModule(metadataExtractorModule, "metadataExtractorModule");

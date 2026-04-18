/**
 * Maps technical API / validation messages to actionable copy for capability UIs.
 * Each mapping includes `type`: input (user choices), validation (rules/payload/data), or system (environment/server).
 */

/**
 * @typedef {"validation" | "input" | "system"} UserFacingErrorType
 */

/**
 * @typedef {{ message: string, actionHint?: string, type: UserFacingErrorType }} UserFacingError
 */

/**
 * @param {unknown} raw
 * @param {UserFacingError} result
 */
function devLogUserFacingError(raw, result) {
  /* eslint-disable-next-line no-undef -- NODE_ENV is defined by Vite/Node in dev; omitted in browser without polyfill */
  if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
    try {
      const type = result.type ?? "(none)";
      const message = result.message;
      const actionHint = result.actionHint ?? "(none)";
      console.group("[UserFacingError]");
      console.warn("Type:", type);
      console.warn("Message:", message);
      console.warn("Action Hint:", actionHint);
      console.warn("Raw:", raw);
      console.groupEnd();
    } catch (_e) {
      /* fail silently */
    }
  }
}

/**
 * @param {unknown} raw
 * @param {{ fallback?: string, fallbackHint?: string, type?: UserFacingErrorType }} [opts]
 * @returns {UserFacingError}
 */
export function userFacingError(raw, opts = {}) {
  const fallback = opts.fallback ?? "Something went wrong. Please try again.";
  const fallbackHint = opts.fallbackHint;
  const fallbackType = opts.type ?? "system";

  /** @type {UserFacingError} */
  let out;

  if (raw === null || raw === undefined) {
    out = hintOrPlain(fallback, fallbackHint, fallbackType);
  } else {
    const s = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw);
    const t = s.trim();
    if (!t) {
      out = hintOrPlain(fallback, fallbackHint, fallbackType);
    } else {
      const exact = USER_FACING_EXACT[t];
      if (exact) {
        out = { ...exact };
      } else {
        /** @type {UserFacingError | undefined} */
        let fromPattern;
        for (const row of USER_FACING_PATTERNS) {
          if (row.test(t)) {
            fromPattern = {
              message: row.message,
              type: row.type,
              ...(row.actionHint ? { actionHint: row.actionHint } : {}),
            };
            break;
          }
        }
        out = fromPattern ?? { message: t, type: inferUnmappedType(t, opts.type) };
      }
    }
  }

  devLogUserFacingError(raw, out);
  return out;
}

/**
 * @param {string} message
 * @param {string} [hint]
 * @param {UserFacingErrorType} [type]
 * @returns {UserFacingError}
 */
function hintOrPlain(message, hint, type = "system") {
  return hint ? { message, actionHint: hint, type } : { message, type };
}

/**
 * @param {string} message
 * @param {UserFacingErrorType | undefined} optsType
 * @returns {UserFacingErrorType}
 */
function inferUnmappedType(message, optsType) {
  if (optsType) return optsType;
  const u = message.toUpperCase();
  if (
    /ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|NETWORK|FETCH|502|503|504|INTERNAL SERVER|UNEXPECTED TOKEN|SYNTAXERROR|FAILED TO FETCH/i.test(
      u,
    )
  ) {
    return "system";
  }
  if (/MUST BE A STRING WHEN PROVIDED|MUST BE AN ARRAY|MUST BE A PLAIN OBJECT|MUST BE AN OBJECT|TYPEERROR/i.test(u)) {
    return "validation";
  }
  return "system";
}

/**
 * @param {unknown} raw
 * @param {{ fallback?: string, type?: UserFacingErrorType }} [opts]
 * @returns {string}
 */
export function userFacingErrorMessage(raw, opts = {}) {
  return userFacingError(raw, opts).message;
}

/** @type {Record<string, UserFacingError>} */
const USER_FACING_EXACT = {
  "Invalid stage value": {
    type: "input",
    message: "Please select two stages from the timeline before comparing.",
    actionHint:
      "Pick a client, confirm the timeline shows your stages, then choose Image A and Image B—or use Sequential/Baseline with at least two stages that have photos.",
  },
  "pathsByStage missing": {
    type: "validation",
    message: "No images found for selected stages.",
    actionHint: "Click Refresh scan to reload the timeline, then pick your client and compare again.",
  },
  "imagePairs invalid": {
    type: "input",
    message: "Please select two images to compare.",
    actionHint: "Choose two different files from the dropdowns, then click Compare again.",
  },
};

/**
 * @type {{ test: (s: string) => boolean, message: string, type: UserFacingErrorType, actionHint?: string }[]}
 * Order matters: first match wins.
 */
const USER_FACING_PATTERNS = [
  {
    test: (s) => /orderedStages must be an array/i.test(s),
    type: "validation",
    message: "Timeline data isn’t ready for a multi-stage comparison.",
    actionHint: "Click Refresh scan, pick a client with at least two stages that contain images, then try again.",
  },
  {
    test: (s) => /orderedStages\[\d+\] must be a string/i.test(s),
    type: "input",
    message: "Please select two stages from the timeline before comparing.",
    actionHint: "Re-scan the client list, then pick valid stage labels or switch to Single mode and choose two images.",
  },
  {
    test: (s) => /pathsByStage must be a plain object|pathsByStage\s+missing/i.test(s),
    type: "validation",
    message: "No images found for selected stages.",
    actionHint: "Click Refresh scan to reload the timeline, then pick your client and compare again.",
  },
  {
    test: (s) => /imagePairs\s+invalid|invalid\s+image\s*pairs?/i.test(s),
    type: "input",
    message: "Please select two images to compare.",
    actionHint: "Choose two different files from the dropdowns, then click Compare again.",
  },
  {
    test: (s) => /pathsByStage\[[^\]]+\] must be a string/i.test(s),
    type: "validation",
    message: "Some stages are missing image paths.",
    actionHint: "Refresh the scan, add a photo to each stage folder, or pick different images in Single mode.",
  },
  {
    test: (s) => /imagePairs must be an array/i.test(s),
    type: "validation",
    message: "Please select two images to compare.",
    actionHint: "Use the Image A and Image B dropdowns (or fix your pair list) and run Compare again.",
  },
  {
    test: (s) =>
      /imagePairs\[\d+\]/i.test(s) &&
      /must be an object|requires non-empty pathA and pathB|pathA must be|pathB must be|stageA must be|stageB must be/i.test(s),
    type: "input",
    message: "One comparison pair is incomplete.",
    actionHint: "Select both images for each pair, then compare again.",
  },
  {
    test: (s) => /stageA must be a string when provided|stageB must be a string when provided/i.test(s),
    type: "input",
    message: "Please select two stages from the timeline before comparing.",
    actionHint: "Choose images that belong to stages, or pick stages with photos after refreshing the scan.",
  },
  {
    test: (s) => /pathA must be a string when provided|pathB must be a string when provided/i.test(s),
    type: "input",
    message: "Both images must be chosen before comparing.",
    actionHint: "Select Image A and Image B from the dropdowns, then click Compare.",
  },
  {
    test: (s) => /mode must be a string when provided/i.test(s),
    type: "input",
    message: "Comparison mode is invalid.",
    actionHint: "Choose Single, Sequential, or Baseline again, or refresh the page.",
  },
  {
    test: (s) => /cwd must be a string when provided|domainMode must be a string when provided/i.test(s),
    type: "system",
    message: "Workspace settings are invalid.",
    actionHint: "Reload the app or check that the project folder is opened correctly.",
  },
  {
    test: (s) => /fitness_image_comparison: path must be under workspace/i.test(s),
    type: "validation",
    message: "Those images must live inside your workspace folder.",
    actionHint: "Move or copy the files into the project workspace, refresh the scan, and pick them again.",
  },
  {
    test: (s) => /At least two ordered stages are required for multi-compare/i.test(s),
    type: "validation",
    message: "Need at least two timeline stages with images.",
    actionHint: "Add photos under more stage folders, refresh the scan, or switch to Single mode and pick two files.",
  },
  {
    test: (s) => /Missing image path for stage/i.test(s),
    type: "validation",
    message: "A stage in this plan doesn’t have an image yet.",
    actionHint: "Add a photo to that stage’s folder, click Refresh scan, or use Single compare to pick two files manually.",
  },
  {
    test: (s) => /Identical paths for stages|Identical paths for baseline/i.test(s),
    type: "input",
    message: "You picked the same file twice.",
    actionHint: "Choose two different images, then compare again.",
  },
  {
    test: (s) => /paths\[\d+\] must be a string/i.test(s),
    type: "validation",
    message: "A file path isn’t valid.",
    actionHint: "Re-select PDFs from your workspace or upload new files.",
  },
  {
    test: (s) => /uploads\[\d+\] must be an object/i.test(s),
    type: "validation",
    message: "Uploads could not be read.",
    actionHint: "Choose your PDFs again and run Compare.",
  },
  {
    test: (s) => /uploads\[\d+\]\.(name|dataBase64) must be a string when provided/i.test(s),
    type: "validation",
    message: "An upload is incomplete.",
    actionHint: "Re-add the PDF files (same count as before) and try again.",
  },
  {
    test: (s) => /selectedFields must be an array|selectedFields\[\d+\] must be a string/i.test(s),
    type: "validation",
    message: "Field selection is invalid.",
    actionHint: "Clear custom field filters or pick fields from the list again.",
  },
  {
    test: (s) => /anomalyThresholdPct must be a finite number when provided/i.test(s),
    type: "validation",
    message: "Anomaly threshold must be a valid number.",
    actionHint: "Enter a plain number (for example 15) or reset to the default.",
  },
  {
    test: (s) => /tax_document_comparison: path must be under workspace/i.test(s),
    type: "validation",
    message: "Each PDF must be inside your workspace folder.",
    actionHint: "Copy the files into the project workspace or pick files from there, then compare again.",
  },
  {
    test: (s) => /PDF exceeds max size/i.test(s),
    type: "validation",
    message: "One PDF is too large.",
    actionHint: "Use a smaller export, split the document, or reduce file size, then upload again.",
  },
  {
    test: (s) => /^Empty PDF upload$/i.test(s),
    type: "validation",
    message: "One of the PDFs appears empty.",
    actionHint: "Pick a different file or re-export the PDF, then try again.",
  },
  {
    test: (s) => /Provide 2[–-]5 PDFs/i.test(s),
    type: "validation",
    message: "Add between two and five PDFs to compare.",
    actionHint: "Use the file picker or workspace paths, then run Compare.",
  },
];

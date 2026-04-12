/**
 * Browser client — same exports as interfaces/api.js, routed through Vite dev middleware.
 */

async function post(body) {
  const r = await fetch("/__claira/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
    throw new Error("Invalid JSON from server");
  }
  if (!r.ok) throw new Error(typeof data?.error === "string" ? data.error : text || `HTTP ${r.status}`);
  return data;
}

/**
 * @param {string} inputPath
 * @param {{ cwd?: string }} [options]
 */
export function processFolder(inputPath, options) {
  return post({ kind: "processFolder", folderPath: inputPath, cwd: options?.cwd });
}

/**
 * @param {unknown[]} normalizedData
 * @param {{ cwd?: string }} [options]
 */
export function processData(normalizedData, options) {
  return post({ kind: "processData", items: normalizedData, cwd: options?.cwd });
}

/**
 * @param {{ source: string, input?: unknown }} args
 * @param {{ cwd?: string }} [options]
 */
export function ingestData(args, options) {
  return post({ kind: "ingestData", payload: args, cwd: options?.cwd });
}

/** @param {{ cwd?: string }} [options] */
export function getRooms(options) {
  return post({ kind: "getRooms", cwd: options?.cwd });
}

/** @param {{ cwd?: string }} [options] */
export function getSuggestions(options) {
  return post({ kind: "getSuggestions", cwd: options?.cwd });
}

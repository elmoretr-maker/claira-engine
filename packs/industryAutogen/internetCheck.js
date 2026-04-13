/**
 * Connectivity check using only URLs from allowedSources.json.
 */

import { loadAllowedSources, assertUrlHostAllowed } from "./loadAllowedSources.js";

/**
 * @returns {Promise<{ connected: boolean, detail: string, checked: Array<{ url: string, ok: boolean }> }>}
 */
export async function checkInternetConnection() {
  const cfg = loadAllowedSources();
  const results = [];
  for (const p of cfg.pingUrls) {
    const url = typeof p?.url === "string" ? p.url.trim() : "";
    if (!url) continue;
    assertUrlHostAllowed(url, cfg.allowedHosts);
    const timeoutMs = typeof p.timeoutMs === "number" && p.timeoutMs > 0 ? p.timeoutMs : 5000;
    let ok = false;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      const r = await fetch(url, { method: "GET", signal: ac.signal });
      clearTimeout(t);
      ok = r.ok;
    } catch {
      ok = false;
    }
    results.push({ url, ok });
    if (ok) {
      return { connected: true, detail: `Reachable: ${url}`, checked: results };
    }
  }
  return {
    connected: false,
    detail: "No approved ping endpoints responded.",
    checked: results,
  };
}

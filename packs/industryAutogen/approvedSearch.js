/**
 * Search restricted to URL templates in allowedSources.json.
 */

import { loadAllowedSources, assertUrlHostAllowed } from "./loadAllowedSources.js";

/**
 * @typedef {{ sourceId: string, query: string, titles: string[], descriptions: string[], urls: string[] }} ApprovedSearchHit
 */

/**
 * @param {string} query
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<ApprovedSearchHit[]>}
 */
export async function searchApprovedSources(query, options = {}) {
  const q = String(query ?? "").trim();
  if (!q) return [];

  const cfg = loadAllowedSources();
  const timeoutMs = options.timeoutMs ?? 12000;
  /** @type {ApprovedSearchHit[]} */
  const out = [];

  for (const src of cfg.sources) {
    const id = typeof src?.id === "string" ? src.id : "";
    const tmpl = typeof src?.urlTemplate === "string" ? src.urlTemplate : "";
    if (!id || !tmpl.includes("{{QUERY}}")) continue;

    const urlStr = tmpl.replace(/\{\{QUERY\}\}/g, encodeURIComponent(q));
    assertUrlHostAllowed(urlStr, cfg.allowedHosts);

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(urlStr, {
        method: src.method === "POST" ? "POST" : "GET",
        signal: ac.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = await r.json();
      if (!Array.isArray(j) || j.length < 2) continue;
      const titles = Array.isArray(j[1]) ? j[1].map((x) => String(x)) : [];
      const descriptions = Array.isArray(j[2]) ? j[2].map((x) => String(x)) : [];
      const urls = Array.isArray(j[3]) ? j[3].map((x) => String(x)) : [];
      out.push({ sourceId: id, query: q, titles, descriptions, urls });
    } catch {
      clearTimeout(t);
    }
  }

  return out;
}

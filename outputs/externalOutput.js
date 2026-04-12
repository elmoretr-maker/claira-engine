/**
 * Simulated push to an external system (replace with real HTTP/SDK later).
 */

/**
 * @param {unknown} results
 * @param {string} [target]
 * @returns {{ ok: true, simulated: true, externalTarget: string, count: number }}
 */
export function exportToExternal(results, target) {
  const t = target != null && String(target).length ? String(target) : "default";
  const arr = Array.isArray(results) ? results : [];
  const payload = {
    target: t,
    sentAt: new Date().toISOString(),
    count: arr.length,
    results: arr,
  };
  console.log("[claira:external-output]", JSON.stringify(payload));
  return { ok: true, simulated: true, externalTarget: t, count: arr.length };
}

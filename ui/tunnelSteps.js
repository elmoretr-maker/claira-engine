/**
 * Tunnel step plans: group-level (default) vs per-category (optional).
 * Grouping is UX-only; selected capabilities remain granular category keys.
 */

/**
 * @param {string[]} selectedKeys
 */
export function fingerprintSelectedCaps(selectedKeys) {
  const list = Array.isArray(selectedKeys)
    ? [...new Set(selectedKeys.map((k) => String(k).trim()).filter(Boolean))]
    : [];
  list.sort((a, b) => a.localeCompare(b));
  return list.join("\0");
}

/**
 * @typedef {{ label?: string, description?: string, categories?: string[] }} PackGroupDef
 * @typedef {{
 *   skipKey: string,
 *   stagingKey: string,
 *   kind: "group" | "category",
 *   groupId: string | null,
 *   label: string,
 *   description: string,
 *   categoryKeys: string[],
 * }} TunnelStep
 */

/**
 * @param {string} groupId
 */
export function stagingKeyForGroup(groupId) {
  const g = String(groupId ?? "").trim();
  if (!g || !/^[a-z0-9_-]+$/i.test(g)) return `g_unknown_${Date.now()}`;
  return `g_${g}`;
}

/**
 * @param {unknown[]} steps
 * @returns {TunnelStep[]}
 */
export function normalizeStoredTunnelSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((raw) => {
    const s = /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});
    const skipKey = String(s.skipKey ?? "");
    const kind = s.kind === "group" ? "group" : "category";
    const groupId = typeof s.groupId === "string" ? s.groupId : null;
    const label = typeof s.label === "string" ? s.label : skipKey;
    const description = typeof s.description === "string" ? s.description : "";
    const categoryKeys = Array.isArray(s.categoryKeys)
      ? s.categoryKeys.map((c) => String(c).trim()).filter(Boolean)
      : skipKey
        ? [skipKey]
        : [];
    let stagingKey = typeof s.stagingKey === "string" ? s.stagingKey : "";
    if (!stagingKey) {
      if (kind === "group" && groupId) stagingKey = stagingKeyForGroup(groupId);
      else stagingKey = categoryKeys[0] || skipKey.replace(/^g:/, "") || "unknown";
    }
    return {
      skipKey: skipKey || categoryKeys[0] || "unknown",
      stagingKey,
      kind,
      groupId,
      label,
      description,
      categoryKeys: categoryKeys.length ? categoryKeys : skipKey ? [skipKey] : [],
    };
  });
}

/**
 * Category keys that appear in any group.
 * @param {Record<string, PackGroupDef>} groups
 * @param {string[]} groupOrder
 * @returns {Set<string>}
 */
export function categoriesCoveredByGroups(groups, groupOrder) {
  const s = new Set();
  for (const gid of groupOrder) {
    const g = groups[gid];
    if (!g?.categories) continue;
    for (const c of g.categories) {
      const k = String(c).trim();
      if (k) s.add(k);
    }
  }
  return s;
}

/**
 * @param {string[]} selectedKeys
 * @param {Record<string, PackGroupDef>} groups
 * @param {string[]} groupOrder
 * @param {boolean} granular
 * @param {Record<string, { label?: string, description?: string }>} [categoryUi]
 * @returns {TunnelStep[]}
 */
export function buildTunnelSteps(selectedKeys, groups, groupOrder, granular, categoryUi = {}) {
  const sel = [...new Set((selectedKeys || []).map((k) => String(k).trim()).filter(Boolean))];
  const selSet = new Set(sel);
  const order = Array.isArray(groupOrder) && groupOrder.length ? groupOrder : Object.keys(groups || {}).sort();
  const gmap = groups && typeof groups === "object" ? groups : {};

  const hasGroups = order.some((gid) => {
    const g = gmap[gid];
    return g && Array.isArray(g.categories) && g.categories.length > 0;
  });

  if (!hasGroups) {
    return sel.sort((a, b) => a.localeCompare(b)).map((k) => ({
      skipKey: k,
      stagingKey: k,
      kind: "category",
      groupId: null,
      label: categoryUi[k]?.label || k,
      description: String(categoryUi[k]?.description ?? ""),
      categoryKeys: [k],
    }));
  }

  if (granular) {
    /** @type {TunnelStep[]} */
    const steps = [];
    for (const gid of order) {
      const g = gmap[gid];
      if (!g?.categories) continue;
      for (const c of g.categories) {
        const k = String(c).trim();
        if (!selSet.has(k)) continue;
        steps.push({
          skipKey: k,
          stagingKey: k,
          kind: "category",
          groupId: gid,
          label: categoryUi[k]?.label || k,
          description: String(categoryUi[k]?.description ?? ""),
          categoryKeys: [k],
        });
      }
    }
    const covered = categoriesCoveredByGroups(gmap, order);
    for (const k of sel.sort((a, b) => a.localeCompare(b))) {
      if (covered.has(k)) continue;
      steps.push({
        skipKey: k,
        stagingKey: k,
        kind: "category",
        groupId: null,
        label: categoryUi[k]?.label || k,
        description: String(categoryUi[k]?.description ?? ""),
        categoryKeys: [k],
      });
    }
    return steps;
  }

  /** @type {TunnelStep[]} */
  const groupSteps = [];
  for (const gid of order) {
    const g = gmap[gid];
    if (!g?.categories) continue;
    const cats = g.categories.map((c) => String(c).trim()).filter((c) => selSet.has(c));
    if (cats.length === 0) continue;
    const desc = typeof g.description === "string" ? g.description.trim() : "";
    groupSteps.push({
      skipKey: `g:${gid}`,
      stagingKey: stagingKeyForGroup(gid),
      kind: "group",
      groupId: gid,
      label: typeof g.label === "string" && g.label.trim() ? g.label.trim() : gid,
      description: desc,
      categoryKeys: cats,
    });
  }
  const covered = categoriesCoveredByGroups(gmap, order);
  for (const k of sel.sort((a, b) => a.localeCompare(b))) {
    if (covered.has(k)) continue;
    groupSteps.push({
      skipKey: k,
      stagingKey: k,
      kind: "category",
      groupId: null,
      label: categoryUi[k]?.label || k,
      description: String(categoryUi[k]?.description ?? ""),
      categoryKeys: [k],
    });
  }
  return groupSteps;
}

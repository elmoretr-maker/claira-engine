import { useCallback, useEffect, useMemo, useState } from "react";
import { getPackReference, getStructureCategories } from "../../interfaces/api.js";
import { useIndustry } from "../IndustryContext.jsx";
import { buildTunnelSteps } from "../tunnelSteps.js";
import {
  getSelectedCapabilities,
  maybeCompleteSetupWithZeroCapabilities,
  setSelectedCapabilities,
  setTunnelStepIndex,
  clearTunnelExampleCounts,
  setTunnelSkippedMap,
  setTunnelManifest,
  setTunnelGranular,
} from "../userPrefs.js";
import ProcessIntel from "../components/ProcessIntel.jsx";
import GuidedStepChrome from "../onboarding/GuidedStepChrome.jsx";
import { setStructureSetupComplete } from "../userPrefs.js";
import { InlineVoiceButton } from "../voice/InlineVoiceButton.jsx";
import "../voice/ClairaVoiceChrome.css";
import "./CapabilityScreen.css";

/**
 * @param {string} key
 */
function labelForCategoryKey(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param {Record<string, { categories?: string[] }>} groups
 * @param {string[]} groupOrder
 * @param {string[]} allKeys
 */
function ungroupedCategoryKeys(groups, groupOrder, allKeys) {
  const covered = new Set();
  for (const gid of groupOrder) {
    const g = groups[gid];
    if (!g?.categories) continue;
    for (const c of g.categories) covered.add(String(c).trim());
  }
  return allKeys.filter((k) => !covered.has(k));
}

/**
 * @param {{
 *   packProcesses?: Record<string, unknown>,
 *   onContinue: (selected: string[]) => void,
 *   onBack?: () => void,
 *   guidedStep?: number,
 * }} props
 */
export default function CapabilityScreen({ packProcesses = {}, onContinue, onBack, guidedStep }) {
  const { industrySlug } = useIndustry();
  /** @type {Array<{ key: string, label: string, description: string }>} */
  const [flatEntries, setFlatEntries] = useState([]);
  /** @type {Record<string, { label: string, description: string, categories: string[] }>} */
  const [groups, setGroups] = useState({});
  const [groupOrder, setGroupOrder] = useState(/** @type {string[]} */ ([]));
  /** @type {Record<string, { label: string, description: string }>} */
  const [categoryUi, setCategoryUi] = useState({});
  const [allKeys, setAllKeys] = useState(/** @type {string[]} */ ([]));

  const [selected, setSelected] = useState(() => new Set(getSelectedCapabilities()));
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(true);

  const useGroupedUi = useMemo(() => {
    return groupOrder.some((gid) => (groups[gid]?.categories?.length ?? 0) > 0);
  }, [groups, groupOrder]);

  const otherKeys = useMemo(
    () => (useGroupedUi ? ungroupedCategoryKeys(groups, groupOrder, allKeys) : []),
    [useGroupedUi, groups, groupOrder, allKeys],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const pref = await getPackReference();
        const keys = Array.isArray(pref?.keys) ? pref.keys : [];
        const cats = pref?.categories && typeof pref.categories === "object" ? pref.categories : {};
        const gOrder = Array.isArray(pref?.groupOrder) ? pref.groupOrder : [];
        const gRaw = pref?.groups && typeof pref.groups === "object" ? pref.groups : {};
        /** @type {Record<string, { label: string, description: string, categories: string[] }>} */
        const gNorm = {};
        for (const gid of gOrder) {
          const g = gRaw[gid];
          if (!g || typeof g !== "object") continue;
          gNorm[gid] = {
            label: typeof g.label === "string" ? g.label : gid,
            description: typeof g.description === "string" ? g.description : "",
            categories: Array.isArray(g.categories) ? g.categories.map((c) => String(c).trim()).filter(Boolean) : [],
          };
        }
        /** @type {Record<string, { label: string, description: string }>} */
        const ui = {};
        for (const k of keys) {
          const c = /** @type {{ label?: string, description?: string }} */ (cats[k]);
          ui[k] = {
            label: typeof c?.label === "string" ? c.label : labelForCategoryKey(k),
            description: typeof c?.description === "string" ? c.description : "",
          };
        }

        if (!cancelled) {
          setCategoryUi(ui);
          setGroups(gNorm);
          setGroupOrder(gOrder.filter((id) => gNorm[id]?.categories?.length));
          setAllKeys(keys);
        }

        if (keys.length > 0) {
          if (!cancelled) {
            setFlatEntries(
              keys.map((k) => ({
                key: k,
                label: ui[k]?.label ?? labelForCategoryKey(k),
                description: ui[k]?.description ?? "",
              })),
            );
          }
          return;
        }
        const out = await getStructureCategories();
        const list = Array.isArray(out?.categories) ? out.categories : [];
        if (!cancelled) {
          setFlatEntries(
            list
              .filter((x) => typeof x === "string")
              .map((k) => ({
                key: k,
                label: labelForCategoryKey(k),
                description: "",
              })),
          );
          setAllKeys(list.filter((x) => typeof x === "string"));
          setGroups({});
          setGroupOrder([]);
          setCategoryUi({});
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [industrySlug]);

  const toggleCategory = useCallback((key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleGroupAll = useCallback(
    (gid) => {
      const g = groups[gid];
      if (!g?.categories?.length) return;
      const present = g.categories.filter((k) => allKeys.includes(k));
      const allOn = present.length > 0 && present.every((k) => selected.has(k));
      setSelected((prev) => {
        const next = new Set(prev);
        if (allOn) {
          for (const k of present) next.delete(k);
        } else {
          for (const k of present) next.add(k);
        }
        return next;
      });
    },
    [groups, allKeys],
  );

  const groupSelectionState = useCallback(
    (gid) => {
      const g = groups[gid];
      if (!g?.categories?.length) return { checked: false, indeterminate: false };
      const present = g.categories.filter((k) => allKeys.includes(k));
      const n = present.filter((k) => selected.has(k)).length;
      return {
        checked: present.length > 0 && n === present.length,
        indeterminate: n > 0 && n < present.length,
      };
    },
    [groups, allKeys, selected],
  );

  const handleContinue = useCallback(() => {
    const list = [...selected];
    const prev = getSelectedCapabilities();
    const same =
      prev.length === list.length && [...prev].sort().join("\0") === [...list].sort().join("\0");

    if (list.length === 0) {
      setSelectedCapabilities([]);
      setTunnelStepIndex(0);
      setTunnelSkippedMap({});
      clearTunnelExampleCounts();
      setStructureSetupComplete(false);
      maybeCompleteSetupWithZeroCapabilities();
      onContinue([]);
      return;
    }

    const steps = buildTunnelSteps(list, groups, groupOrder, false, categoryUi);
    setTunnelManifest(list, steps, false);
    setTunnelGranular(false);

    setSelectedCapabilities(list);
    if (!same) {
      setStructureSetupComplete(false);
      setTunnelStepIndex(0);
      setTunnelSkippedMap({});
      clearTunnelExampleCounts();
    }
    onContinue(list);
  }, [onContinue, selected, groups, groupOrder, categoryUi]);

  return (
    <>
      {typeof guidedStep === "number" ? (
        <GuidedStepChrome step={guidedStep} phaseLabel="Capabilities" />
      ) : null}
      <div className="capability-screen card">
      <header className="capability-screen-header">
        <div className="claira-screen-heading-row">
          <div>
            <h1>What would you like me to focus on?</h1>
            <div className="capability-screen-desc-wrap">
              <InlineVoiceButton voiceKey="capability_intro" />
              <p className="capability-screen-desc">
                I've grouped what your pack can handle—tick the areas you want me to help with. Open a group anytime to see
                the exact categories I'll watch.
              </p>
            </div>
          </div>
        </div>
      </header>

      {onBack && typeof guidedStep !== "number" ? (
        <button type="button" className="btn btn-secondary capability-back" onClick={onBack}>
          Back
        </button>
      ) : null}

      {busy ? <p className="capability-status">I’m loading what your pack includes…</p> : null}
      {error ? (
        <p className="capability-error" role="alert">
          {error}
        </p>
      ) : null}

      {!busy && !error && useGroupedUi ? (
        <ul className="capability-list capability-list--groups">
          {groupOrder.map((gid) => {
            const g = groups[gid];
            if (!g?.categories?.length) return null;
            const present = g.categories.filter((k) => allKeys.includes(k));
            if (present.length === 0) return null;
            const { checked, indeterminate } = groupSelectionState(gid);
            return (
              <li key={gid} className="capability-group-li">
                <div className="capability-group-head">
                  <label className="capability-row capability-row--group">
                    <input
                      ref={(el) => {
                        if (el) el.indeterminate = indeterminate;
                      }}
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleGroupAll(gid)}
                    />
                    <span className="capability-title">{g.label}</span>
                  </label>
                </div>
                {g.description ? <p className="capability-group-desc">{g.description}</p> : null}
                <details className="capability-group-details">
                  <summary>See the {present.length} categories I’ll handle here</summary>
                  <ul className="capability-sublist">
                    {present.map((k) => (
                      <li key={k}>
                        <label className="capability-row capability-row--sub">
                          <input type="checkbox" checked={selected.has(k)} onChange={() => toggleCategory(k)} />
                          <span className="capability-title">{categoryUi[k]?.label ?? labelForCategoryKey(k)}</span>
                          <span className="capability-key mono">{k}</span>
                        </label>
                        {categoryUi[k]?.description ? (
                          <p className="capability-desc capability-desc--sub">{categoryUi[k].description}</p>
                        ) : null}
                        <ProcessIntel
                          categoryKey={k}
                          entry={
                            packProcesses[k] && typeof packProcesses[k] === "object"
                              ? /** @type {{ purpose?: string, actions?: string[], priority?: string, review_required?: boolean }} */ (
                                  packProcesses[k]
                                )
                              : null
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
          {otherKeys.length > 0 ? (
            <li className="capability-group-li">
              <div className="capability-group-head">
                <span className="capability-title capability-title--plain">Other categories</span>
              </div>
              <p className="capability-group-desc">
                These didn’t fit a group above—turn on only what you actually want me to cover.
              </p>
              <ul className="capability-sublist capability-sublist--bare">
                {otherKeys.map((k) => (
                  <li key={k}>
                    <label className="capability-row capability-row--sub">
                      <input type="checkbox" checked={selected.has(k)} onChange={() => toggleCategory(k)} />
                      <span className="capability-title">{categoryUi[k]?.label ?? labelForCategoryKey(k)}</span>
                      <span className="capability-key mono">{k}</span>
                    </label>
                    <ProcessIntel
                      categoryKey={k}
                      entry={
                        packProcesses[k] && typeof packProcesses[k] === "object"
                          ? /** @type {{ purpose?: string, actions?: string[], priority?: string, review_required?: boolean }} */ (
                              packProcesses[k]
                            )
                          : null
                      }
                    />
                  </li>
                ))}
              </ul>
            </li>
          ) : null}
        </ul>
      ) : null}

      {!busy && !error && !useGroupedUi ? (
        <ul className="capability-list">
          {flatEntries.map((e) => (
            <li key={e.key}>
              <label className="capability-row capability-row--block">
                <div className="capability-row-head">
                  <input type="checkbox" checked={selected.has(e.key)} onChange={() => toggleCategory(e.key)} />
                  <span className="capability-title">{e.label}</span>
                  <span className="capability-key mono">{e.key}</span>
                </div>
                {e.description ? <p className="capability-desc">{e.description}</p> : null}
                <ProcessIntel
                  categoryKey={e.key}
                  entry={
                    packProcesses[e.key] && typeof packProcesses[e.key] === "object"
                      ? /** @type {{ purpose?: string, actions?: string[], priority?: string, review_required?: boolean }} */ (
                          packProcesses[e.key]
                        )
                      : null
                  }
                />
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="capability-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={handleContinue}>
          Next
        </button>
        <p className="capability-hint">
          You can continue with nothing selected—I’ll skip guided setup and leave learning mode for now.
        </p>
      </div>
    </div>
    </>
  );
}

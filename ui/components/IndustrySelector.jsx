import { useCallback, useEffect, useState } from "react";
import { listIndustryPacks } from "../../interfaces/api.js";
import { useIndustry } from "../IndustryContext.jsx";
import CreateIndustryPanel from "./CreateIndustryPanel.jsx";
import "./IndustrySelector.css";

/**
 * @param {{ onLoaded: (industry: string) => void }} props
 */
export default function IndustrySelector({ onLoaded }) {
  const { loadIndustryPack } = useIndustry();
  const [packs, setPacks] = useState(/** @type {Array<{ slug: string, label: string, inputVerb?: string }>} */ ([]));
  const [value, setValue] = useState("");
  const [listError, setListError] = useState(/** @type {string | null} */ (null));
  const [status, setStatus] = useState(/** @type {string | null} */ (null));
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [listBusy, setListBusy] = useState(true);

  const loadPackList = useCallback(async (preferSlug) => {
    setListBusy(true);
    setListError(null);
    try {
      const out = await listIndustryPacks();
      const list = Array.isArray(out?.packs) ? out.packs : [];
      setPacks(list);
      const pref = typeof preferSlug === "string" ? preferSlug.trim() : "";
      setValue((prev) => {
        if (pref && list.some((p) => p.slug === pref)) return pref;
        if (prev && list.some((p) => p.slug === prev)) return prev;
        return list[0]?.slug ?? "";
      });
    } catch (e) {
      setPacks([]);
      setValue("");
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setListBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadPackList();
  }, [loadPackList]);

  async function handleApply() {
    setError(null);
    setStatus(null);
    if (!value) {
      setError("No industry pack selected.");
      return;
    }
    setBusy(true);
    try {
      await loadIndustryPack(value);
      setStatus(`Loaded: ${value}`);
      window.setTimeout(() => onLoaded(value), 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="industry-selector">
      <div className="industry-selector-card card">
        <h1 className="industry-selector-title">Choose industry</h1>
        <p className="industry-selector-desc">
          Packs are loaded from the workspace <span className="mono">packs/</span> folder. Each folder with a{" "}
          <span className="mono">structure.json</span> appears here automatically.
        </p>

        <label className="industry-selector-label" htmlFor="industry-select">
          Industry pack
        </label>
        {listBusy ? (
          <p className="industry-selector-status">Discovering packs…</p>
        ) : listError ? (
          <p className="industry-selector-error" role="alert">
            Could not list packs: {listError}
          </p>
        ) : packs.length === 0 ? (
          <p className="industry-selector-error" role="alert">
            No packs found. Add a folder under <span className="mono">packs/&lt;slug&gt;/</span> with{" "}
            <span className="mono">structure.json</span>.
          </p>
        ) : (
          <select
            id="industry-select"
            className="industry-selector-select"
            value={value}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
          >
            {packs.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.label} ({o.slug})
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          className="btn btn-primary industry-selector-cta"
          disabled={busy || listBusy || packs.length === 0 || !value}
          onClick={() => void handleApply()}
        >
          {busy ? "Loading…" : "Continue"}
        </button>

        {status ? (
          <p className="industry-selector-status" role="status">
            {status}
          </p>
        ) : null}
        {error ? (
          <p className="industry-selector-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <CreateIndustryPanel reloadPacks={loadPackList} activatePack={loadIndustryPack} />
    </div>
  );
}

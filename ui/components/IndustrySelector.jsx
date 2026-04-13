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
  const [welcomePhase, setWelcomePhase] = useState(/** @type {"intro" | "setup"} */ ("intro"));
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

  const handleApply = useCallback(async () => {
    setError(null);
    setStatus(null);
    if (!value) {
      setError("Pick a pack first—I need to know which industry we’re using.");
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
  }, [value, loadIndustryPack, onLoaded]);

  if (welcomePhase === "intro") {
    return (
      <main className="industry-selector industry-selector--intro">
        <div className="industry-selector-intro-card card">
          <p className="industry-selector-intro-kicker">Welcome</p>
          <h1 className="industry-selector-intro-title">Hi, I&apos;m Claira</h1>
          <div className="industry-selector-intro-body">
            <p>
              I help you work with <strong>industry packs</strong> in this workspace—organizing categories, references,
              and the flow around your documents so things stay consistent.
            </p>
            <p>
              I&apos;ll stay beside you step by step: whether you&apos;re loading a pack you already have or shaping a
              new one, we&apos;ll do it together.
            </p>
          </div>
          <p className="industry-selector-intro-ask">How can I help you today?</p>
          <button type="button" className="btn btn-primary industry-selector-intro-cta" onClick={() => setWelcomePhase("setup")}>
            Continue
          </button>
        </div>
      </main>
    );
  }

  return (
    <div className="industry-selector industry-selector--setup">
      <section className="industry-selector-continuation card" aria-labelledby="claira-setup-continuation-heading">
        <h2 id="claira-setup-continuation-heading" className="industry-selector-continuation-title">
          Let&apos;s get you set up
        </h2>
        <p className="industry-selector-continuation-desc">
          I&apos;m glad you&apos;re here. Next, we&apos;ll choose how you want to begin: load an industry pack that&apos;s
          already in your <span className="mono">packs/</span> folder, or have me walk through creating a new one on
          autopilot. Pick the path that fits you—I&apos;ll take it from there.
        </p>
        <button type="button" className="industry-selector-back-to-intro" onClick={() => setWelcomePhase("intro")}>
          Back to introduction
        </button>
      </section>

      <div className="industry-selector-columns">
        <div className="industry-selector-card card">
          <h1 className="industry-selector-title">Which pack should I load?</h1>
          <p className="industry-selector-desc">
            I read packs from your workspace <span className="mono">packs/</span> folder—any folder with a{" "}
            <span className="mono">structure.json</span> shows up here automatically.
          </p>

          <label className="industry-selector-label" htmlFor="industry-select">
            Industry pack
          </label>
          {listBusy ? (
            <p className="industry-selector-status">I’m scanning your workspace for packs…</p>
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
    </div>
  );
}

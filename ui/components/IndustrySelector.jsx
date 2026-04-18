import { useCallback, useEffect, useMemo, useState } from "react";
import { listIndustryPacks } from "../../interfaces/api.js";
import { useIndustry } from "../IndustryContext.jsx";
import { afterCurrentClairaUtteranceOrNow, primeClairaVoicePlayback } from "../voice/clairaSpeech.js";
import GuidedStepChrome from "../onboarding/GuidedStepChrome.jsx";
import { ONBOARDING_STEP } from "../onboarding/onboardingFlowMeta.js";
import CreateIndustryPanel from "./CreateIndustryPanel.jsx";
import ClairaClaritySignature from "./ClairaClaritySignature.jsx";
import "../screens/WelcomeScreen.css";
import "./IndustrySelector.css";

/**
 * @param {{
 *   onLoaded: (industry: string) => void,
 *   variant?: "full" | "selectOnly",
 * }} props
 */
export default function IndustrySelector({ onLoaded, variant = "full" }) {
  const { loadIndustryPack } = useIndustry();
  const [packs, setPacks] = useState(
    /** @type {Array<{ slug: string, label: string, inputVerb?: string, valid?: boolean, status?: string, errors?: string[] }>} */ ([]),
  );
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

  const selectedPack = useMemo(() => packs.find((p) => p.slug === value), [packs, value]);

  const handleApply = useCallback(async () => {
    setError(null);
    setStatus(null);
    if (!value) {
      setError("Pick a category first—I need to know which configuration we’re loading.");
      return;
    }
    const sel = packs.find((p) => p.slug === value);
    if (sel && sel.valid === false && Array.isArray(sel.errors) && sel.errors.length > 0) {
      setError(`Cannot load pack — fix the following:\n${sel.errors.map((d) => `- ${d}`).join("\n")}`);
      return;
    }
    setBusy(true);
    try {
      await loadIndustryPack(value);
      setStatus(`Loaded: ${value}`);
      await afterCurrentClairaUtteranceOrNow();
      onLoaded(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [value, packs, loadIndustryPack, onLoaded]);

  const activatePackWithAck = useCallback(
    async (slug) => {
      await loadIndustryPack(slug);
    },
    [loadIndustryPack],
  );

  if (variant === "selectOnly") {
    return (
      <div className="industry-selector industry-selector--setup">
        <p className="industry-selector-guided-hint card">
          Pick the industry pack that matches this workspace. I read from your <span className="mono">packs/</span>{" "}
          folder.
        </p>
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
                    {o.valid === false && import.meta.env.DEV ? `${o.label} (INVALID)` : `${o.label} (${o.slug})`}
                  </option>
                ))}
              </select>
            )}
            {selectedPack?.valid === false && import.meta.env.DEV && Array.isArray(selectedPack.errors) ? (
              <p className="industry-selector-error" role="status">
                <strong className="industry-selector-invalid-badge">Invalid pack</strong> — cannot load until fixed.
                <ul className="industry-selector-invalid-list">
                  {selectedPack.errors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              </p>
            ) : null}
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
          <CreateIndustryPanel reloadPacks={loadPackList} activatePack={activatePackWithAck} />
        </div>
      </div>
    );
  }

  return (
    <main className="welcome-screen">
      <ClairaClaritySignature className="claira-clarity-signature--corner" />
      <div className="welcome-screen-inner welcome-screen-inner--category-wide">
        <GuidedStepChrome
          step={ONBOARDING_STEP.packPick}
          phaseLabel="Choose category"
          hideBack
          hideStartOver={false}
        >
          <div className="industry-selector industry-selector--setup">
            <div className="industry-selector-columns industry-selector-columns--split">
              <div className="industry-selector-card industry-selector-card--choose card category-glass-panel">
                <h1 className="industry-selector-title">Choose your category</h1>
                <div className="industry-selector-desc industry-selector-desc--prose">
                  <p>
                    This path is for when you already have a category you trust—something you or your team set up
                    earlier and want to keep using.
                  </p>
                  <p>
                    I’ll load it so the way I sort, label, and think about your items matches that world, without you
                    rebuilding everything from scratch.
                  </p>
                  <p>
                    You keep consistency, save time, and avoid the small mismatches that show up when every tool invents
                    its own system.
                  </p>
                  <p>You stay in charge—I’m aligning with what you chose, not replacing your judgment.</p>
                  <p>
                    Pick what fits what you’re doing now, then press Continue when you want me to bring it in.
                  </p>
                </div>

                <label className="industry-selector-label" htmlFor="industry-select-full">
                  Category
                </label>
                {listBusy ? (
                  <p className="industry-selector-status">Scanning your workspace…</p>
                ) : listError ? (
                  <p className="industry-selector-error" role="alert">
                    Could not list packs: {listError}
                  </p>
                ) : packs.length === 0 ? (
                  <p className="industry-selector-error" role="alert">
                    Nothing to choose yet—create one with Create Your Category on the right, or come back when a category
                    has been added for you.
                  </p>
                ) : (
                  <select
                    id="industry-select-full"
                    className="industry-selector-select"
                    value={value}
                    disabled={busy}
                    onChange={(e) => setValue(e.target.value)}
                  >
                    {packs.map((o) => (
                      <option key={o.slug} value={o.slug}>
                        {o.valid === false && import.meta.env.DEV ? `${o.label} (INVALID)` : `${o.label} (${o.slug})`}
                      </option>
                    ))}
                  </select>
                )}

                {selectedPack?.valid === false && import.meta.env.DEV && Array.isArray(selectedPack.errors) ? (
                  <p className="industry-selector-error" role="status">
                    <strong className="industry-selector-invalid-badge">Invalid pack</strong> — cannot load until fixed.
                    <ul className="industry-selector-invalid-list">
                      {selectedPack.errors.map((err) => (
                        <li key={err}>{err}</li>
                      ))}
                    </ul>
                  </p>
                ) : null}
                <button
                  type="button"
                  className="btn btn-primary industry-selector-cta"
                  disabled={busy || listBusy || packs.length === 0 || !value}
                  onClick={() =>
                    void (async () => {
                      await primeClairaVoicePlayback();
                      void handleApply();
                    })()
                  }
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

              <CreateIndustryPanel
                reloadPacks={loadPackList}
                activatePack={activatePackWithAck}
                className="category-glass-panel"
              />
            </div>
          </div>
        </GuidedStepChrome>
      </div>
    </main>
  );
}

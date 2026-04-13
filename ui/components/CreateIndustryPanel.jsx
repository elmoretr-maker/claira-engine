import { useCallback, useState } from "react";
import {
  autoImproveIndustryPack,
  checkInternetConnection,
  confirmIndustryPackActivation,
  createIndustryFromInput,
} from "../../interfaces/api.js";
import IndustryBuildReport from "./IndustryBuildReport.jsx";
import "./CreateIndustryPanel.css";

/**
 * @param {{
 *   reloadPacks: (preferSlug?: string) => Promise<void>,
 *   activatePack?: (slug: string) => Promise<unknown>,
 *   onCreated?: (slug: string) => void,
 * }} props
 */
export default function CreateIndustryPanel({ reloadPacks, activatePack, onCreated }) {
  const [net, setNet] = useState(/** @type {{ connected: boolean, detail: string } | null} */ (null));
  const [netBusy, setNetBusy] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState(/** @type {Array<{ id: string, label: string, status: string, detail?: string }>} */ ([]));
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [success, setSuccess] = useState(/** @type {string | null} */ (null));
  const [qualityGate, setQualityGate] = useState(/** @type {{ slug: string, report: Record<string, unknown> } | null} */ (null));
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [improveBusy, setImproveBusy] = useState(false);

  const runNetCheck = useCallback(async () => {
    setNetBusy(true);
    setError(null);
    try {
      const r = await checkInternetConnection();
      setNet({
        connected: Boolean(r?.connected),
        detail: typeof r?.detail === "string" ? r.detail : "",
      });
    } catch (e) {
      setNet({ connected: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setNetBusy(false);
    }
  }, []);

  const runBuild = useCallback(async () => {
    setError(null);
    setSuccess(null);
    setSteps([]);
    setQualityGate(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter an industry name.");
      return;
    }
    setBusy(true);
    try {
      const r = await createIndustryFromInput({ industryName: trimmed });
      if (Array.isArray(r?.steps)) {
        setSteps(/** @type {typeof steps} */ (r.steps));
      }
      if (r?.ok === true && typeof r?.slug === "string") {
        if (r.activated === true) {
          setSuccess(
            `Pack created and activated: ${r.slug}. The industry list is updated — press Continue to enter the app.`,
          );
          await reloadPacks(r.slug);
          try {
            if (typeof activatePack === "function") {
              await activatePack(r.slug);
            }
          } catch (actErr) {
            setSuccess(
              `Pack created: ${r.slug}. Could not sync session automatically — pick it in the list and press Continue.`,
            );
            console.error(actErr);
          }
          onCreated?.(r.slug);
          setName("");
        } else if (r.needsUserDecision === true && r.report && typeof r.report === "object") {
          const rep = /** @type {{ overallScore?: number, rating?: string }} */ (r.report);
          const pct = typeof rep.overallScore === "number" ? rep.overallScore : "?";
          const rate = typeof rep.rating === "string" ? rep.rating : "unknown";
          setQualityGate({ slug: r.slug, report: r.report });
          setSuccess(
            `Pack built: ${r.slug}. Coverage ${pct}% (${rate}) — review the quality report and choose whether to activate.`,
          );
          await reloadPacks(r.slug);
          setName("");
        } else {
          setError("Build finished but activation could not be determined.");
        }
      } else {
        setError(typeof r?.error === "string" ? r.error : "Build did not complete.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [name, reloadPacks, activatePack, onCreated]);

  const handleConfirmActivation = useCallback(
    async (slug) => {
      setError(null);
      setConfirmBusy(true);
      try {
        const out = await confirmIndustryPackActivation({ slug });
        if (out?.ok !== true) {
          setError(typeof out?.error === "string" ? out.error : "Activation failed.");
          return;
        }
        setQualityGate(null);
        setSuccess(
          `Pack activated: ${slug}. The industry list is updated — press Continue to enter the app.`,
        );
        await reloadPacks(slug);
        try {
          if (typeof activatePack === "function") {
            await activatePack(slug);
          }
        } catch (actErr) {
          setSuccess(
            `Pack activated: ${slug}. Could not sync session automatically — pick it in the list and press Continue.`,
          );
          console.error(actErr);
        }
        onCreated?.(slug);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setConfirmBusy(false);
      }
    },
    [reloadPacks, activatePack, onCreated],
  );

  const handleImproveAfterGate = useCallback(() => {
    setQualityGate((g) => {
      const slug = g?.slug;
      if (slug) {
        setSuccess(
          `Pack saved under packs/${slug}/ — improve reference assets, then load the pack from the list or confirm activation here when ready.`,
        );
      }
      return null;
    });
  }, []);

  const handleAutoImprove = useCallback(async () => {
    const slug = qualityGate?.slug;
    if (!slug) return;
    setError(null);
    setImproveBusy(true);
    try {
      const out = await autoImproveIndustryPack({ slug });
      if (!out?.ok) {
        setError(typeof out?.error === "string" ? out.error : "Automatic improvement failed.");
        if (out?.report && typeof out.report === "object") {
          setQualityGate({ slug, report: /** @type {Record<string, unknown>} */ (out.report) });
        }
        return;
      }
      const report = out.report;
      if (!report || typeof report !== "object") {
        setError("Improve ran but no report returned.");
        return;
      }
      setQualityGate({ slug, report: /** @type {Record<string, unknown>} */ (report) });
      const pct = typeof report.overallScore === "number" ? report.overallScore : "?";
      const rate = typeof report.rating === "string" ? report.rating : "?";
      setSuccess(`Reference coverage updated for ${slug}: ${pct}% (${rate}).`);
      if (report.rating === "high") {
        await handleConfirmActivation(slug);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImproveBusy(false);
    }
  }, [qualityGate?.slug, handleConfirmActivation]);

  return (
    <section className="create-industry-panel card" aria-labelledby="create-industry-heading">
      <h2 id="create-industry-heading" className="create-industry-title">
        Create industry (autopilot)
      </h2>

      <div className="create-industry-intro">
        <p>
          <strong>What I’ll do:</strong> I check connectivity, run <strong>controlled research</strong> (only URLs in{" "}
          <span className="mono">config/allowedSources.json</span>), <strong>structure categories</strong> (dedupe +
          merge similar), then create <span className="mono">templates/&lt;slug&gt;.js</span> when needed, run{" "}
          <span className="mono">dev/generate_pack_system.mjs</span> per category (normal template mode—no forced generic
          mode), <strong>validate</strong> the pack, and <strong>load</strong> it into <span className="mono">config/</span>.
        </p>
        <p>
          <strong>Progress:</strong> (1) Checking connection → (2) Researching industry → (3) Structuring categories
          → (4) Generating references → (5) Building system → (6) Finalizing.
        </p>
        <p>
          <strong>Compared to a hand-built pack:</strong> what I build here mixes public research snippets with synthetic
          assets and auto-templates. It’s a <strong>starting point</strong>, not a finished playbook—you’ll still want to
          tune <span className="mono">structure.json</span>, <span className="mono">reference.json</span>, and{" "}
          <span className="mono">templates/&lt;slug&gt;.js</span> for production quality.
        </p>
        <p className="create-industry-disclaimer">
          <strong>Limitations:</strong> Research is limited to approved APIs (no open web browsing). Results are not
          legal, medical, or compliance advice. If a build fails, I roll back auto-created packs and auto-templates so
          you’re not stuck with a broken partial pack.
        </p>
      </div>

      <div className="create-industry-net">
        <p className="create-industry-net-label">Internet (required for research)</p>
        <div className="create-industry-net-row">
          <button type="button" className="btn btn-secondary" disabled={netBusy} onClick={() => void runNetCheck()}>
            {netBusy ? "Checking…" : net?.connected ? "Re-check connection" : "Check connection"}
          </button>
          {net ? (
            <span className={net.connected ? "create-industry-net-ok" : "create-industry-net-bad"} role="status">
              {net.connected ? "Connected" : "Internet connection required"} — {net.detail}
            </span>
          ) : (
            <span className="create-industry-net-muted">Run a check before building.</span>
          )}
        </div>
      </div>

      <label className="create-industry-label" htmlFor="create-industry-name">
        Industry name
      </label>
      <input
        id="create-industry-name"
        className="create-industry-input"
        type="text"
        placeholder="e.g. Veterinary clinic, Coffee roasting, Municipal permits"
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="create-industry-actions">
        <button
          type="button"
          className="btn btn-primary create-industry-build"
          disabled={busy || !net?.connected || !name.trim()}
          onClick={() => void runBuild()}
        >
          {busy ? "Running pipeline…" : "Build industry pack"}
        </button>
        {error ? (
          <button type="button" className="btn btn-secondary" disabled={busy || !net?.connected || !name.trim()} onClick={() => void runBuild()}>
            Retry
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="create-industry-error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="create-industry-success" role="status">
          {success}
        </p>
      ) : null}

      {qualityGate ? (
        <IndustryBuildReport
          slug={qualityGate.slug}
          report={qualityGate.report}
          proceedBusy={confirmBusy}
          improveBusy={improveBusy}
          onProceed={() => void handleConfirmActivation(qualityGate.slug)}
          onImprove={handleImproveAfterGate}
          onAutoImprove={() => void handleAutoImprove()}
        />
      ) : null}

      {steps.length > 0 ? (
        <ol className="create-industry-steps">
          {steps.map((s, i) => (
            <li key={s.id} className={`create-industry-step create-industry-step--${s.status}`}>
              <span className="create-industry-step-num">{i + 1}.</span>
              <span className="create-industry-step-label">{s.label}</span>
              {s.detail ? <span className="create-industry-step-detail">{s.detail}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

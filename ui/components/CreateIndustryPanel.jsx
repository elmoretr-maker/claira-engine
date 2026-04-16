import { useCallback, useState } from "react";
import {
  autoImproveIndustryPack,
  checkInternetConnection,
  confirmIndustryPackActivation,
  createIndustryFromInput,
  previewIndustryModuleComposition,
} from "../../interfaces/api.js";
import {
  CLARIFICATION_INTRO,
  MODULE_SELECTION_ORDER,
  validateWorkflowModuleSelection,
} from "../../workflow/contracts/workflowRules.js";
import {
  guidedBuildComposeInput,
  GUIDED_DOMAIN_CHOICES,
  GUIDED_GOAL_CHOICES,
  GUIDED_SYSTEM_CHOICES,
  GUIDED_TRACK_CHOICES,
} from "../../workflow/moduleMapping/guidedBuildComposeInput.js";
import {
  applyAnalyzerToWorkflowBuildState,
  createInitialWorkflowBuildState,
  getGuidedModuleSignalsForApi,
  patchGuidedDraft,
  patchIndustryFields,
  patchModuleSelectionToggle,
  transitionBackToClarify,
  transitionBackToInput,
  transitionBackToSelect,
  transitionChooseEntryPath,
  transitionClarifyToSelect,
  transitionCompleteReset,
  transitionConfirmToBuild,
  transitionSelectToConfirm,
} from "../../workflow/state/workflowBuildState.js";
import IndustryBuildReport from "./IndustryBuildReport.jsx";
import "./CreateIndustryPanel.css";

/**
 * @param {{
 *   reloadPacks: (preferSlug?: string) => Promise<void>,
 *   activatePack?: (slug: string) => Promise<unknown>,
 *   onCreated?: (slug: string) => void,
 *   className?: string,
 * }} props
 */
export default function CreateIndustryPanel({ reloadPacks, activatePack, onCreated, className = "" }) {
  const [net, setNet] = useState(/** @type {{ connected: boolean, detail: string } | null} */ (null));
  const [netBusy, setNetBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState(/** @type {Array<{ id: string, label: string, status: string, detail?: string }>} */ ([]));
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [success, setSuccess] = useState(/** @type {string | null} */ (null));
  const [qualityGate, setQualityGate] = useState(/** @type {{ slug: string, report: Record<string, unknown> } | null} */ (null));
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [improveBusy, setImproveBusy] = useState(false);

  const [previewBusy, setPreviewBusy] = useState(false);
  const [buildState, setBuildState] = useState(createInitialWorkflowBuildState);
  const [selectionError, setSelectionError] = useState(/** @type {string | null} */ (null));

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

  const resetFlowAfterSuccess = useCallback(() => {
    setBuildState(transitionCompleteReset());
    setSelectionError(null);
  }, []);

  const applyGuidedAnswersToDescription = useCallback(() => {
    const g = buildState.guidedDraft;
    const { buildIntent: nextIntent } = guidedBuildComposeInput({
      shortLabel: buildState.industryName,
      trackPeople: g.trackPeople,
      trackActivity: g.trackActivity,
      trackFiles: g.trackFiles,
      goal: g.goal,
      systemType: g.system,
      domainContext: g.domain,
    });
    setBuildState((s) => patchIndustryFields(s, { buildIntent: nextIntent }));
    setError(null);
  }, [buildState.industryName, buildState.guidedDraft]);

  const runReviewModules = useCallback(async () => {
    setError(null);
    setSelectionError(null);
    setSuccess(null);
    setSteps([]);
    setQualityGate(null);
    const trimmed = buildState.industryName.trim();
    if (!trimmed) {
      setError("Enter an industry name.");
      return;
    }
    setPreviewBusy(true);
    try {
      const r = await previewIndustryModuleComposition({
        industryName: trimmed,
        buildIntent: buildState.buildIntent.trim(),
        guidedModuleSignals: getGuidedModuleSignalsForApi(buildState),
      });
      if (!r || typeof r !== "object") {
        setError("Could not analyze modules.");
        return;
      }
      if (r.ok !== true) {
        setError(typeof r.error === "string" ? r.error : "Could not analyze modules.");
        return;
      }
      const base = patchIndustryFields(buildState, {
        industryName: trimmed,
        buildIntent: buildState.buildIntent.trim(),
      });
      const applied = applyAnalyzerToWorkflowBuildState(base, /** @type {Record<string, unknown>} */ (r));
      if (!applied.ok) {
        setError(applied.error);
        return;
      }
      setBuildState(applied.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewBusy(false);
    }
  }, [buildState]);

  const toggleModule = useCallback((id) => {
    setBuildState((prev) => patchModuleSelectionToggle(prev, id, !prev.moduleSelectionById[id]));
    setSelectionError(null);
  }, []);

  const selectedIds = useCallback(
    () => MODULE_SELECTION_ORDER.filter((id) => buildState.moduleSelectionById[id]),
    [buildState.moduleSelectionById],
  );

  const goClarifyToSelect = useCallback(() => {
    const out = transitionClarifyToSelect(buildState);
    if (!out.ok) {
      setSelectionError(out.error);
      return;
    }
    setSelectionError(null);
    setBuildState(out.state);
  }, [buildState]);

  const goToConfirm = useCallback(() => {
    const out = transitionSelectToConfirm(buildState);
    if (!out.ok) {
      setSelectionError(out.error);
      return;
    }
    setSelectionError(null);
    setBuildState(out.state);
  }, [buildState]);

  const goBackToInput = useCallback(() => {
    setBuildState((s) => transitionBackToInput(s));
    setSelectionError(null);
  }, []);

  const goBackToClarify = useCallback(() => {
    setBuildState((s) => transitionBackToClarify(s));
    setSelectionError(null);
  }, []);

  const goBackToSelect = useCallback(() => {
    setBuildState((s) => transitionBackToSelect(s));
    setSelectionError(null);
  }, []);

  const runBuild = useCallback(async () => {
    setError(null);
    setSuccess(null);
    setSteps([]);
    setQualityGate(null);
    const trimmed = buildState.industryName.trim();
    if (!trimmed) {
      setError("Enter an industry name.");
      return;
    }
    const ids = MODULE_SELECTION_ORDER.filter((id) => buildState.moduleSelectionById[id]);
    const err = validateWorkflowModuleSelection(ids);
    if (err) {
      setError(err);
      setBuildState((s) => ({ ...s, step: "select" }));
      return;
    }
    setBuildState((s) => transitionConfirmToBuild(s));
    setBusy(true);
    try {
      const r = await createIndustryFromInput({
        industryName: trimmed,
        buildIntent: buildState.buildIntent.trim(),
        selectedModules: ids,
      });
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
          resetFlowAfterSuccess();
        } else if (r.needsUserDecision === true && r.report && typeof r.report === "object") {
          const rep = /** @type {{ overallScore?: number, rating?: string }} */ (r.report);
          const pct = typeof rep.overallScore === "number" ? rep.overallScore : "?";
          const rate = typeof rep.rating === "string" ? rep.rating : "unknown";
          setQualityGate({ slug: r.slug, report: r.report });
          setSuccess(
            `Pack built: ${r.slug}. Coverage ${pct}% (${rate}) — review the quality report and choose whether to activate.`,
          );
          await reloadPacks(r.slug);
          resetFlowAfterSuccess();
        } else {
          setError("Build finished but activation could not be determined.");
          setBuildState((s) => (s.step === "build" ? { ...s, step: "confirm" } : s));
        }
      } else {
        setError(typeof r?.error === "string" ? r.error : "Build did not complete.");
        setBuildState((s) => (s.step === "build" ? { ...s, step: "confirm" } : s));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBuildState((s) => (s.step === "build" ? { ...s, step: "confirm" } : s));
    } finally {
      setBusy(false);
    }
  }, [buildState.industryName, buildState.buildIntent, buildState.moduleSelectionById, reloadPacks, activatePack, onCreated, resetFlowAfterSuccess]);

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

  const panelClass = ["create-industry-panel", "card", className].filter(Boolean).join(" ");

  const preview = buildState.analysisSnapshot;

  const modulesMeta =
    preview && typeof preview.modulesMeta === "object" && preview.modulesMeta !== null
      ? /** @type {Record<string, { title: string, description: string }>} */ (preview.modulesMeta)
      : {};

  const detectedList = preview && Array.isArray(preview.detectedModules) ? preview.detectedModules : [];
  const suggestedList =
    preview && Array.isArray(preview.suggestedModules) ? preview.suggestedModules : [];
  const domainIntro =
    preview && preview.domainIntro && typeof preview.domainIntro === "object"
      ? /** @type {{ id: string, text: string }} */ (preview.domainIntro)
      : null;

  const clarificationIntro =
    typeof preview?.clarificationIntro === "string" ? preview.clarificationIntro : CLARIFICATION_INTRO;
  const clarificationOptions = Array.isArray(preview?.clarificationOptions)
    ? preview.clarificationOptions
    : [];
  const clarificationOptionsProgressive = Array.isArray(preview?.clarificationOptionsProgressive)
    ? preview.clarificationOptionsProgressive
    : [];
  const clarifyRows =
    clarificationOptionsProgressive.length > 0 ? clarificationOptionsProgressive : clarificationOptions;
  const clarificationReason =
    typeof preview?.clarificationReason === "string" ? preview.clarificationReason : "";
  const clarificationDetail =
    preview?.clarificationDetail && typeof preview.clarificationDetail === "object"
      ? /** @type {{ missingModules?: string[], modulesToResolve?: string[], matchedDomainIds?: string[], matchedPresetId?: string | null, primaryDomainId?: string | null, minimalInput?: boolean, vagueIntent?: boolean, continuationSummary?: string }} */ (
          preview.clarificationDetail
        )
      : null;
  const modulesToResolve = Array.isArray(clarificationDetail?.modulesToResolve)
    ? clarificationDetail.modulesToResolve
    : [];
  const continuationSummary =
    typeof clarificationDetail?.continuationSummary === "string" ? clarificationDetail.continuationSummary : "";
  const vagueIntent = clarificationDetail?.vagueIntent === true;
  const affirmedModuleIds = Array.isArray(buildState.affirmedModuleIds) ? buildState.affirmedModuleIds : [];
  const clarificationWhy =
    clarificationReason === "no_signal"
      ? "We couldn’t infer capabilities from your wording alone—nothing was detected and no domain matched."
      : clarificationReason === "missing_expected_modules"
        ? "Keyword detection didn’t cover everything we usually expect for this kind of workflow."
        : clarificationReason === "ambiguous_input"
          ? vagueIntent
            ? "What you described is too generic to map safely—please confirm who or what you’re tracking and which capabilities apply."
            : "Your description is very short, or it could fit more than one kind of system—please confirm what you need."
          : "";

  const inputLocked = busy || previewBusy;
  const canReview = net?.connected && buildState.industryName.trim().length > 0 && !inputLocked;

  return (
    <section className={panelClass} aria-labelledby="create-industry-heading">
      <h2 id="create-industry-heading" className="create-industry-title">
        Create Your Category
      </h2>

      <div className="create-industry-intro">
        <p>
          If you don’t have a category yet—or you want a fresh one shaped around what you do—we’ll build one from the
          name you give, after you confirm which workflow modules you want.
        </p>
        <p>
          When your description doesn’t match clear signals, we’ll ask a short set of questions—nothing is assumed or
          auto-selected without you.
        </p>
        <p>You get a real starting point you can refine anytime, instead of staring at a blank page.</p>
        <p>
          First check that we’re online, then describe what you’re aiming for. You’ll review modules, adjust the
          selection, and confirm before any build runs.
        </p>
        <p>
          Think of me as your launchpad—not as legal, medical, or compliance advice, where your own experts still need
          the final say.
        </p>
      </div>

      <div className="create-industry-net">
        <p className="create-industry-net-label">Connection</p>
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

      {buildState.step === "input" || buildState.step === "guided" ? (
        <div className="create-industry-entry" role="group" aria-label="How to enter your category">
          <p className="create-industry-entry-label">How would you like to start?</p>
          <div className="create-industry-entry-toggle">
            <button
              type="button"
              className={
                buildState.entryPath === "input"
                  ? "btn btn-primary create-industry-entry-btn create-industry-entry-btn--active"
                  : "btn btn-secondary create-industry-entry-btn"
              }
              aria-pressed={buildState.entryPath === "input"}
              disabled={inputLocked}
              onClick={() => setBuildState((s) => transitionChooseEntryPath(s, "input"))}
            >
              Type what you want
            </button>
            <button
              type="button"
              className={
                buildState.entryPath === "guided"
                  ? "btn btn-primary create-industry-entry-btn create-industry-entry-btn--active"
                  : "btn btn-secondary create-industry-entry-btn"
              }
              aria-pressed={buildState.entryPath === "guided"}
              disabled={inputLocked}
              onClick={() => setBuildState((s) => transitionChooseEntryPath(s, "guided"))}
            >
              Guide me
            </button>
          </div>
          <p className="create-industry-entry-note">
            {buildState.entryPath === "guided"
              ? "Guided Build fills a plain-language description. It is not a shortcut: Review modules still runs the same analyzer, and you still confirm every module before build."
              : "Write freely; the next step analyzes keywords and domain hints like any other description."}
          </p>
        </div>
      ) : null}

      <label className="create-industry-label" htmlFor="create-industry-name">
        Category name
      </label>
      <input
        id="create-industry-name"
        className="create-industry-input"
        type="text"
        placeholder="e.g. Veterinary clinic, Coffee roasting, Municipal permits"
        value={buildState.industryName}
        disabled={inputLocked}
        onChange={(e) => setBuildState((s) => patchIndustryFields(s, { industryName: e.target.value }))}
      />

      {(buildState.step === "input" || buildState.step === "guided") && buildState.entryPath === "guided" ? (
        <div className="create-industry-guided">
          <h3 className="create-industry-guided-heading">Guided questions</h3>
          <p className="create-industry-guided-lead">
            Each choice below maps to wording the analyzer understands (people, activity, files, domain). Nothing here
            turns modules on—you still review and confirm them afterward.
          </p>

          <fieldset className="create-industry-guided-fieldset">
            <legend className="create-industry-guided-legend">What do you want to track?</legend>
            <ul className="create-industry-guided-list">
              {GUIDED_TRACK_CHOICES.map((row) => {
                const g = buildState.guidedDraft;
                const checked =
                  row.key === "trackPeople"
                    ? g.trackPeople
                    : row.key === "trackActivity"
                      ? g.trackActivity
                      : g.trackFiles;
                const onChange =
                  row.key === "trackPeople"
                    ? () => setBuildState((s) => patchGuidedDraft(s, { trackPeople: !s.guidedDraft.trackPeople }))
                    : row.key === "trackActivity"
                      ? () =>
                          setBuildState((s) => patchGuidedDraft(s, { trackActivity: !s.guidedDraft.trackActivity }))
                      : () => setBuildState((s) => patchGuidedDraft(s, { trackFiles: !s.guidedDraft.trackFiles }));
                const id = `guided-track-${row.key}`;
                return (
                  <li key={row.key} className="create-industry-guided-item">
                    <input type="checkbox" id={id} checked={checked} disabled={inputLocked} onChange={onChange} />
                    <label htmlFor={id}>
                      <strong>{row.label}</strong>
                      <span className="create-industry-module-reason">→ {row.moduleHint}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <fieldset className="create-industry-guided-fieldset">
            <legend className="create-industry-guided-legend">What is your goal?</legend>
            <ul className="create-industry-guided-list">
              {GUIDED_GOAL_CHOICES.map((row) => {
                const id = `guided-goal-${row.value}`;
                return (
                  <li key={row.value || "none"} className="create-industry-guided-item">
                    <input
                      type="radio"
                      id={id}
                      name="guided-goal"
                      checked={buildState.guidedDraft.goal === row.value}
                      disabled={inputLocked}
                      onChange={() => setBuildState((s) => patchGuidedDraft(s, { goal: row.value }))}
                    />
                    <label htmlFor={id}>{row.label}</label>
                  </li>
                );
              })}
              <li className="create-industry-guided-item">
                <input
                  type="radio"
                  id="guided-goal-clear"
                  name="guided-goal"
                  checked={buildState.guidedDraft.goal === ""}
                  disabled={inputLocked}
                  onChange={() => setBuildState((s) => patchGuidedDraft(s, { goal: "" }))}
                />
                <label htmlFor="guided-goal-clear">No single primary goal (leave open)</label>
              </li>
            </ul>
          </fieldset>

          <fieldset className="create-industry-guided-fieldset">
            <legend className="create-industry-guided-legend">What type of system?</legend>
            <ul className="create-industry-guided-list">
              {GUIDED_SYSTEM_CHOICES.map((row) => {
                const id = `guided-sys-${row.value}`;
                return (
                  <li key={row.value} className="create-industry-guided-item">
                    <input
                      type="radio"
                      id={id}
                      name="guided-system"
                      checked={buildState.guidedDraft.system === row.value}
                      disabled={inputLocked}
                      onChange={() => setBuildState((s) => patchGuidedDraft(s, { system: row.value }))}
                    />
                    <label htmlFor={id}>{row.label}</label>
                  </li>
                );
              })}
              <li className="create-industry-guided-item">
                <input
                  type="radio"
                  id="guided-sys-clear"
                  name="guided-system"
                  checked={buildState.guidedDraft.system === ""}
                  disabled={inputLocked}
                  onChange={() => setBuildState((s) => patchGuidedDraft(s, { system: "" }))}
                />
                <label htmlFor="guided-sys-clear">Not sure yet</label>
              </li>
            </ul>
          </fieldset>

          <fieldset className="create-industry-guided-fieldset">
            <legend className="create-industry-guided-legend">Domain or industry context</legend>
            <ul className="create-industry-guided-list">
              {GUIDED_DOMAIN_CHOICES.map((row) => {
                const id = `guided-domain-${row.value || "general"}`;
                return (
                  <li key={row.value || "general"} className="create-industry-guided-item">
                    <input
                      type="radio"
                      id={id}
                      name="guided-domain"
                      checked={buildState.guidedDraft.domain === row.value}
                      disabled={inputLocked}
                      onChange={() => setBuildState((s) => patchGuidedDraft(s, { domain: row.value }))}
                    />
                    <label htmlFor={id}>{row.label}</label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <div className="create-industry-guided-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={inputLocked}
              onClick={applyGuidedAnswersToDescription}
            >
              Apply answers to description
            </button>
          </div>
        </div>
      ) : null}

      <label className="create-industry-label" htmlFor="create-industry-intent">
        {buildState.entryPath === "guided" && (buildState.step === "input" || buildState.step === "guided")
          ? "Description for analysis (edit after applying answers if needed)"
          : "Describe what you want to build"}{" "}
        <span className="create-industry-optional">(optional)</span>
      </label>
      <textarea
        id="create-industry-intent"
        className="create-industry-input create-industry-textarea"
        placeholder="e.g. I want a fitness tracker with progress photos"
        value={buildState.buildIntent}
        disabled={inputLocked}
        rows={3}
        onChange={(e) => setBuildState((s) => patchIndustryFields(s, { buildIntent: e.target.value }))}
      />

      {buildState.step === "input" || buildState.step === "guided" ? (
        <div className="create-industry-actions">
          <button
            type="button"
            className="btn btn-primary create-industry-build"
            disabled={!canReview}
            onClick={() => void runReviewModules()}
          >
            {previewBusy ? "Analyzing…" : "Review modules"}
          </button>
        </div>
      ) : null}

      {buildState.step === "clarify" && preview?.ok === true ? (
        <div className="create-industry-module-flow">
          <h3>{clarificationIntro}</h3>
          {continuationSummary ? (
            <p className="create-industry-clarify-continuation" role="status">
              {continuationSummary}
            </p>
          ) : null}
          {clarificationWhy ? (
            <p className="create-industry-clarify-why" role="status">
              <strong>Why we’re asking:</strong> {clarificationWhy}
            </p>
          ) : null}
          {modulesToResolve.length === 1 ? (
            <p className="create-industry-clarify-focus">
              <strong>Still to confirm:</strong>{" "}
              {modulesMeta[modulesToResolve[0]]?.title ?? modulesToResolve[0]}
            </p>
          ) : null}
          <p>
            {clarifyRows.length < clarificationOptions.length
              ? "Only the capabilities below still need a yes/no from you—we’re not repeating what’s already settled."
              : "Each option maps to one workflow capability. Choose any that apply—none are turned on until you check them."}
          </p>
          <ul className="create-industry-module-list">
            {clarifyRows.map((row) => {
              const id = typeof row.moduleId === "string" ? row.moduleId : "";
              const shortLabel = typeof row.shortLabel === "string" ? row.shortLabel : id;
              const desc = typeof row.description === "string" ? row.description : "";
              return (
                <li key={`cl-${id}`} className="create-industry-module-item">
                  <input
                    type="checkbox"
                    id={`clarify-${id}`}
                    checked={!!buildState.moduleSelectionById[id]}
                    onChange={() => toggleModule(id)}
                  />
                  <label htmlFor={`clarify-${id}`}>
                    <strong>{shortLabel}</strong>
                    <span className="create-industry-module-reason">→ {id}</span>
                    {desc ? <span>{desc}</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
          {selectionError ? (
            <p className="create-industry-error" role="alert">
              {selectionError}
            </p>
          ) : null}
          <div className="create-industry-flow-actions">
            <button type="button" className="btn btn-secondary" onClick={goBackToInput}>
              Back to details
            </button>
            <button type="button" className="btn btn-primary" onClick={goClarifyToSelect}>
              Continue to module selection
            </button>
          </div>
        </div>
      ) : null}

      {buildState.step === "select" && preview?.ok === true ? (
        <div className="create-industry-module-flow">
          <h3>These are the modules we selected based on your request:</h3>
          <p>
            Checked items may reflect keyword detection, domain suggestions, or answers you gave in the previous step.
            Nothing is final until you confirm below.
          </p>
          {domainIntro && suggestedList.length > 0 ? (
            <p>
              <strong>Suggested modules you may want to include:</strong> {domainIntro.text}
            </p>
          ) : null}

          <h3>Please select the modules you would like to use</h3>
          <p>Turn modules on or off. Only checked modules are written into your pack.</p>
          <ul className="create-industry-module-list">
            {MODULE_SELECTION_ORDER.map((id) => {
              const meta = modulesMeta[id];
              const title = meta?.title ?? id;
              const desc = meta?.description ?? "";
              const inDetected = detectedList.includes(id);
              const sugRow = suggestedList.find((s) => s.moduleId === id);
              const fromSuggestion = !!sugRow;
              const reason = sugRow && typeof sugRow.reason === "string" ? sugRow.reason : "";
              const fromGuidedAffirmed = affirmedModuleIds.includes(id) && !inDetected;
              const fromClarify =
                buildState.needsClarification === true &&
                buildState.clarificationSeedModuleIds.includes(id) &&
                !inDetected &&
                !fromSuggestion;
              const tag = fromClarify
                ? "From your answers"
                : fromGuidedAffirmed
                  ? "From guided answers"
                  : inDetected && fromSuggestion
                    ? "Detected · also suggested"
                    : inDetected
                      ? "Detected from keywords"
                      : fromSuggestion
                        ? "Suggested"
                        : "Optional";
              return (
                <li key={`sel-${id}`} className="create-industry-module-item">
                  <input
                    type="checkbox"
                    id={`mod-${id}`}
                    checked={!!buildState.moduleSelectionById[id]}
                    onChange={() => toggleModule(id)}
                  />
                  <label htmlFor={`mod-${id}`}>
                    <strong>
                      {title}{" "}
                      <span style={{ fontSize: "0.72rem", fontWeight: 500, color: "var(--text-muted, #6b7280)" }}>
                        ({tag})
                      </span>
                    </strong>
                    <span>{desc}</span>
                    {fromSuggestion && reason && !inDetected ? (
                      <span className="create-industry-module-reason">{reason}</span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>

          {selectionError ? (
            <p className="create-industry-error" role="alert">
              {selectionError}
            </p>
          ) : null}

          <div className="create-industry-flow-actions">
            {buildState.needsClarification === true ? (
              <button type="button" className="btn btn-secondary" onClick={goBackToClarify}>
                Back to questions
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={goBackToInput}>
                Back to details
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={goToConfirm}>
              Continue to confirmation
            </button>
          </div>
        </div>
      ) : null}

      {buildState.step === "confirm" && preview?.ok === true ? (
        <div className="create-industry-module-flow">
          <h3>Are you sure you want to build this system?</h3>
          <p>These are the modules selected for your system. The pack is generated only after you confirm.</p>
          <div className="create-industry-confirm-summary">
            <strong>Selected modules</strong>
            <ul>
              {selectedIds().map((id) => {
                const meta = modulesMeta[id];
                return (
                  <li key={`cf-${id}`}>
                    <strong>{meta?.title ?? id}</strong> — {meta?.description ?? ""}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="create-industry-flow-actions">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={goBackToSelect}>
              Back to module selection
            </button>
            <button
              type="button"
              className="btn btn-primary create-industry-build"
              disabled={busy || !net?.connected}
              onClick={() => void runBuild()}
            >
              {busy ? "Running pipeline…" : "Confirm and build industry pack"}
            </button>
          </div>
        </div>
      ) : null}

      {(buildState.step === "input" || buildState.step === "guided") && error ? (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: "0.5rem" }}
          disabled={!canReview}
          onClick={() => void runReviewModules()}
        >
          Retry
        </button>
      ) : null}

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

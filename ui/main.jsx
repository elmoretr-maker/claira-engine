import "./styles/designSystem.css";
import "../adapters/mockExternalAdapter.js";
import { isRealExternalIntegrationReady } from "../core/integrationAvailability.js";
import { REAL_MODE_INTEGRATION_REQUIRED_MESSAGE } from "./formatPipelineError.js";
import "../core/integrationEngine.js";
import "../core/intentEngine.js";
import { SYSTEM_MODE } from "../core/systemMode.js";
import "../outputs/externalOutput.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  applyDecision,
  ensureCapabilityOutputFolders,
  getPackProcesses,
  getPackReference,
  getRiskInsights,
  getRooms,
  getSuggestions,
} from "../interfaces/api.js";
import SimulationPanel from "./components/SimulationPanel.jsx";
import WorkflowStatus from "./components/WorkflowStatus.jsx";
import Entrance from "./Entrance.jsx";
import ProcessingScreen from "./screens/ProcessingScreen.jsx";
import RoomsDashboard from "./screens/RoomsDashboard.jsx";
import SuggestionsPanel from "./screens/SuggestionsPanel.jsx";
import SessionReport from "./screens/SessionReport.jsx";
import { compareSessionWorkflow } from "./sessionWorkflowCompare.js";
import WaitingRoom from "./screens/WaitingRoom.jsx";
import IndustrySelector from "./components/IndustrySelector.jsx";
import IndustryFeaturePrompt from "./components/IndustryFeaturePrompt.jsx";
import IndustryFeaturesSettings from "./components/IndustryFeaturesSettings.jsx";
import ProgressTracker from "./components/ProgressTracker.jsx";
import LogsView from "./components/LogsView.jsx";
import ProductWorkspacePanel from "./components/ProductWorkspacePanel.jsx";
import RiskInsightsBanner from "./components/RiskInsightsBanner.jsx";
import CapabilityScreen from "./screens/CapabilityScreen.jsx";
import TunnelScreen from "./screens/TunnelScreen.jsx";
import { IndustryProvider, useIndustry } from "./IndustryContext.jsx";
import { isReviewPipelineRow } from "./pipelineRowUtils.js";
import { buildTunnelSteps, fingerprintSelectedCaps, normalizeStoredTunnelSteps } from "./tunnelSteps.js";
import {
  bumpSetupConflictsResolved,
  getAppMode,
  getOversightLevel,
  getSelectedCapabilities,
  getTunnelManifestRaw,
  getResolvedTunnelStepCount,
  getTunnelGranular,
  getTunnelStepIndex,
  maybeCompleteSetupAfterSession,
  setAppMode,
  setOversightLevel,
  STORAGE_INDUSTRY,
  isProgressTrackingUiEnabled,
} from "./userPrefs.js";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

const AUTO_CHECK_INTERVAL = 60000; // 60 seconds

/**
 * @param {string} slug
 * @param {string} packLabel
 */
function formatPackDisplayTitle(slug, packLabel) {
  const l = String(packLabel ?? "").trim();
  if (l) return l;
  return String(slug ?? "")
    .split(/[-_]/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function getIndustryGateInitiallyDone() {
  try {
    return Boolean(localStorage.getItem(STORAGE_INDUSTRY));
  } catch {
    return false;
  }
}

/**
 * @returns {"capabilities" | "tunnel" | "entrance"}
 */
function getSetupEntryScreen() {
  if (getAppMode() !== "setup") return "entrance";
  const sel = getSelectedCapabilities();
  const step = getTunnelStepIndex();
  if (sel.length === 0) return "capabilities";
  if (step < getResolvedTunnelStepCount(sel)) return "tunnel";
  return "entrance";
}

/**
 * @param {string[]} expectedItems
 * @param {unknown[]} pipelineResults
 */
function hasWorkflowMonitorInputs(expectedItems, pipelineResults) {
  const userExp =
    Array.isArray(expectedItems) &&
    expectedItems.some((s) => typeof s === "string" && s.trim().length > 0);
  const hasRows = Array.isArray(pipelineResults) && pipelineResults.length > 0;
  return userExp || hasRows;
}

const suggestionsStripStyle = {
  padding: "0 1.5rem 2rem",
  background: "#0f1115",
  borderTop: "1px solid #2d3340",
};

const refreshSuggestionsBtnStyle = {
  marginBottom: "0.75rem",
  padding: "0.5rem 1rem",
  borderRadius: "8px",
  fontSize: "0.88rem",
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid #4b5563",
  background: "#2d3340",
  color: "#e8eaed",
};

/**
 * @param {unknown} row
 * @returns {{ file: string, reason: string, priority: string, score?: number }}
 */
function pipelineRowToWaitingRoomItem(row) {
  const r = /** @type {Record<string, unknown>} */ (row);
  let reason = typeof r.reason === "string" ? r.reason : "";
  if (!reason && r.room_validation != null) reason = "rejected_by_room";
  if (!reason && r.place_card && typeof r.place_card === "object") {
    const pr = /** @type {Record<string, unknown>} */ (r.place_card).reason;
    if (pr != null) reason = String(pr);
  }
  if (!reason && r.error != null) reason = String(r.error);
  if (!reason) reason = "review";

  const file = typeof r.rel === "string" ? r.rel : "(unknown)";
  const cc = r.classification_conflict;
  /** @type {Record<string, unknown> | undefined} */
  let conflict =
    cc && typeof cc === "object" && /** @type {Record<string, unknown>} */ (cc).kind === "classification_conflict"
      ? /** @type {Record<string, unknown>} */ (cc)
      : undefined;

  let score;
  const rv = r.room_validation;
  if (rv && typeof rv === "object" && typeof /** @type {Record<string, unknown>} */ (rv).score === "number") {
    score = /** @type {number} */ (/** @type {Record<string, unknown>} */ (rv).score);
  }

  const p = r.priority;
  const priority = p === "high" || p === "medium" || p === "low" ? p : "low";

  const base = { file, reason, priority };
  if (conflict?.filePath != null) {
    /** @type {{ file: string, reason: string, priority: string, score?: number, filePath?: string, classification_conflict?: Record<string, unknown> }} */
    const ext = { ...base, filePath: String(conflict.filePath), classification_conflict: conflict };
    if (score != null) ext.score = score;
    return ext;
  }
  if (score != null) return { ...base, score };
  return base;
}

/**
 * @param {{
 *   suggestions: unknown[],
 *   onRefresh: () => void | Promise<void>,
 * }} props
 */
function SuggestionsStrip({ suggestions, onRefresh }) {
  return (
    <div style={suggestionsStripStyle}>
      <button type="button" style={refreshSuggestionsBtnStyle} onClick={() => void onRefresh()}>
        Refresh Suggestions
      </button>
      <SuggestionsPanel suggestions={suggestions} />
    </div>
  );
}

function App() {
  const { industrySlug } = useIndustry();
  const [industryGateDone, setIndustryGateDone] = useState(getIndustryGateInitiallyDone);

  const [appMode, setAppModeState] = useState(getAppMode);
  const [oversightLevel, setOversightLevelState] = useState(getOversightLevel);

  const returnFromLogsRef = useRef(
    /** @type {"entrance" | "processing" | "report" | "rooms" | "waiting" | "capabilities" | "tunnel" | "progress" | "workspace"} */ (
      "entrance"
    ),
  );
  const workspaceReturnRef = useRef(
    /** @type {"entrance" | "processing" | "report" | "rooms" | "waiting" | "logs" | "capabilities" | "tunnel" | "progress"} */ (
      "entrance"
    ),
  );

  const [screen, setScreen] = useState(
    /** @type {"entrance" | "processing" | "report" | "rooms" | "waiting" | "logs" | "capabilities" | "tunnel" | "progress" | "workspace"} */ (
      "entrance"
    ),
  );
  const [progressFocusCategory, setProgressFocusCategory] = useState(/** @type {string} */ (""));
  const [intakePayload, setIntakePayload] = useState(/** @type {null | Record<string, unknown>} */ (null));
  const [sessionSummary, setSessionSummary] = useState(
    /** @type {{ processed: number, moved: number, review: number } | null} */ (null),
  );
  const [pipelineResults, setPipelineResults] = useState(/** @type {unknown[]} */ ([]));
  const [rooms, setRooms] = useState(/** @type {{ name: string, destination: string }[]} */ ([]));
  const [reviewItems, setReviewItems] = useState(/** @type {unknown[]} */ ([]));
  const [suggestions, setSuggestions] = useState(/** @type {unknown[]} */ ([]));
  const [expectedItems, setExpectedItems] = useState(/** @type {string[]} */ ([]));
  const [packCategoryUi, setPackCategoryUi] = useState(
    /** @type {Record<string, { label: string, description: string }>} */ ({}),
  );
  const [packGrouping, setPackGrouping] = useState(
    /** @type {{ groups: Record<string, { label?: string, description?: string, categories?: string[] }>, groupOrder: string[] }} */ ({
      groups: {},
      groupOrder: [],
    }),
  );
  const [packProcesses, setPackProcesses] = useState(/** @type {Record<string, unknown>} */ ({}));
  const [tunnelPlanRev, setTunnelPlanRev] = useState(0);
  const [riskInsights, setRiskInsights] = useState(/** @type {Record<string, unknown> | null} */ (null));
  const [tunnelCategoryScope, setTunnelCategoryScope] = useState(/** @type {string[] | null} */ (null));
  const [packUx, setPackUx] = useState(
    /** @type {{ label: string, inputVerb: string, intents: Array<{ value: string, label: string }> }} */ ({
      label: "",
      inputVerb: "",
      intents: [],
    }),
  );

  const tunnelStep = getTunnelStepIndex();
  const tunnelSteps = useMemo(() => {
    const sel = getSelectedCapabilities();
    const granular = getTunnelGranular();
    const manifest = getTunnelManifestRaw();
    if (manifest?.fingerprint === fingerprintSelectedCaps(sel) && Array.isArray(manifest.steps)) {
      return normalizeStoredTunnelSteps(manifest.steps);
    }
    return buildTunnelSteps(sel, packGrouping.groups, packGrouping.groupOrder, granular, packCategoryUi);
  }, [packGrouping, packCategoryUi, tunnelPlanRev, industrySlug, screen]);
  const tunnelIncomplete =
    industryGateDone &&
    appMode === "setup" &&
    tunnelSteps.length > 0 &&
    tunnelStep < tunnelSteps.length;

  useEffect(() => {
    if (!industryGateDone) return;
    setScreen(getSetupEntryScreen());
  }, [industryGateDone]);

  useEffect(() => {
    if (!industryGateDone) return;
    let cancelled = false;
    void (async () => {
      try {
        const [p, proc] = await Promise.all([
          getPackReference(),
          getPackProcesses({ industry: industrySlug }),
        ]);
        const cats = p?.categories && typeof p.categories === "object" ? p.categories : {};
        /** @type {Record<string, { label: string, description: string }>} */
        const m = {};
        for (const k of Object.keys(cats)) {
          const c = /** @type {{ label?: string, description?: string }} */ (cats[k]);
          m[k] = {
            label: typeof c?.label === "string" ? c.label : k,
            description: typeof c?.description === "string" ? c.description : "",
          };
        }
        const groups = p?.groups && typeof p.groups === "object" ? p.groups : {};
        const groupOrder = Array.isArray(p?.groupOrder) ? p.groupOrder : [];
        const processes =
          proc?.processes && typeof proc.processes === "object" && !Array.isArray(proc.processes)
            ? proc.processes
            : {};
        const pk = p?.pack && typeof p.pack === "object" ? p.pack : {};
        const pl = typeof pk.label === "string" ? pk.label.trim() : "";
        const iv = typeof pk.inputVerb === "string" ? pk.inputVerb.trim() : "";
        const intents = Array.isArray(pk.intents) ? pk.intents : [];
        if (!cancelled) {
          setPackCategoryUi(m);
          setPackGrouping({ groups, groupOrder });
          setPackProcesses(processes);
          setPackUx({
            label: pl,
            inputVerb: iv,
            intents: intents.filter(
              (it) =>
                it &&
                typeof it === "object" &&
                typeof /** @type {{ value?: unknown }} */ (it).value === "string" &&
                typeof /** @type {{ label?: unknown }} */ (it).label === "string",
            ),
          });
        }
      } catch {
        if (!cancelled) {
          setPackCategoryUi({});
          setPackGrouping({ groups: {}, groupOrder: [] });
          setPackProcesses({});
          setPackUx({ label: "", inputVerb: "", intents: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [industryGateDone, industrySlug]);

  const refreshSuggestions = useCallback(async () => {
    try {
      const resp = await getSuggestions();
      setSuggestions(Array.isArray(resp?.suggestions) ? resp.suggestions : []);
    } catch {
      setSuggestions([]);
    }
  }, []);

  const refreshRiskInsights = useCallback(async () => {
    try {
      const data = await getRiskInsights();
      setRiskInsights(data && typeof data === "object" ? /** @type {Record<string, unknown>} */ (data) : null);
    } catch {
      setRiskInsights(null);
    }
  }, []);

  useEffect(() => {
    if (!industryGateDone) return;
    void refreshRiskInsights();
  }, [industryGateDone, industrySlug, refreshRiskInsights]);

  useEffect(() => {
    if (screen !== "tunnel") setTunnelCategoryScope(null);
  }, [screen]);

  const loadRoomsAndGoToRooms = async () => {
    try {
      const r = await getRooms();
      setRooms(Array.isArray(r?.rooms) ? r.rooms : []);
    } catch {
      setRooms([]);
    }
    setScreen("rooms");
  };

  const [workflowResult, setWorkflowResult] = useState(() => compareSessionWorkflow([], []));

  useEffect(() => {
    const refresh = () => {
      setWorkflowResult(compareSessionWorkflow(expectedItems, pipelineResults));
    };

    refresh();

    if (!hasWorkflowMonitorInputs(expectedItems, pipelineResults)) {
      return;
    }

    const id = window.setInterval(refresh, AUTO_CHECK_INTERVAL);
    return () => window.clearInterval(id);
  }, [expectedItems, pipelineResults]);

  const workflowAutoCheckActive = hasWorkflowMonitorInputs(expectedItems, pipelineResults);

  const showRealIntegrationGap = SYSTEM_MODE === "real" && !isRealExternalIntegrationReady();

  if (!industryGateDone) {
    return (
      <IndustrySelector
        onLoaded={() => {
          setIndustryGateDone(true);
        }}
      />
    );
  }

  const workflowTopBar = (
    <header className="app-workflow-top-bar">
      <div className="app-workflow-top-bar-inner">
        <div className="app-workflow-top-bar-row">
          {SYSTEM_MODE === "simulation" ? (
            <span className="simulation-mode-badge">Simulation Mode Active</span>
          ) : showRealIntegrationGap ? (
            <span className="real-integration-gap-banner" role="status">
              {REAL_MODE_INTEGRATION_REQUIRED_MESSAGE}
            </span>
          ) : null}
          <div className="app-workflow-top-bar-tools">
            {screen !== "workspace" ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  workspaceReturnRef.current = screen;
                  setScreen("workspace");
                }}
              >
                Workspace
              </button>
            ) : null}
            {screen !== "logs" ? (
              <button
                type="button"
                className="btn btn-secondary app-move-logs-btn"
                onClick={() => {
                  returnFromLogsRef.current = screen;
                  setScreen("logs");
                }}
              >
                Move logs
              </button>
            ) : null}
            {isProgressTrackingUiEnabled(industrySlug) ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setProgressFocusCategory("");
                  setScreen("progress");
                }}
              >
                Progress tracking
              </button>
            ) : null}
            {workflowAutoCheckActive ? (
              <span className="app-workflow-auto-label">Auto-checking every 60s</span>
            ) : null}
            <WorkflowStatus workflowResult={workflowResult} />
          </div>
        </div>
               <details className="app-simulation-details">
          <summary>Simulated features (audit)</summary>
          <SimulationPanel />
        </details>
        {screen !== "logs" && screen !== "capabilities" && screen !== "workspace" ? (
          <RiskInsightsBanner
            insights={riskInsights}
            categoryFilter={screen === "tunnel" ? tunnelCategoryScope : null}
          />
        ) : null}
        <IndustryFeaturePrompt
          industrySlug={industrySlug}
          industryDisplayLabel={formatPackDisplayTitle(industrySlug, packUx.label)}
        />
        <IndustryFeaturesSettings industrySlug={industrySlug} />
      </div>
    </header>
  );

  if (screen === "workspace") {
    return (
      <>
        {workflowTopBar}
        <div key={screen} className="app-screen-fade">
          <ProductWorkspacePanel
            industrySlug={industrySlug}
            packLabel={formatPackDisplayTitle(industrySlug, packUx.label)}
            onBack={() => setScreen(workspaceReturnRef.current)}
          />
        </div>
      </>
    );
  }

  if (screen === "progress") {
    return (
      <>
        {workflowTopBar}
        <div key={screen} className="app-screen-fade">
          <ProgressTracker
            industrySlug={industrySlug}
            packLabel={formatPackDisplayTitle(industrySlug, packUx.label)}
            initialCategoryKey={progressFocusCategory}
            onBack={() => {
              setProgressFocusCategory("");
              setScreen("entrance");
            }}
          />
        </div>
      </>
    );
  }

  if (screen === "capabilities") {
    return (
      <>
        {workflowTopBar}
        <div key={screen} className="app-screen-fade">
          <CapabilityScreen
            packProcesses={packProcesses}
            onContinue={(selected) => {
              setAppModeState(getAppMode());
              if (selected.length === 0) {
                setScreen("entrance");
                return;
              }
              void ensureCapabilityOutputFolders(selected).catch(() => {});
              setScreen("tunnel");
            }}
            onBack={() => setScreen("entrance")}
          />
        </div>
      </>
    );
  }

  if (screen === "tunnel") {
    return (
      <>
        {workflowTopBar}
        <div key={screen} className="app-screen-fade">
          <TunnelScreen
            steps={tunnelSteps}
            categoryUi={packCategoryUi}
            packProcesses={packProcesses}
            groupingMeta={packGrouping}
            onTunnelPlanChange={() => setTunnelPlanRev((n) => n + 1)}
            appMode={appMode}
            oversightLevel={oversightLevel}
            industrySlug={industrySlug}
            onStepCategoryKeys={setTunnelCategoryScope}
            progressTrackingEnabled={isProgressTrackingUiEnabled(industrySlug)}
            onOpenProgressTracker={(cat) => {
              setProgressFocusCategory(cat);
              setScreen("progress");
            }}
            onExitToEntrance={() => {
              setAppModeState(getAppMode());
              setScreen("entrance");
            }}
            onProcessingResults={(results) => {
              const derived = results.filter(isReviewPipelineRow).map(pipelineRowToWaitingRoomItem);
              setReviewItems((prev) => [...prev, ...derived]);
            }}
          />
        </div>
      </>
    );
  }

  if (screen === "entrance") {
    return (
      <>
        {workflowTopBar}
        <div key={screen} className="app-screen-fade">
          <Entrance
            key={industrySlug}
            appMode={appMode}
            oversightLevel={oversightLevel}
            industrySlug={industrySlug}
            packDisplayLabel={formatPackDisplayTitle(industrySlug, packUx.label)}
            intentOptions={packUx.intents.length > 0 ? packUx.intents : undefined}
            inputButtonLabel={packUx.inputVerb.trim() ? packUx.inputVerb : "Add files"}
            tunnelIncomplete={tunnelIncomplete}
            onResumeTunnel={() => setScreen("tunnel")}
            onEnterLearningMode={() => {
              setAppMode("setup");
              setAppModeState("setup");
              const sel = getSelectedCapabilities();
              const step = getTunnelStepIndex();
              if (sel.length === 0) setScreen("capabilities");
              else if (step < getResolvedTunnelStepCount(sel)) setScreen("tunnel");
              else setScreen("entrance");
            }}
            onOpenCapabilities={() => setScreen("capabilities")}
            onOversightLevelChange={(level) => {
              setOversightLevel(level);
              setOversightLevelState(level);
            }}
            expectedItems={expectedItems}
            onExpectedItemsChange={setExpectedItems}
            onApplyIntegrationFix={setExpectedItems}
            onStartProcessing={(payload) => {
              setIntakePayload(payload);
              setPipelineResults([]);
              setRooms([]);
              setReviewItems([]);
              setSuggestions([]);
              setSessionSummary(null);
              setScreen("processing");
            }}
          />
        </div>
      </>
    );
  }

  if (screen === "report") {
    return (
      <>
        {workflowTopBar}
        <div key={screen} className="app-screen-fade">
          <SessionReport
            summary={sessionSummary}
            results={pipelineResults}
            expectedItems={expectedItems}
            onBackToRooms={() => void loadRoomsAndGoToRooms()}
            onContinueToWaiting={reviewItems.length > 0 ? () => setScreen("waiting") : undefined}
            waitingItemCount={reviewItems.length}
          />
        </div>
      </>
    );
  }

  if (screen === "waiting") {
    return (
      <>
        {workflowTopBar}
        <div key={screen} className="app-screen-fade">
          <WaitingRoom
            reviewItems={reviewItems}
            categoryUi={packCategoryUi}
            onConflictResolved={(detail) => {
              void (async () => {
                try {
                  await applyDecision({
                    predicted_label: detail.predicted_label,
                    selected_label: detail.selected_label,
                    filePath: detail.filePath,
                    scope: detail.scope === "single" ? "single" : "global",
                  });
                  void refreshRiskInsights();
                  bumpSetupConflictsResolved();
                  setReviewItems((prev) =>
                    prev.filter(
                      (it) =>
                        !(
                          it &&
                          typeof it === "object" &&
                          /** @type {Record<string, unknown>} */ (it).classification_conflict &&
                          String(
                            /** @type {{ filePath?: string }} */ (
                              /** @type {Record<string, unknown>} */ (it).classification_conflict
                            ).filePath,
                          ) === String(detail.filePath) &&
                          String(
                            /** @type {{ predicted_label?: string }} */ (
                              /** @type {Record<string, unknown>} */ (it).classification_conflict
                            ).predicted_label,
                          ) === String(detail.predicted_label)
                        ),
                    ),
                  );
                } catch (e) {
                  console.error(e);
                }
              })();
            }}
            onContinueToRooms={() => {
              void loadRoomsAndGoToRooms();
            }}
          />
          <SuggestionsStrip suggestions={suggestions} onRefresh={refreshSuggestions} />
        </div>
      </>
    );
  }

  if (screen === "logs") {
    return (
      <>
        {workflowTopBar}
        <div key={screen} className="app-screen-fade app-screen-fade--logs">
          <LogsView onBack={() => setScreen(returnFromLogsRef.current)} />
        </div>
      </>
    );
  }

  if (screen === "rooms") {
    return (
      <>
        {workflowTopBar}
        <div key={screen} className="app-screen-fade">
          <RoomsDashboard
            rooms={rooms}
            results={pipelineResults}
            onBackToProcessing={() => {
              setScreen("processing");
            }}
            onBackToEntrance={() => {
              setScreen("entrance");
              setIntakePayload(null);
              setSessionSummary(null);
            }}
            onSessionReport={
              pipelineResults.length > 0 || sessionSummary != null ? () => setScreen("report") : undefined
            }
          />
          <SuggestionsStrip suggestions={suggestions} onRefresh={refreshSuggestions} />
        </div>
      </>
    );
  }

  const intentLabel =
    typeof intakePayload?.intentLabel === "string" ? intakePayload.intentLabel : "—";
  const settings =
    intakePayload?.settings && typeof intakePayload.settings === "object"
      ? /** @type {Record<string, unknown>} */ (intakePayload.settings)
      : undefined;

  return (
    <>
      {workflowTopBar}
      <div key={screen} className="app-screen-fade">
        <ProcessingScreen
          mode="folder"
          folderPath="references"
          ingestSource="file"
          ingestInput="references"
          entranceContext={{ intentLabel, settings }}
          runtimeContext={{ appMode, oversightLevel }}
          onBackToEntrance={() => {
            setScreen("entrance");
            setIntakePayload(null);
            setSessionSummary(null);
          }}
          onProcessingComplete={async (out) => {
            const results = Array.isArray(out.results) ? out.results : [];
            setPipelineResults(results);
            const derived = results.filter(isReviewPipelineRow).map(pipelineRowToWaitingRoomItem);
            setReviewItems(derived);

            setSessionSummary({
              processed: typeof out.processed === "number" ? out.processed : 0,
              moved: typeof out.moved === "number" ? out.moved : 0,
              review: typeof out.review === "number" ? out.review : 0,
            });

            maybeCompleteSetupAfterSession({
              processed: typeof out.processed === "number" ? out.processed : 0,
            });
            setAppModeState(getAppMode());

            try {
              const resp = await getSuggestions();
              setSuggestions(Array.isArray(resp?.suggestions) ? resp.suggestions : []);
            } catch {
              setSuggestions([]);
            }

            setScreen("report");
          }}
          onViewRooms={() => {
            void loadRoomsAndGoToRooms();
          }}
        />
      </div>
    </>
  );
}

createRoot(root).render(
  <IndustryProvider>
    <App />
  </IndustryProvider>,
);

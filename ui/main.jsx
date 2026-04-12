import "./styles/designSystem.css";
import "../adapters/mockExternalAdapter.js";
import { isRealExternalIntegrationReady } from "../core/integrationAvailability.js";
import { REAL_MODE_INTEGRATION_REQUIRED_MESSAGE } from "./formatPipelineError.js";
import "../core/integrationEngine.js";
import "../core/intentEngine.js";
import { SYSTEM_MODE } from "../core/systemMode.js";
import "../outputs/externalOutput.js";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getRooms, getSuggestions } from "../interfaces/api.js";
import SimulationPanel from "./components/SimulationPanel.jsx";
import WorkflowStatus from "./components/WorkflowStatus.jsx";
import Entrance from "./Entrance.jsx";
import ProcessingScreen from "./screens/ProcessingScreen.jsx";
import RoomsDashboard from "./screens/RoomsDashboard.jsx";
import SuggestionsPanel from "./screens/SuggestionsPanel.jsx";
import SessionReport from "./screens/SessionReport.jsx";
import { compareSessionWorkflow } from "./sessionWorkflowCompare.js";
import WaitingRoom from "./screens/WaitingRoom.jsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

const AUTO_CHECK_INTERVAL = 60000; // 60 seconds

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
 * @returns {boolean}
 */
function isReviewPipelineRow(row) {
  if (row == null || typeof row !== "object") return false;
  const r = /** @type {Record<string, unknown>} */ (row);
  const reasonTop = typeof r.reason === "string" ? r.reason : "";
  if (reasonTop === "rejected_by_room") return true;

  const pc = r.place_card;
  if (pc && typeof pc === "object") {
    const pcReason = String(/** @type {Record<string, unknown>} */ (pc).reason ?? "");
    if (pcReason === "rejected_by_room") return true;
    const pcDec = /** @type {Record<string, unknown>} */ (pc).decision;
    if (typeof pcDec === "string" && pcDec !== "auto") return true;
  }

  const dec = typeof r.decision === "string" ? r.decision : null;
  if (dec != null && dec !== "auto") return true;

  if (r.room_validation != null) return true;
  if (r.priority != null) return true;
  if (r.error != null) return true;

  return false;
}

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
  let score;
  const rv = r.room_validation;
  if (rv && typeof rv === "object" && typeof /** @type {Record<string, unknown>} */ (rv).score === "number") {
    score = /** @type {number} */ (/** @type {Record<string, unknown>} */ (rv).score);
  }

  const p = r.priority;
  const priority = p === "high" || p === "medium" || p === "low" ? p : "low";

  const base = { file, reason, priority };
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
  const [screen, setScreen] = useState(
    /** @type {"entrance" | "processing" | "report" | "rooms" | "waiting"} */ ("entrance"),
  );
  const [intakePayload, setIntakePayload] = useState(/** @type {null | Record<string, unknown>} */ (null));
  const [sessionSummary, setSessionSummary] = useState(
    /** @type {{ processed: number, moved: number, review: number } | null} */ (null),
  );
  const [pipelineResults, setPipelineResults] = useState(/** @type {unknown[]} */ ([]));
  const [rooms, setRooms] = useState(/** @type {{ name: string, destination: string }[]} */ ([]));
  const [reviewItems, setReviewItems] = useState(/** @type {unknown[]} */ ([]));
  const [suggestions, setSuggestions] = useState(/** @type {unknown[]} */ ([]));
  const [expectedItems, setExpectedItems] = useState(/** @type {string[]} */ ([]));

  const refreshSuggestions = useCallback(async () => {
    try {
      const resp = await getSuggestions();
      setSuggestions(Array.isArray(resp?.suggestions) ? resp.suggestions : []);
    } catch {
      setSuggestions([]);
    }
  }, []);

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
      </div>
    </header>
  );

  if (screen === "entrance") {
    return (
      <>
        {workflowTopBar}
        <div key={screen} className="app-screen-fade">
          <Entrance
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
            onResolve={() => {}}
            onContinueToRooms={() => {
              void loadRoomsAndGoToRooms();
            }}
          />
          <SuggestionsStrip suggestions={suggestions} onRefresh={refreshSuggestions} />
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

createRoot(root).render(<App />);

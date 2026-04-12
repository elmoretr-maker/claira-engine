import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { getRooms, getSuggestions } from "../interfaces/api.js";
import Entrance from "./Entrance.jsx";
import ProcessingScreen from "./screens/ProcessingScreen.jsx";
import RoomsDashboard from "./screens/RoomsDashboard.jsx";
import SuggestionsPanel from "./screens/SuggestionsPanel.jsx";
import WaitingRoom from "./screens/WaitingRoom.jsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

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
    /** @type {"entrance" | "processing" | "rooms" | "waiting"} */ ("entrance"),
  );
  const [intakePayload, setIntakePayload] = useState(/** @type {null | Record<string, unknown>} */ (null));
  const [pipelineResults, setPipelineResults] = useState(/** @type {unknown[]} */ ([]));
  const [rooms, setRooms] = useState(/** @type {{ name: string, destination: string }[]} */ ([]));
  const [reviewItems, setReviewItems] = useState(/** @type {unknown[]} */ ([]));
  const [suggestions, setSuggestions] = useState(/** @type {unknown[]} */ ([]));

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

  if (screen === "entrance") {
    return (
      <Entrance
        onStartProcessing={(payload) => {
          setIntakePayload(payload);
          setPipelineResults([]);
          setRooms([]);
          setReviewItems([]);
          setSuggestions([]);
          setScreen("processing");
        }}
      />
    );
  }

  if (screen === "waiting") {
    return (
      <>
        <WaitingRoom
          reviewItems={reviewItems}
          onResolve={() => {}}
          onContinueToRooms={() => {
            void loadRoomsAndGoToRooms();
          }}
        />
        <SuggestionsStrip suggestions={suggestions} onRefresh={refreshSuggestions} />
      </>
    );
  }

  if (screen === "rooms") {
    return (
      <>
        <RoomsDashboard
          rooms={rooms}
          results={pipelineResults}
          onBackToProcessing={() => {
            setScreen("processing");
          }}
          onBackToEntrance={() => {
            setScreen("entrance");
            setIntakePayload(null);
          }}
        />
        <SuggestionsStrip suggestions={suggestions} onRefresh={refreshSuggestions} />
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
    <ProcessingScreen
      mode="folder"
      folderPath="references"
      ingestSource="file"
      ingestInput="references"
      entranceContext={{ intentLabel, settings }}
      onBackToEntrance={() => {
        setScreen("entrance");
        setIntakePayload(null);
      }}
      onProcessingComplete={async (out) => {
        const results = Array.isArray(out.results) ? out.results : [];
        setPipelineResults(results);
        const derived = results.filter(isReviewPipelineRow).map(pipelineRowToWaitingRoomItem);
        setReviewItems(derived);

        try {
          const resp = await getSuggestions();
          setSuggestions(Array.isArray(resp?.suggestions) ? resp.suggestions : []);
        } catch {
          setSuggestions([]);
        }

        if (derived.length > 0) {
          setScreen("waiting");
        } else {
          void loadRoomsAndGoToRooms();
        }
      }}
      onViewRooms={() => {
        void loadRoomsAndGoToRooms();
      }}
    />
  );
}

createRoot(root).render(<App />);

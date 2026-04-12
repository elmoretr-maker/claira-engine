import "./RoomsDashboard.css";

/**
 * @param {unknown} p
 * @returns {string}
 */
function normPath(p) {
  if (p == null || p === "") return "";
  return String(p)
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .toLowerCase();
}

/**
 * @param {unknown} result
 * @returns {string}
 */
function fileLabelFromResult(result) {
  if (result == null || typeof result !== "object") return "(unknown)";
  const r = /** @type {Record<string, unknown>} */ (result);
  if (typeof r.rel === "string" && r.rel.length) {
    const parts = r.rel.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : r.rel;
  }
  if (typeof r.moved_to === "string" && r.moved_to.length) {
    const parts = r.moved_to.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : r.moved_to;
  }
  const pc = r.place_card;
  if (pc && typeof pc === "object") {
    const dest = /** @type {Record<string, unknown>} */ (pc).proposed_destination;
    if (typeof dest === "string" && dest.length) {
      const parts = dest.replace(/\\/g, "/").split("/").filter(Boolean);
      return parts.length ? parts[parts.length - 1] : dest;
    }
  }
  return "(unknown)";
}

/**
 * @param {unknown} result
 * @returns {string | null} normalized destination folder key for matching
 */
function destinationKeyFromResult(result) {
  if (result == null || typeof result !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (result);
  const pc = r.place_card;
  if (pc && typeof pc === "object") {
    const dest = /** @type {Record<string, unknown>} */ (pc).proposed_destination;
    if (dest != null && String(dest).length) return normPath(dest);
  }
  if (typeof r.moved_to === "string" && r.moved_to.length) {
    const s = r.moved_to.replace(/\\/g, "/").replace(/\/+$/, "");
    const i = s.lastIndexOf("/");
    const parent = i >= 0 ? s.slice(0, i) : s;
    return normPath(parent);
  }
  return null;
}

/**
 * @param {string | null} resultKey
 * @param {string} roomDestNorm
 * @returns {boolean}
 */
function resultBelongsToRoom(resultKey, roomDestNorm) {
  if (!resultKey || !roomDestNorm) return false;
  if (resultKey === roomDestNorm) return true;
  if (resultKey.endsWith("/" + roomDestNorm) || resultKey.endsWith(roomDestNorm)) return true;
  if (resultKey.includes("/" + roomDestNorm + "/")) return true;
  return resultKey.includes("/" + roomDestNorm);
}

/**
 * @typedef {{ name: string, destination: string }} RoomDef
 * @param {{
 *   rooms?: RoomDef[],
 *   results?: unknown[],
 *   onBackToProcessing?: () => void,
 *   onBackToEntrance?: () => void,
 *   onSessionReport?: () => void,
 * }} props
 */
export default function RoomsDashboard({
  rooms = [],
  results = [],
  onBackToProcessing,
  onBackToEntrance,
  onSessionReport,
}) {
  const roomList = Array.isArray(rooms) ? rooms : [];
  const resultList = Array.isArray(results) ? results : [];

  /** @type {Map<string, { room: RoomDef, results: unknown[] }>} */
  const byRoom = new Map();
  for (const room of roomList) {
    const name = String(room?.name ?? "");
    const destination = String(room?.destination ?? "");
    const key = `${name}::${normPath(destination)}`;
    byRoom.set(key, { room: { name, destination }, results: [] });
  }

  for (const res of resultList) {
    const rk = destinationKeyFromResult(res);
    let matchedKey = null;
    for (const [key, bucket] of byRoom) {
      const roomDestNorm = normPath(bucket.room.destination);
      if (resultBelongsToRoom(rk, roomDestNorm)) {
        matchedKey = key;
        break;
      }
    }
    if (matchedKey) {
      byRoom.get(matchedKey).results.push(res);
    }
  }

  const columns = [...byRoom.values()];

  return (
    <div className="rooms-dashboard">
      {(typeof onBackToProcessing === "function" ||
        typeof onBackToEntrance === "function" ||
        typeof onSessionReport === "function") ? (
        <nav className="rooms-dashboard-nav" aria-label="Screen navigation">
          {typeof onBackToProcessing === "function" ? (
            <button type="button" className="btn btn-primary" onClick={onBackToProcessing}>
              Back to Processing
            </button>
          ) : null}
          {typeof onSessionReport === "function" ? (
            <button type="button" className="btn btn-secondary" onClick={() => void onSessionReport()}>
              Session report
            </button>
          ) : null}
          {typeof onBackToEntrance === "function" ? (
            <button type="button" className="btn btn-secondary" onClick={onBackToEntrance}>
              Back to Entrance
            </button>
          ) : null}
        </nav>
      ) : null}

      <header className="rooms-dashboard-header">
        <h1>Rooms</h1>
        <p>Where items landed — grouped from pipeline results (display only).</p>
      </header>

      <div className="rooms-dashboard-grid">
        {columns.map(({ room, results: roomResults }) => (
          <RoomCard key={`${room.name}-${room.destination}`} room={room} roomResults={roomResults} />
        ))}
      </div>
    </div>
  );
}

/**
 * @param {{ room: RoomDef, roomResults: unknown[] }} props
 */
function RoomCard({ room, roomResults }) {
  const count = roomResults.length;
  const labels = roomResults.map((r) => fileLabelFromResult(r));
  const preview = labels.slice(0, 5);
  const overflow = Math.max(0, labels.length - 5);

  const onClick = () => {
    console.log("[Room Clicked]", room);
  };

  return (
    <button type="button" className="card rooms-dashboard-card" onClick={onClick}>
      <h2>{room.name || "(unnamed room)"}</h2>
      <div className="destination">{room.destination || "—"}</div>
      <div className="count">{count} item{count === 1 ? "" : "s"}</div>

      {count === 0 ? (
        <p className="empty">Room is empty</p>
      ) : (
        <>
          <ul className="preview">
            {preview.map((name, i) => (
              <li key={`${name}-${i}`}>{name}</li>
            ))}
          </ul>
          {overflow > 0 ? (
            <div className="more">+{overflow} more</div>
          ) : null}
        </>
      )}
    </button>
  );
}

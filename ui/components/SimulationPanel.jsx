import { getSimulations } from "../../core/simulationRegistry.js";
import "./SimulationPanel.css";

export default function SimulationPanel() {
  const items = getSimulations();

  if (items.length === 0) {
    return (
      <div className="simulation-panel">
        <p className="simulation-panel-empty">No simulated features registered in this session.</p>
      </div>
    );
  }

  return (
    <div className="simulation-panel">
      <ul className="simulation-panel-list">
        {items.map((f) => (
          <li key={f.name} className="simulation-panel-item">
            <div className="simulation-panel-name">{f.name}</div>
            {f.location ? <div className="simulation-panel-meta">{f.location}</div> : null}
            {f.description ? <p className="simulation-panel-desc">{f.description}</p> : null}
            {f.replaceWith ? (
              <p className="simulation-panel-replace">
                <span className="simulation-panel-replace-k">Replace with:</span> {f.replaceWith}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

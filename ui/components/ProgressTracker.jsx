import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addTrackingSnapshot,
  createTrackingEntity,
  getTrackingConfig,
  getTrackingProgress,
  listTrackingEntities,
} from "../clairaApiClient.js";
import "./ProgressTracker.css";

/**
 * @param {{ industrySlug: string, packLabel: string, onBack: () => void, initialCategoryKey?: string }} props
 */
export default function ProgressTracker({ industrySlug, packLabel, onBack, initialCategoryKey = "" }) {
  const [entities, setEntities] = useState(/** @type {unknown[]} */ ([]));
  const [metricsDef, setMetricsDef] = useState(/** @type {Array<{ key: string, label: string, unit: string }>} */ ([]));
  const [selectedId, setSelectedId] = useState(/** @type {string} */ (""));
  const [progress, setProgress] = useState(/** @type {Record<string, unknown> | null} */ (null));
  const [snapshots, setSnapshots] = useState(/** @type {unknown[]} */ ([]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState(initialCategoryKey);
  const [manual, setManual] = useState(/** @type {Record<string, string>} */ ({}));
  const [imageFile, setImageFile] = useState(/** @type {File | null} */ (null));

  const refreshEntities = useCallback(async () => {
    const r = await listTrackingEntities({ industry: industrySlug });
    const list = Array.isArray(r?.entities) ? r.entities : [];
    setEntities(list);
    return list;
  }, [industrySlug]);

  const loadProgress = useCallback(
    async (entityId) => {
      if (!entityId) {
        setProgress(null);
        setSnapshots([]);
        return;
      }
      const r = await getTrackingProgress({ entityId });
      if (r?.ok) {
        setProgress(r.progress && typeof r.progress === "object" ? r.progress : null);
        setSnapshots(Array.isArray(r.snapshots) ? r.snapshots : []);
      } else {
        setProgress(null);
        setSnapshots([]);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await getTrackingConfig({ industry: industrySlug });
        if (cancelled) return;
        setMetricsDef(Array.isArray(cfg?.metrics) ? cfg.metrics : []);
        await refreshEntities();
      } catch {
        if (!cancelled) setMetricsDef([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [industrySlug, refreshEntities]);

  useEffect(() => {
    setNewCategory((c) => c || initialCategoryKey);
  }, [initialCategoryKey]);

  useEffect(() => {
    void loadProgress(selectedId);
  }, [selectedId, loadProgress]);

  /**
   * @param {unknown} snap
   */
  function snapImageUrl(snap) {
    const s =
      snap && typeof snap === "object"
        ? /** @type {{ imagePath?: string, entityId?: string, rawData?: { imagePath?: string | null } }} */ (snap)
        : null;
    const path =
      typeof s?.imagePath === "string" && s.imagePath.length > 0
        ? s.imagePath
        : typeof s?.rawData?.imagePath === "string" && s.rawData.imagePath.length > 0
          ? s.rawData.imagePath
          : null;
    const eid = s?.entityId;
    if (!path || !eid || typeof path !== "string") return null;
    const file = path.split("/").pop();
    if (!file) return null;
    const q = new URLSearchParams({ entity: eid, file });
    return `/__claira/tracking-asset?${q.toString()}`;
  }

  async function handleCreate() {
    setError(null);
    const name = newName.trim();
    const cat = newCategory.trim();
    if (!name || !cat) {
      setError("Enter a name and category.");
      return;
    }
    setBusy(true);
    try {
      const r = await createTrackingEntity({ name, category: cat, industry: industrySlug });
      if (!r?.ok) {
        setError(typeof r?.error === "string" ? r.error : "Could not create tracker.");
        return;
      }
      const ent = r.entity && typeof r.entity === "object" ? /** @type {{ id?: string }} */ (r.entity) : null;
      const id = typeof ent?.id === "string" ? ent.id : "";
      setNewName("");
      const list = await refreshEntities();
      if (id && list.some((e) => /** @type {{ id?: string }} */ (e).id === id)) {
        setSelectedId(id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddSnapshot() {
    if (!selectedId) {
      setError("Select or create a tracking subject first.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      /** @type {Record<string, number>} */
      const manualMetrics = {};
      for (const m of metricsDef) {
        const raw = manual[m.key];
        if (raw == null || String(raw).trim() === "") continue;
        const n = Number(raw);
        if (Number.isFinite(n)) manualMetrics[m.key] = n;
      }
      let imageBase64 = "";
      if (imageFile) {
        imageBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(imageFile);
        });
      }
      const r = await addTrackingSnapshot({
        entityId: selectedId,
        imageBase64,
        manualMetrics,
        categoryKey: newCategory.trim() || initialCategoryKey,
        industrySlug,
      });
      if (!r?.ok) {
        setError(typeof r?.error === "string" ? r.error : "Could not save snapshot.");
        return;
      }
      setImageFile(null);
      setManual({});
      await loadProgress(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const firstSnap = snapshots[0];
  const lastSnap = snapshots[snapshots.length - 1];
  const pctRowsRaw = Array.isArray(/** @type {{ percentageDifferences?: unknown }} */ (progress)?.percentageDifferences)
    ? /** @type {{ metric: string, from: number, to: number, pct: number | null }[]} */ (
        /** @type {{ percentageDifferences: unknown }} */ (progress).percentageDifferences
      )
    : [];
  const pctRows = pctRowsRaw.filter((row) => row.metric !== "image_aspect_source");
  const aspectChangeRow = pctRowsRaw.find((row) => row.metric === "image_aspect_source") ?? null;

  const tsAnalysis =
    progress && typeof progress === "object" && "timeSeriesAnalysis" in progress
      ? /** @type {{ timeSeriesAnalysis?: Record<string, unknown> }} */ (progress).timeSeriesAnalysis
      : null;
  const globalStability =
    tsAnalysis && typeof tsAnalysis.globalTrendStabilityScore === "number"
      ? tsAnalysis.globalTrendStabilityScore
      : null;
  const manualTs =
    tsAnalysis && typeof tsAnalysis.manualMetrics === "object" && tsAnalysis.manualMetrics !== null
      ? /** @type {Record<string, Record<string, unknown>>} */ (tsAnalysis.manualMetrics)
      : {};
  const consistencyWarning =
    progress && typeof /** @type {{ consistencyWarning?: string }} */ (progress).consistencyWarning === "string"
      ? /** @type {{ consistencyWarning?: string }} */ (progress).consistencyWarning
      : null;
  const visualQualityHint =
    progress && typeof /** @type {{ visualQualityHint?: string }} */ (progress).visualQualityHint === "string"
      ? /** @type {{ visualQualityHint?: string }} */ (progress).visualQualityHint
      : null;

  const aspectRatioSeries =
    tsAnalysis && Array.isArray(/** @type {{ aspectRatioSeries?: unknown }} */ (tsAnalysis).aspectRatioSeries)
      ? /** @type {{ index: number, timestamp?: string, aspect: number | null }[]} */ (tsAnalysis.aspectRatioSeries)
      : [];
  const scaleConsistency =
    tsAnalysis && typeof tsAnalysis.scaleConsistency === "object" && tsAnalysis.scaleConsistency !== null
      ? /** @type {{ coefficientOfVariation?: number | null, label?: string, snapshotCount?: number }} */ (
          tsAnalysis.scaleConsistency
        )
      : null;
  const resolvedThresholds =
    progress && typeof progress === "object" && "resolvedConsistencyThresholds" in progress
      ? /** @type {{ framingAspectThreshold?: number, scaleCvThreshold?: number }} */ (progress).resolvedConsistencyThresholds
      : null;
  const imageConsistency =
    progress && typeof progress === "object" && "imageConsistency" in progress && progress.imageConsistency !== null
      ? /** @type {{ scaleConsistencyLabel?: string, framingDeviationExceeded?: boolean, scaleDeviationExceeded?: boolean }} */ (
          progress.imageConsistency
        )
      : null;

  const aspectPts = aspectRatioSeries.filter(
    (p) => typeof p.aspect === "number" && Number.isFinite(/** @type {number} */ (p.aspect)),
  );
  const aspectVals = aspectPts.map((p) => /** @type {number} */ (p.aspect));
  const aspectMin = aspectVals.length ? Math.min(...aspectVals) : 0;
  const aspectMax = aspectVals.length ? Math.max(...aspectVals) : 1;
  const aspectSpan = aspectMax - aspectMin || 1;

  const qualityById = useMemo(() => {
    const ch =
      progress && Array.isArray(/** @type {{ changes?: unknown }} */ (progress).changes)
        ? /** @type {{ id?: string, imageQuality?: Record<string, unknown> }[]} */ (
            /** @type {{ changes: unknown }} */ (progress).changes
          )
        : [];
    /** @type {Map<string, Record<string, unknown>>} */
    const m = new Map();
    for (const row of ch) {
      const id = typeof row.id === "string" ? row.id : "";
      if (id && row.imageQuality && typeof row.imageQuality === "object") m.set(id, row.imageQuality);
    }
    return m;
  }, [progress]);

  return (
    <div className="progress-tracker">
      <header className="pt-header">
        <div>
          <h1 className="pt-title">Progress Tracking</h1>
          <p className="pt-sub">
            {packLabel || industrySlug} — local workspace only. Add snapshots for a timeline, optional images, and numeric
            fields; compare change over time.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
      </header>

      {error ? (
        <p className="pt-error" role="alert">
          {error}
        </p>
      ) : null}

      {consistencyWarning ? (
        <div className="pt-banner pt-banner--warn" role="status">
          {consistencyWarning}
        </div>
      ) : null}
      {visualQualityHint ? (
        <div className="pt-banner pt-banner--hint" role="note">
          {visualQualityHint}
        </div>
      ) : null}

      <section className="pt-section card">
        <h2 className="pt-h2">New tracking subject</h2>
        <div className="pt-row">
          <label className="pt-label">
            Name
            <input
              className="pt-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Subject or label"
            />
          </label>
          <label className="pt-label">
            Category key
            <input
              className="pt-input mono"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="e.g. site_photos"
            />
          </label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handleCreate()}>
            Create
          </button>
        </div>
      </section>

      <section className="pt-section card">
        <h2 className="pt-h2">Subjects</h2>
        {entities.length === 0 ? (
          <p className="pt-muted">No subjects yet. Create one above.</p>
        ) : (
          <ul className="pt-entity-list">
            {entities.map((e) => {
              const ent = /** @type {{ id?: string, name?: string, category?: string }} */ (e);
              const id = String(ent.id ?? "");
              const active = id === selectedId;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={active ? "pt-entity-btn pt-entity-btn--active" : "pt-entity-btn"}
                    onClick={() => setSelectedId(id)}
                  >
                    <span className="pt-entity-name">{ent.name}</span>
                    <span className="pt-entity-cat mono">{ent.category}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {selectedId ? (
        <>
          <section className="pt-section card">
            <h2 className="pt-h2">Add snapshot</h2>
            <p className="pt-muted">
              Optional image and optional numbers you enter. Images are normalized (orientation and standard canvas) for
              fair comparisons. Similar distance and framing improves reliability.
            </p>
            <div className="pt-metrics-grid">
              {metricsDef.map((m) => (
                <label key={m.key} className="pt-label">
                  {m.label} ({m.unit})
                  <input
                    className="pt-input"
                    type="number"
                    step="any"
                    value={manual[m.key] ?? ""}
                    onChange={(e) => setManual((prev) => ({ ...prev, [m.key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <label className="pt-label pt-file">
              Image (optional)
              <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
            </label>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handleAddSnapshot()}>
              Save snapshot
            </button>
          </section>

          <section className="pt-section card">
            <h2 className="pt-h2">Timeline</h2>
            {snapshots.length === 0 ? (
              <p className="pt-muted">No snapshots yet.</p>
            ) : (
              <ol className="pt-timeline">
                {snapshots.map((s) => {
                  const sn = /** @type {{ id?: string, timestamp?: string }} */ (s);
                  const sid = String(sn.id ?? "");
                  const iq = sid ? qualityById.get(sid) : undefined;
                  const status = iq && typeof iq.status === "string" ? iq.status : "";
                  const guidance = iq && typeof iq.guidance === "string" ? iq.guidance : null;
                  const fSc = iq && typeof iq.framingScore === "number" ? iq.framingScore : null;
                  const sSc = iq && typeof iq.scaleScore === "number" ? iq.scaleScore : null;
                  return (
                    <li key={sid || String(sn.timestamp)} className="pt-tl-item">
                      <div className="pt-tl-row">
                        <time className="mono">{sn.timestamp}</time>
                        {iq ? (
                          <span
                            className={
                              status === "inconsistent"
                                ? "pt-snap-quality pt-snap-quality--warn"
                                : status === "good"
                                  ? "pt-snap-quality pt-snap-quality--ok"
                                  : "pt-snap-quality pt-snap-quality--na"
                            }
                            title={
                              fSc != null || sSc != null
                                ? `Framing ${fSc != null ? fSc : "—"}/100 · Scale ${sSc != null ? sSc : "—"}/100`
                                : undefined
                            }
                          >
                            {status === "inconsistent"
                              ? "⚠️ inconsistent"
                              : status === "good"
                                ? "✅ good"
                                : "— no image"}
                          </span>
                        ) : null}
                      </div>
                      {guidance ? (
                        <p className="pt-snap-guidance" role="note">
                          {guidance}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="pt-section card">
            <h2 className="pt-h2">Before / after</h2>
            {snapshots.length < 2 ? (
              <p className="pt-muted">Add at least two snapshots to compare.</p>
            ) : (
              <div className="pt-compare">
                <figure className="pt-fig">
                  <figcaption>Earlier</figcaption>
                  {snapImageUrl(firstSnap) ? (
                    <img src={snapImageUrl(firstSnap) ?? ""} alt="Earlier snapshot" className="pt-img" />
                  ) : (
                    <p className="pt-muted">No image</p>
                  )}
                </figure>
                <figure className="pt-fig">
                  <figcaption>Latest</figcaption>
                  {snapImageUrl(lastSnap) ? (
                    <img src={snapImageUrl(lastSnap) ?? ""} alt="Latest snapshot" className="pt-img" />
                  ) : (
                    <p className="pt-muted">No image</p>
                  )}
                </figure>
              </div>
            )}
          </section>

          <section className="pt-section card">
            <h2 className="pt-h2">Detected changes</h2>
            {pctRows.length === 0 ? (
              <p className="pt-muted">No comparable numeric fields yet (enter the same fields on multiple snapshots).</p>
            ) : (
              <table className="pt-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Δ %</th>
                  </tr>
                </thead>
                <tbody>
                  {pctRows.map((row) => (
                    <tr key={row.metric}>
                      <td className="mono">{row.metric}</td>
                      <td>{row.from}</td>
                      <td>{row.to}</td>
                      <td>{row.pct != null ? `${row.pct > 0 ? "+" : ""}${row.pct}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {progress && typeof /** @type {{ direction?: string }} */ (progress).direction === "string" ? (
              <p className="pt-trend">
                Trend: <strong>{String(/** @type {{ direction?: string }} */ (progress).direction)}</strong>
                {globalStability != null ? (
                  <>
                    {" "}
                    · Stability score: <strong>{globalStability}</strong>/100
                  </>
                ) : null}
              </p>
            ) : null}
          </section>

          {snapshots.length >= 2 &&
          progress &&
          /** @type {{ trend?: string }} */ (progress).trend === "tracked" &&
          snapshots.some((s) => snapImageUrl(s)) &&
          imageConsistency ? (
            <section className="pt-section card">
              <h2 className="pt-h2">Image consistency</h2>
              <p className="pt-muted">
                Source aspect ratio and scale variation across snapshots. High variation may reduce comparability.
              </p>
              {resolvedThresholds &&
              typeof resolvedThresholds.framingAspectThreshold === "number" &&
              typeof resolvedThresholds.scaleCvThreshold === "number" ? (
                <p className="pt-thresholds mono">
                  Thresholds: framing spread ≤ {resolvedThresholds.framingAspectThreshold} · scale CV ≤{" "}
                  {resolvedThresholds.scaleCvThreshold}
                </p>
              ) : null}
              {aspectPts.length >= 2 ? (
                <div className="pt-consistency-block">
                  <h3 className="pt-h3">Aspect ratio (source)</h3>
                  <div className="pt-aspect-chart" role="img" aria-label="Aspect ratio trend across snapshots">
                    {aspectPts.map((p, i) => {
                      const a = /** @type {number} */ (p.aspect);
                      const hPct = Math.max(6, ((a - aspectMin) / aspectSpan) * 100);
                      return (
                        <div key={i} className="pt-aspect-col" title={`${a.toFixed(4)} @ ${p.timestamp ?? ""}`}>
                          <div className="pt-aspect-bar" style={{ height: `${hPct}%` }} />
                        </div>
                      );
                    })}
                  </div>
                  <ul className="pt-aspect-values mono">
                    {aspectRatioSeries.map((p, i) => (
                      <li key={i}>
                        #{p.index + 1}:{" "}
                        {typeof p.aspect === "number" && Number.isFinite(p.aspect) ? p.aspect.toFixed(4) : "—"}
                      </li>
                    ))}
                  </ul>
                  {aspectChangeRow && aspectChangeRow.pct != null ? (
                    <p className="pt-muted">
                      First→last aspect Δ:{" "}
                      <strong>
                        {aspectChangeRow.pct > 0 ? "+" : ""}
                        {aspectChangeRow.pct}%
                      </strong>
                    </p>
                  ) : null}
                </div>
              ) : null}
              {scaleConsistency && scaleConsistency.label !== "unknown" ? (
                <div className="pt-consistency-block">
                  <h3 className="pt-h3">Scale (capture distance)</h3>
                  <p className="pt-scale-indicator">
                    <span
                      className={
                        scaleConsistency.label === "consistent"
                          ? "pt-scale-badge pt-scale-badge--ok"
                          : scaleConsistency.label === "moderate"
                            ? "pt-scale-badge pt-scale-badge--mid"
                            : "pt-scale-badge pt-scale-badge--warn"
                      }
                    >
                      {scaleConsistency.label}
                    </span>
                    {scaleConsistency.coefficientOfVariation != null ? (
                      <>
                        {" "}
                        <span className="mono">CV {scaleConsistency.coefficientOfVariation.toFixed(3)}</span>
                      </>
                    ) : null}
                    {typeof scaleConsistency.snapshotCount === "number" ? (
                      <span className="pt-muted"> · {scaleConsistency.snapshotCount} snapshots with scale data</span>
                    ) : null}
                  </p>
                  {imageConsistency?.scaleDeviationExceeded ? (
                    <p className="pt-muted">Scale variation exceeds the configured threshold.</p>
                  ) : null}
                </div>
              ) : (
                <p className="pt-muted">More snapshots with images are needed to assess scale (distance) consistency.</p>
              )}
            </section>
          ) : null}

          {Object.keys(manualTs).length > 0 ? (
            <section className="pt-section card">
              <h2 className="pt-h2">Time-series analysis</h2>
              <p className="pt-muted">
                Uses every snapshot: interval rates, rolling average change, trend consistency, and acceleration (speed-up /
                slow-down of change).
              </p>
              {Object.entries(manualTs).map(([metricKey, row]) => {
                const intervals = Array.isArray(row.intervalRates) ? row.intervalRates : [];
                const roll = row.rollingAvgChange;
                const consist = row.trendConsistency;
                const accel = row.acceleration;
                const stab = row.trendStabilityScore;
                return (
                  <div key={metricKey} className="pt-ts-metric">
                    <h3 className="pt-h3 mono">{metricKey}</h3>
                    <ul className="pt-ts-stats">
                      <li>
                        Rolling avg change (recent intervals):{" "}
                        <strong>{roll != null && typeof roll === "number" ? roll : "—"}</strong>
                      </li>
                      <li>
                        Trend consistency:{" "}
                        <strong>
                          {consist != null && typeof consist === "number" ? `${Math.round(consist * 100)}%` : "—"}
                        </strong>
                      </li>
                      <li>
                        Rate pattern: <strong>{typeof accel === "string" ? accel.replace(/_/g, " ") : "—"}</strong>
                      </li>
                      <li>
                        Stability score: <strong>{typeof stab === "number" ? stab : "—"}</strong>/100
                      </li>
                    </ul>
                    {intervals.length > 0 ? (
                      <table className="pt-table pt-table--compact">
                        <thead>
                          <tr>
                            <th>Step</th>
                            <th>Days</th>
                            <th>Δ value</th>
                            <th>Rate / day</th>
                          </tr>
                        </thead>
                        <tbody>
                          {intervals.map((iv, idx) => {
                            const r = /** @type {{ daysDelta?: number, valueDelta?: number, ratePerDay?: number | null }} */ (iv);
                            return (
                              <tr key={idx}>
                                <td>
                                  {r.fromIdx ?? idx}→{r.toIdx ?? idx + 1}
                                </td>
                                <td>{r.daysDelta ?? "—"}</td>
                                <td>{r.valueDelta ?? "—"}</td>
                                <td>{r.ratePerDay != null ? r.ratePerDay : "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import "./FitnessTrackingPanel.css";

/**
 * Read-only contractor report (same fields as PDF export).
 * @param {{ projectSlug: string, reportId: string, onClose: () => void }} props
 */
export default function ContractorReportShareView({ projectSlug, reportId, onClose }) {
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  const [report, setReport] = useState(/** @type {Record<string, unknown> | null} */ (null));

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/reports/${encodeURIComponent(projectSlug)}/${encodeURIComponent(reportId)}`);
      const data = await r.json().catch(() => null);
      if (!r.ok || !data || typeof data !== "object" || /** @type {{ ok?: unknown }} */ (data).ok !== true) {
        const msg =
          data && typeof data === "object" && typeof /** @type {{ error?: string }} */ (data).error === "string"
            ? /** @type {{ error: string }} */ (data).error
            : `Could not load report (${r.status})`;
        setErr(msg);
        setReport(null);
        return;
      }
      const rep = /** @type {{ report?: unknown }} */ (data).report;
      setReport(rep && typeof rep === "object" && !Array.isArray(rep) ? /** @type {Record<string, unknown>} */ (rep) : null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setReport(null);
    } finally {
      setBusy(false);
    }
  }, [projectSlug, reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  const proj = report?.project && typeof report.project === "object" ? /** @type {{ name?: string }} */ (report.project) : {};
  const title = typeof proj.name === "string" && proj.name.trim() ? proj.name : "Contractor report";
  const bv = report?.budgetVsActual && typeof report.budgetVsActual === "object" ? report.budgetVsActual : null;
  const alerts = Array.isArray(report?.alerts) ? /** @type {unknown[]} */ (report.alerts) : [];
  const sectionBreakdown =
    report?.sectionBreakdown && typeof report.sectionBreakdown === "object" && !Array.isArray(report.sectionBreakdown)
      ? /** @type {Record<string, number>} */ (report.sectionBreakdown)
      : {};
  const perAssignee =
    report?.perAssignee && typeof report.perAssignee === "object" && !Array.isArray(report.perAssignee)
      ? /** @type {Record<string, { total?: number, sections?: Record<string, number> }>} */ (report.perAssignee)
      : {};
  const source = report?.source && typeof report.source === "object" && !Array.isArray(report.source) ? report.source : null;
  const srcMeta = source ? /** @type {Record<string, unknown>} */ (source) : null;
  const receiptThumbs = Array.isArray(report?.receiptThumbnails) ? /** @type {unknown[]} */ (report.receiptThumbnails) : [];

  return (
    <div
      className="fitness-panel contractor-panel"
      style={{
        minHeight: "100vh",
        boxSizing: "border-box",
        padding: "1.25rem 1.5rem 2rem",
        maxWidth: "52rem",
        margin: "0 auto",
      }}
    >
      <div className="fitness-panel__row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
        <h1 className="fitness-panel__title" style={{ margin: 0 }}>
          {title}
        </h1>
        <div className="fitness-panel__row" style={{ gap: "0.5rem" }}>
          <a
            className="btn btn-secondary"
            href={`/api/reports/${encodeURIComponent(projectSlug)}/${encodeURIComponent(reportId)}/pdf`}
            target="_blank"
            rel="noreferrer"
          >
            Open PDF
          </a>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <p className="fitness-panel__hint" style={{ marginTop: "0.35rem" }}>
        Read-only shared snapshot · schema v{String(report?.version ?? "?")} · {String(report?.generatedAt ?? "")}
      </p>

      {busy ? <p className="fitness-panel__hint">Loading…</p> : null}
      {err ? (
        <p className="fitness-panel__error" style={{ marginTop: "0.75rem" }}>
          {err}
        </p>
      ) : null}

      {!busy && !err && report ? (
        <>
          {source ? (
            <section style={{ marginTop: "1rem" }}>
              <h2 className="fitness-panel__subtitle" style={{ fontSize: "1rem", margin: "0 0 0.35rem" }}>
                Source snapshot
              </h2>
              <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.88rem" }}>
                {srcMeta?.receiptCount != null ? <li>Receipt rows: {Number(srcMeta.receiptCount)}</li> : null}
                {srcMeta?.receiptImageCount != null ? <li>Receipt images (at export): {Number(srcMeta.receiptImageCount)}</li> : null}
                {srcMeta?.timelineImageCount != null ? <li>Timeline progress images: {Number(srcMeta.timelineImageCount)}</li> : null}
                {srcMeta?.embeddedReceiptSampleCount != null ? (
                  <li>Embedded receipt samples in snapshot: {Number(srcMeta.embeddedReceiptSampleCount)}</li>
                ) : null}
              </ul>
            </section>
          ) : null}

          {bv ? (
            <section style={{ marginTop: "1rem" }}>
              <h2 className="fitness-panel__subtitle" style={{ fontSize: "1rem", margin: "0 0 0.35rem" }}>
                Budget vs actual
              </h2>
              <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.92rem" }}>
                {bv.initialBudget != null ? (
                  <li>Initial budget: ${Number(/** @type {{ initialBudget?: number }} */ (bv).initialBudget).toFixed(2)}</li>
                ) : null}
                <li>Receipt total: ${Number(/** @type {{ receiptTotal?: number }} */ (bv).receiptTotal ?? 0).toFixed(2)}</li>
                <li>Other costs: ${Number(/** @type {{ manualSpendSupplement?: number }} */ (bv).manualSpendSupplement ?? 0).toFixed(2)}</li>
                <li>Current spend: ${Number(/** @type {{ currentSpend?: number }} */ (bv).currentSpend ?? 0).toFixed(2)}</li>
                {bv.deltaVsBudget != null ? (
                  <li>Delta vs budget: ${Number(/** @type {{ deltaVsBudget?: number }} */ (bv).deltaVsBudget).toFixed(2)}</li>
                ) : null}
              </ul>
            </section>
          ) : null}

          <section style={{ marginTop: "1rem" }}>
            <h2 className="fitness-panel__subtitle" style={{ fontSize: "1rem", margin: "0 0 0.35rem" }}>
              Summary
            </h2>
            <p style={{ margin: 0, fontSize: "0.92rem" }}>
              Total cost (receipts): <strong>${Number(report.totalCost ?? 0).toFixed(2)}</strong> · Receipt count:{" "}
              {Number(report.receiptCount ?? 0)}
            </p>
          </section>

          <section style={{ marginTop: "1rem" }}>
            <h2 className="fitness-panel__subtitle" style={{ fontSize: "1rem", margin: "0 0 0.35rem" }}>
              Section breakdown
            </h2>
            <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.88rem" }}>
              {Object.keys(sectionBreakdown)
                .sort()
                .map((k) => (
                  <li key={k}>
                    {k}: ${Number(sectionBreakdown[k]).toFixed(2)}
                  </li>
                ))}
            </ul>
          </section>

          <section style={{ marginTop: "1rem" }}>
            <h2 className="fitness-panel__subtitle" style={{ fontSize: "1rem", margin: "0 0 0.35rem" }}>
              Per assignee
            </h2>
            <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.88rem" }}>
              {Object.keys(perAssignee)
                .sort()
                .map((a) => {
                  const row = perAssignee[a];
                  const subs = row?.sections && typeof row.sections === "object" ? row.sections : {};
                  return (
                    <li key={a}>
                      <strong>{a}</strong>: ${Number(row?.total ?? 0).toFixed(2)}
                      <ul>
                        {Object.keys(subs)
                          .sort()
                          .map((sk) => (
                            <li key={sk}>
                              {sk}: ${Number(subs[sk]).toFixed(2)}
                            </li>
                          ))}
                      </ul>
                    </li>
                  );
                })}
            </ul>
          </section>

          <section style={{ marginTop: "1rem" }}>
            <h2 className="fitness-panel__subtitle" style={{ fontSize: "1rem", margin: "0 0 0.35rem" }}>
              Alerts
            </h2>
            {alerts.length === 0 ? (
              <p className="fitness-panel__hint" style={{ margin: 0 }}>
                No alerts.
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "1rem", listStyle: "none" }}>
                {alerts.map((a, i) => {
                  const ar = a && typeof a === "object" && !Array.isArray(a) ? /** @type {Record<string, unknown>} */ (a) : {};
                  const ty = String(ar.type ?? "warning");
                  const tone =
                    ty === "problem" ? "#fecaca" : ty === "good" ? "#bbf7d0" : "#fef08a";
                  return (
                    <li
                      key={i}
                      style={{
                        marginBottom: "0.5rem",
                        padding: "0.45rem 0.6rem",
                        borderRadius: "6px",
                        background: "rgba(255,255,255,0.06)",
                        borderLeft: `4px solid ${tone}`,
                        fontSize: "0.88rem",
                      }}
                    >
                      <strong>[{ty}]</strong> {String(ar.assignee ?? "")} · {String(ar.section ?? "")}
                      <div style={{ marginTop: "0.2rem", opacity: 0.95 }}>{String(ar.message ?? "")}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {receiptThumbs.length > 0 ? (
            <section style={{ marginTop: "1rem" }}>
              <h2 className="fitness-panel__subtitle" style={{ fontSize: "1rem", margin: "0 0 0.35rem" }}>
                Receipt samples
              </h2>
              {receiptThumbs.map((row, ri) => {
                const tr = row && typeof row === "object" && !Array.isArray(row) ? /** @type {Record<string, unknown>} */ (row) : {};
                const label = String(tr.sectionLabel ?? "");
                const emb = Array.isArray(tr.embeddedImages) ? tr.embeddedImages : [];
                return (
                  <div key={ri} style={{ marginBottom: "0.75rem" }}>
                    <div style={{ fontSize: "0.88rem", marginBottom: "0.35rem" }}>{label}</div>
                    <div className="fitness-panel__row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                      {emb.slice(0, 2).map((im, ii) => {
                        const ir =
                          im && typeof im === "object" && !Array.isArray(im) ? /** @type {Record<string, unknown>} */ (im) : {};
                        const mime = typeof ir.mimeType === "string" ? ir.mimeType : "image/jpeg";
                        const b64 = typeof ir.dataBase64 === "string" ? ir.dataBase64 : "";
                        if (!b64) return null;
                        return (
                          <img
                            key={ii}
                            src={`data:${mime};base64,${b64}`}
                            alt=""
                            style={{ maxWidth: "220px", maxHeight: "160px", objectFit: "contain", borderRadius: "6px" }}
                          />
                        );
                      })}
                    </div>
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

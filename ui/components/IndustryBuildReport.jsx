import "./IndustryBuildReport.css";

/**
 * @param {unknown} iss
 */
function issueDisplay(iss) {
  if (iss == null) return "";
  if (typeof iss === "string") return iss;
  if (typeof iss === "object" && iss !== null && "display" in iss) {
    return String(/** @type {{ display?: string }} */ (iss).display ?? "");
  }
  if (typeof iss === "object" && iss !== null && "message" in iss) {
    return String(/** @type {{ message?: string }} */ (iss).message ?? "");
  }
  return String(iss);
}

/**
 * @param {unknown} iss
 * @param {number} _i
 */
function issueClassName(iss, _i) {
  if (iss && typeof iss === "object" && "severity" in iss) {
    const s = String(/** @type {{ severity?: string }} */ (iss).severity ?? "").toLowerCase();
    if (s === "high" || s === "medium" || s === "low") return `ibr-issue ibr-issue--${s}`;
  }
  return "ibr-issue ibr-issue--medium";
}

/**
 * @param {unknown} iss
 * @param {number} i
 */
function issueKey(iss, i) {
  const d = issueDisplay(iss);
  return `${d}-${i}`;
}

/**
 * @param {{
 *   slug: string,
 *   report: Record<string, unknown>,
 *   onProceed: () => void,
 *   onImprove: () => void,
 *   onAutoImprove?: () => void,
 *   proceedBusy?: boolean,
 *   improveBusy?: boolean,
 * }} props
 */
export default function IndustryBuildReport({
  slug,
  report,
  onProceed,
  onImprove,
  onAutoImprove,
  proceedBusy = false,
  improveBusy = false,
}) {
  const overall = typeof report?.overallScore === "number" ? report.overallScore : 0;
  const rating = String(report?.rating ?? "insufficient");
  const categories = Array.isArray(report?.categories) ? report.categories : [];
  const profile = report?.useCaseProfile && typeof report.useCaseProfile === "object" ? report.useCaseProfile : null;
  const profileLabel =
    profile && typeof /** @type {{ label?: string }} */ (profile).label === "string"
      ? /** @type {{ label?: string }} */ (profile).label
      : null;
  const profileId =
    profile && typeof /** @type {{ id?: string }} */ (profile).id === "string"
      ? /** @type {{ id?: string }} */ (profile).id
      : "general";
  const thresholds = report?.thresholds && typeof report.thresholds === "object" ? report.thresholds : null;
  const highMin = thresholds && typeof /** @type {{ highMin?: number }} */ (thresholds).highMin === "number" ? thresholds.highMin : 80;
  const passableMin =
    thresholds && typeof /** @type {{ passableMin?: number }} */ (thresholds).passableMin === "number"
      ? thresholds.passableMin
      : 60;

  const recommended = Array.isArray(report?.recommendedActions) ? report.recommendedActions : [];
  const conf =
    report?.confidenceExplanation && typeof report.confidenceExplanation === "object"
      ? report.confidenceExplanation
      : null;
  const confIntro = conf && typeof /** @type {{ intro?: string }} */ (conf).intro === "string" ? conf.intro : "";
  const rawBullets = /** @type {{ bullets?: unknown }} */ (conf)?.bullets;
  const confBullets = Array.isArray(rawBullets)
    ? /** @type {unknown[]} */ (rawBullets).filter((b) => typeof b === "string")
    : [];

  const isPassable = rating === "passable";
  const isInsufficient = rating === "insufficient";
  const anyBusy = proceedBusy || improveBusy;

  return (
    <div className="industry-build-report" role="dialog" aria-labelledby="ibr-title">
      <h3 id="ibr-title" className="ibr-title">
        Industry quality report — <span className="mono">{slug}</span>
      </h3>

      <p className="ibr-profile-line">
        Quality profile: <strong>{profileLabel ?? profileId}</strong>
        <span className="ibr-thresholds mono">
          {" "}
          · high ≥{highMin}% · passable ≥{passableMin}%
        </span>
      </p>

      <div className={`ibr-summary ibr-summary--${rating}`}>
        <p className="ibr-overall">
          Overall coverage: <strong>{overall}%</strong>
          <span className="ibr-rating-badge">{rating}</span>
        </p>
        {confIntro ? (
          <div className="ibr-confidence">
            <p className="ibr-confidence-intro">{confIntro}</p>
            {confBullets.length > 0 ? (
              <ul className="ibr-confidence-bullets">
                {confBullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {isPassable ? (
          <p className="ibr-hint">Quality is passable for this profile. You can proceed, improve manually, or run automatic repair.</p>
        ) : null}
        {isInsufficient ? (
          <p className="ibr-hint ibr-hint--warn">
            Coverage is below the auto-activate threshold for this profile. Review issues, use automatic improvement, or
            edit <span className="mono">packs/{slug}/</span>.
          </p>
        ) : null}
      </div>

      {recommended.length > 0 ? (
        <div className="ibr-recommendations">
          <h4 className="ibr-subtitle">Recommended actions</h4>
          <ul className="ibr-rec-list">
            {recommended.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="ibr-breakdown">
        <h4 className="ibr-subtitle">Category breakdown</h4>
        <ul className="ibr-cat-list">
          {categories.map((c) => (
            <li key={c.key} className="ibr-cat">
              <div className="ibr-cat-head">
                <span className="ibr-cat-key mono">{c.key}</span>
                <span className="ibr-cat-score">{typeof c.score === "number" ? c.score : 0}%</span>
              </div>
              {Array.isArray(c.issues) && c.issues.length > 0 ? (
                <ul className="ibr-issues">
                  {c.issues.map((iss, idx) => (
                    <li key={issueKey(iss, idx)} className={issueClassName(iss, idx)}>
                      {issueDisplay(iss)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ibr-no-issues">No issues flagged for this category.</p>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="ibr-actions">
        {isPassable ? (
          <>
            <button type="button" className="btn btn-primary" disabled={anyBusy} onClick={onProceed}>
              Proceed
            </button>
            {typeof onAutoImprove === "function" ? (
              <button type="button" className="btn btn-secondary" disabled={anyBusy} onClick={onAutoImprove}>
                {improveBusy ? "Improving…" : "Improve automatically"}
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary" disabled={anyBusy} onClick={onImprove}>
              Improve
            </button>
          </>
        ) : null}
        {isInsufficient ? (
          <>
            <button type="button" className="btn btn-primary" disabled={anyBusy} onClick={onProceed}>
              Proceed anyway
            </button>
            {typeof onAutoImprove === "function" ? (
              <button type="button" className="btn btn-secondary" disabled={anyBusy} onClick={onAutoImprove}>
                {improveBusy ? "Improving…" : "Improve automatically"}
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary" disabled={anyBusy} onClick={onImprove}>
              Fix issues
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

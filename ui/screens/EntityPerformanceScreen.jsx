/**
 * EntityPerformanceScreen.jsx
 *
 * Main dashboard for entity pipeline output.
 * Phase 2: ActionQueue clicks now expand the matching row in EntityTable.
 *
 * Layout (top → bottom):
 *   1. Header      — title, entity count, Back button
 *   2. Wellness    — "What this means" (primary takeaway + interpretation) when weightloss
 *   3. Projection  — pace banner when horizons exist
 *   4. Top row     — ActionQueue (left) + PrioritySummary (right)
 *   5. Table       — EntityTable with expandable rows (one open at a time)
 *
 * Props:
 *   entities — MergedEntity[] from mergeEntityPipelineData()
 *   onBack   — () => void
 */

import { useCallback, useRef, useState } from "react";
import "./EntityPerformanceScreen.css";
import { sortByUrgencyThenRank } from "../utils/engineDisplayFormatters.js";
import { getLabels }   from "../utils/intentLabels.js";
import ActionQueue     from "../components/ActionQueue.jsx";
import PrioritySummary from "../components/PrioritySummary.jsx";
import EntityTable     from "../components/EntityTable.jsx";

/**
 * @param {{
 *   entities: object[],
 *   onBack:   () => void,
 * }} props
 */
export default function EntityPerformanceScreen({ entities, onBack }) {
  const sorted = sortByUrgencyThenRank(Array.isArray(entities) ? entities : []);

  // ── Intent detection ─────────────────────────────────────────────────────────
  const analyzerIntent      = sorted[0]?.analyzerIntent ?? null;
  const isWellnessView      = analyzerIntent === "weightloss";
  const isIntentView        = !!analyzerIntent && !isWellnessView;

  const primaryWellnessRow    = sorted.find((e) => e.wellnessPrimary);
  const wellnessHorizonBanner = primaryWellnessRow?.wellnessHorizonsFormatted;

  const primaryIntentRow = isIntentView ? (sorted.find((e) => e.intentPrimary) ?? null) : null;
  const intentAnalysis   = primaryIntentRow?.intentAnalysis ?? null;
  const intentLabels     = isIntentView ? getLabels(analyzerIntent) : null;

  // Shared ref map: entityId → <tr> element
  const scrollRefMap = useRef(new Map());

  // Lifted expand state — shared between ActionQueue (sets it) and EntityTable (reads it)
  const [expandedId, setExpandedId] = useState(/** @type {string|null} */ (null));

  const handleScrollTo = useCallback((entityId) => {
    // Expand the target row
    setExpandedId(entityId);

    // Scroll to it (after a brief tick so the detail row has rendered)
    requestAnimationFrame(() => {
      const el = scrollRefMap.current.get(entityId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.outline      = "2px solid var(--accent)";
        el.style.outlineOffset = "-2px";
        setTimeout(() => {
          el.style.outline      = "";
          el.style.outlineOffset = "";
        }, 1200);
      }
    });
  }, []);

  const hasData = sorted.length > 0;

  return (
    <div className="ep-screen app-screen-fade">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="ep-screen__header">
        <div className="ep-screen__title-block">
          <h1 className="ep-screen__title">
            {isWellnessView ? "Wellness & weight trends"
              : isIntentView ? intentLabels.intentLabel
              : "Entity Performance"}
          </h1>
          <p className="ep-screen__subtitle">
            {isWellnessView
              ? `Trends from your metrics · ${sorted.length} tracked row${sorted.length === 1 ? "" : "s"}`
              : `Ranked by urgency · ${sorted.length} ${sorted.length === 1 ? intentLabels?.entityNoun?.toLowerCase() ?? "entity" : intentLabels?.entityNounPlural?.toLowerCase() ?? "entities"}`}
          </p>
        </div>
        <div className="ep-screen__header-actions">
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            ← Back
          </button>
        </div>
      </div>

      {/* ── No-data state ───────────────────────────────────────────── */}
      {!hasData ? (
        <div className="ep-screen__no-data">
          <div className="ep-screen__no-data-icon">📊</div>
          <h2 className="ep-screen__no-data-title">No performance data yet</h2>
          <p className="ep-screen__no-data-body">
            Run a complete workflow — or use Insight Engine — to see ranked entity results here.
          </p>
        </div>
      ) : (
        <>
          {/* ══ Wellness sections (weightloss intent only) ════════════ */}
          {isWellnessView && primaryWellnessRow ? (() => {
            const pw  = primaryWellnessRow;
            const sum = pw.wellnessSummary;

            return (
              <>
                {/* ── Section 1: Current routine (facts only) ───────── */}
                <section className="ep-wellness-routine" aria-labelledby="ep-routine-title">
                  <h2 id="ep-routine-title" className="ep-wellness-section__title">Current routine</h2>
                  <ul className="ep-wellness-routine__list">
                    {/* Weight */}
                    {sum?.weightChange?.value != null && (
                      <li className="ep-wellness-routine__row">
                        <span className="ep-wellness-routine__label">Weight trend</span>
                        <span className="ep-wellness-routine__value">
                          {sum.weightChange.direction === "down" ? "↓" : sum.weightChange.direction === "up" ? "↑" : "→"}{" "}
                          {Math.abs(sum.weightChange.value).toFixed(1)} lb
                          {sum.weightChange.durationDays ? ` over ${sum.weightChange.durationDays} days` : ""}
                          {sum.weightChange.perWeek != null
                            ? ` (~${Math.abs(sum.weightChange.perWeek).toFixed(1)} lb/week)`
                            : ""}
                        </span>
                      </li>
                    )}
                    {/* Sleep */}
                    {sum?.sleep?.hoursPerNight != null && (
                      <li className="ep-wellness-routine__row">
                        <span className="ep-wellness-routine__label">Sleep</span>
                        <span className="ep-wellness-routine__value">
                          {sum.sleep.hoursPerNight.toFixed(1)} hours/night
                          {sum.sleep.bedTime  ? ` · bed ${sum.sleep.bedTime}` : ""}
                          {sum.sleep.wakeTime ? ` · wake ${sum.sleep.wakeTime}` : ""}
                        </span>
                      </li>
                    )}
                    {/* Activity — pipeline entity row (tracked metric) */}
                    {sum?.activityRow && (
                      <li className="ep-wellness-routine__row">
                        <span className="ep-wellness-routine__label">{sum.activityRow.label ?? "Activity"}</span>
                        <span className="ep-wellness-routine__value">
                          {sum.activityRow.direction === "down" ? "↓ Trending down"
                            : sum.activityRow.direction === "up"   ? "↑ Trending up"
                            : "→ Stable"}{" "}
                          (this period)
                        </span>
                      </li>
                    )}
                    {/* Activity — structured intake (FIX 4: shown when no pipeline row) */}
                    {!sum?.activityRow && sum?.structuredActivity?.daysPerWeek != null && (
                      <li className="ep-wellness-routine__row">
                        <span className="ep-wellness-routine__label">Activity</span>
                        <span className="ep-wellness-routine__value">
                          {Number.isInteger(sum.structuredActivity.daysPerWeek)
                            ? sum.structuredActivity.daysPerWeek
                            : sum.structuredActivity.daysPerWeek.toFixed(1)}{" "}
                          day{Math.round(sum.structuredActivity.daysPerWeek) === 1 ? "" : "s"}/week
                          {sum.structuredActivity.avgMinutesPerSession
                            ? ` · ${sum.structuredActivity.avgMinutesPerSession} min/session`
                            : ""}
                          {sum.structuredActivity.intensity
                            ? ` · ${sum.structuredActivity.intensity}`
                            : ""}
                        </span>
                      </li>
                    )}
                    {/* Meals — FIX 4: show exact structured values, fallback to note */}
                    {(sum?.meals?.frequency != null || sum?.meals?.note) && (
                      <li className="ep-wellness-routine__row">
                        <span className="ep-wellness-routine__label">Meals</span>
                        <span className="ep-wellness-routine__value">
                          {sum.meals.frequency != null
                            ? `${sum.meals.frequency} meal${sum.meals.frequency === 1 ? "" : "s"}/day${sum.meals.estimatedKcal != null ? ` (~${sum.meals.estimatedKcal} kcal)` : ""}`
                            : sum.meals.note}
                        </span>
                      </li>
                    )}
                    {/* Snacks — FIX 4: show exact structured values, fallback to note */}
                    {(sum?.snacks?.frequency != null || sum?.snacks?.note) && (
                      <li className="ep-wellness-routine__row">
                        <span className="ep-wellness-routine__label">Snacks</span>
                        <span className="ep-wellness-routine__value">
                          {sum.snacks.frequency != null
                            ? `${sum.snacks.frequency} snack${sum.snacks.frequency === 1 ? "" : "s"}/day${sum.snacks.estimatedKcal != null ? ` (~${sum.snacks.estimatedKcal} kcal)` : ""}`
                            : sum.snacks.note}
                        </span>
                      </li>
                    )}
                    {/* Intake vs activity — directional label (FIX 1) */}
                    {sum?.energyComparison && (
                      <li className="ep-wellness-routine__row ep-wellness-routine__row--meta">
                        <span className="ep-wellness-routine__label">Intake vs activity</span>
                        <span className="ep-wellness-routine__value ep-wellness-routine__value--soft">
                          {sum.energyComparison.qualitativeRead === "higher"
                            ? "Intake may appear higher relative to recorded activity (directional estimate)"
                            : sum.energyComparison.qualitativeRead === "lower"
                              ? "Intake may appear lower relative to recorded activity (directional estimate)"
                              : "Relationship between intake and recorded activity is unclear this period"}
                        </span>
                      </li>
                    )}
                  </ul>
                </section>

                {/* ── Section 2: What this means ────────────────────── */}
                <section className="ep-wellness-meaning" aria-labelledby="ep-wellness-meaning-title">
                  <h2 id="ep-wellness-meaning-title" className="ep-wellness-meaning__title">
                    What this means
                  </h2>

                  {/* Primary takeaway — bold entry point */}
                  {pw.wellnessPrimaryTakeaway && (
                    <p className="ep-wellness-meaning__takeaway">{pw.wellnessPrimaryTakeaway}</p>
                  )}

                  {/* Combined behavioral insight (if 2+ factors) */}
                  {pw.wellnessCombinedInsight && (
                    <p className="ep-wellness-meaning__combined">{pw.wellnessCombinedInsight}</p>
                  )}

                  {/* Energy context note (FIX 1-4: hedged, limitation shown) */}
                  {pw.wellnessEnergyNote ? (
                    <>
                      <p className="ep-wellness-meaning__detail">{pw.wellnessEnergyNote.body}</p>
                      <p className="ep-wellness-meaning__meta ep-wellness-meaning__meta--soft">
                        {pw.wellnessEnergyNote.limitationNote}
                      </p>
                    </>
                  ) : pw.wellnessInterpretationDetail ? (
                    <p className="ep-wellness-meaning__detail">{pw.wellnessInterpretationDetail}</p>
                  ) : null}

                  {/* Consistency */}
                  {pw.wellnessConsistencyNote && (
                    <p className="ep-wellness-meaning__meta">{pw.wellnessConsistencyNote}</p>
                  )}

                  {/* Data quality note — positive (green) when data is complete,
                      warning (amber) when gaps or sparse data are detected */}
                  {pw.wellnessDataQualityNote && (
                    <p className={[
                      "ep-wellness-meaning__data-quality",
                      pw.wellnessDataQualityNote.type === "positive"
                        ? "ep-wellness-meaning__data-quality--positive"
                        : "ep-wellness-meaning__data-quality--warning",
                    ].join(" ")}>
                      {pw.wellnessDataQualityNote.message ?? pw.wellnessDataQualityNote}
                    </p>
                  )}

                  {/* Variability — only shown when well-data note is absent or
                      addresses different concern (periodCount sparsity) */}
                  {pw.wellnessVariabilityNote && (
                    <p className="ep-wellness-meaning__meta ep-wellness-meaning__meta--soft">
                      {pw.wellnessVariabilityNote}
                    </p>
                  )}

                  {/* FIX 7 — Reality check line */}
                  <p className="ep-wellness-meaning__reality-check">
                    This reflects patterns in your logged routine — real results can vary based on consistency and other factors.
                  </p>
                </section>

                {/* ── Section 3: What you can do ────────────────────── */}
                {pw.wellnessActionableInsights?.length > 0 && (
                  <section className="ep-wellness-actions" aria-labelledby="ep-actions-title">
                    <h2 id="ep-actions-title" className="ep-wellness-section__title">What you can do</h2>
                    <ol className="ep-wellness-actions__list">
                      {pw.wellnessActionableInsights.map((ins) => (
                        <li key={ins.id} className="ep-wellness-actions__item">
                          <p className="ep-wellness-actions__obs">{ins.observation}</p>
                          <p className="ep-wellness-actions__impact">{ins.impact}</p>
                          <p className="ep-wellness-actions__action">{ins.action}</p>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                {/* ── Section 4: Projection ─────────────────────────── */}
                {(pw.wellnessProjectionNote || wellnessHorizonBanner) && (
                  <section className="ep-wellness-projection" aria-labelledby="ep-projection-title">
                    <h2 id="ep-projection-title" className="ep-wellness-section__title">Projection</h2>
                    {pw.wellnessProjectionNote && (
                      <p className="ep-wellness-projection__body">{pw.wellnessProjectionNote}</p>
                    )}
                    {wellnessHorizonBanner && (
                      <p className="ep-wellness-projection__horizon">
                        At the current slope: one week ≈ {wellnessHorizonBanner.week}; one month ≈{" "}
                        {wellnessHorizonBanner.month}; six months ≈ {wellnessHorizonBanner.sixMonths}; one year ≈{" "}
                        {wellnessHorizonBanner.year}.
                      </p>
                    )}
                    <p className="ep-wellness-projection__disclaimer">
                      These are directional estimates — real progress is rarely linear.
                    </p>
                  </section>
                )}

                {/* ── Section 5: Goal analysis (wellness) ──────────── */}
                {pw.intentAnalysis?.goalAnalysis && (
                  <section
                    className="ep-intent-section ep-intent-section--goal"
                    aria-labelledby="ep-wellness-goal-title"
                  >
                    <h2 id="ep-wellness-goal-title" className="ep-intent-section__title">
                      Can you reach your goal?
                    </h2>
                    <p className="ep-intent-section__body">{pw.intentAnalysis.goalAnalysis.summary}</p>
                    {pw.intentAnalysis.goalAnalysis.rateDerivation && (
                      <p className="ep-goal-rate-derivation">{pw.intentAnalysis.goalAnalysis.rateDerivation}</p>
                    )}
                    {pw.intentAnalysis.goalAnalysis.strategies?.length > 0 && (
                      <div className="ep-goal-strategies">
                        <p className="ep-goal-strategies__intro">Here are a few ways you could approach this:</p>
                        <ul className="ep-goal-strategies__list">
                          {pw.intentAnalysis.goalAnalysis.strategies.map((s, i) => (
                            <li key={i} className="ep-goal-strategies__item">{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="ep-intent-section__disclaimer">
                      Directional estimate — actual results depend on consistency and factors not captured in this data.
                    </p>
                  </section>
                )}

                {/* ── Disclaimer ────────────────────────────────────── */}
                <p className="ep-wellness-disclaimer">
                  General wellness information only — not medical or nutritional advice. Talk to a qualified
                  clinician before making significant changes to your diet, exercise, or health routine.
                </p>
              </>
            );
          })() : null}

          {/* ══ Intent analysis sections (inventory · sales · workforce) ══ */}
          {isIntentView && intentAnalysis && (() => {
            const out = intentLabels.output;
            return (
              <>
                {/* ── Section: Interpretation ──── */}
                {intentAnalysis.interpretation && (
                  <section className="ep-intent-section" aria-labelledby="ep-intent-interp-title">
                    <h2 id="ep-intent-interp-title" className="ep-intent-section__title">
                      {out.interpretation}
                    </h2>
                    <p className="ep-intent-section__body">{intentAnalysis.interpretation}</p>
                  </section>
                )}

                {/* ── Section: Actions ─────────── */}
                {intentAnalysis.actions?.length > 0 && (
                  <section className="ep-intent-section" aria-labelledby="ep-intent-actions-title">
                    <h2 id="ep-intent-actions-title" className="ep-intent-section__title">
                      {out.actions}
                    </h2>
                    <ol className="ep-intent-section__actions">
                      {intentAnalysis.actions.map((text, i) => (
                        <li key={i} className="ep-intent-section__action-item">{text}</li>
                      ))}
                    </ol>
                  </section>
                )}

                {/* ── Section: Projection ─────── */}
                {intentAnalysis.projection && (
                  <section
                    className="ep-intent-section ep-intent-section--projection"
                    aria-labelledby="ep-intent-proj-title"
                  >
                    <h2 id="ep-intent-proj-title" className="ep-intent-section__title">
                      {out.projection}
                    </h2>
                    <p className="ep-intent-section__body">{intentAnalysis.projection}</p>
                    <p className="ep-intent-section__disclaimer">
                      This is a directional estimate — actual results depend on factors not captured in this data.
                    </p>
                  </section>
                )}

                {/* ── Section: Goal analysis ─── */}
                {intentAnalysis.goalAnalysis && (
                  <section
                    className="ep-intent-section ep-intent-section--goal"
                    aria-labelledby="ep-intent-goal-title"
                  >
                    <h2 id="ep-intent-goal-title" className="ep-intent-section__title">
                      {out.goalHeader}
                    </h2>
                    {analyzerIntent === "workforce" && (
                      <p className="ep-intent-section__scope-note">Looking at the team as a whole:</p>
                    )}
                    <p className="ep-intent-section__body">{intentAnalysis.goalAnalysis.summary}</p>
                    {intentAnalysis.goalAnalysis.rateDerivation && (
                      <p className="ep-goal-rate-derivation">{intentAnalysis.goalAnalysis.rateDerivation}</p>
                    )}
                    {intentAnalysis.goalAnalysis.strategies?.length > 0 && (
                      <div className="ep-goal-strategies">
                        <p className="ep-goal-strategies__intro">Here are a few ways you could approach this:</p>
                        <ul className="ep-goal-strategies__list">
                          {intentAnalysis.goalAnalysis.strategies.map((s, i) => (
                            <li key={i} className="ep-goal-strategies__item">{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="ep-intent-section__disclaimer">
                      Directional estimate — actual results depend on factors not captured in this data.
                    </p>
                  </section>
                )}
              </>
            );
          })()}

          {/* ── Top row: ActionQueue + PrioritySummary ──────────────── */}
          <div className="ep-screen__top-row">
            <ActionQueue entities={sorted} onScrollTo={handleScrollTo} />
            <div className="ep-screen__summary-aside">
              <span className="ep-screen__summary-aside-label">Urgency breakdown</span>
              <PrioritySummary entities={sorted} />
            </div>
          </div>

          {/* ── Ranked entity table (Phase 2: expandable rows) ──────── */}
          <div className="ep-screen__table-section">
            <div className="ep-screen__table-header">
              <h2 className="ep-screen__table-title">All Entities</h2>
              <span className="ep-screen__table-count">
                {sorted.length} {sorted.length === 1 ? "entity" : "entities"} · click any row for details
              </span>
            </div>
            <EntityTable
              entities={sorted}
              scrollRefMap={scrollRefMap}
              expandedId={expandedId}
              onSetExpanded={setExpandedId}
            />
          </div>
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { recordReasoningOverrideFeedback } from "../clairaApiClient.js";
import {
  buildReasoningViewModel,
  extractCategoryChoices,
  pipelineRowFilename,
} from "../utils/reasoningViewModel.js";
import "./ReasoningPanel.css";

/**
 * @param {unknown} v
 */
function fmtNum(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const d = abs >= 1 || abs === 0 ? 3 : 4;
  return String(Number(v.toFixed(d)));
}

/**
 * @param {string | null} s
 */
function fmtStr(s) {
  return s != null && String(s).trim() ? String(s).trim() : "—";
}

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
function normEq(a, b) {
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

/**
 * Claira reasoning inspector + category override (feedbackStore only; no pipeline re-run).
 *
 * @param {{
 *   pipelineRow: unknown,
 *   emptyHint?: string,
 *   rowKey?: string,
 * }} props
 */
export default function ReasoningPanel({ pipelineRow, emptyHint, rowKey = "" }) {
  const vm = useMemo(() => buildReasoningViewModel(pipelineRow), [pipelineRow]);
  const { suggested, choices } = useMemo(() => extractCategoryChoices(vm), [vm]);
  const filename = useMemo(() => pipelineRowFilename(pipelineRow), [pipelineRow]);

  const [selectedCategory, setSelectedCategory] = useState("");
  const [userOverride, setUserOverride] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState(/** @type {"idle" | "ok" | "error"} */ ("idle"));

  const identity = `${rowKey}|${filename}`;
  const choiceKey = useMemo(() => choices.map((c) => c.value).join("|"), [choices]);

  useEffect(() => {
    const init = suggested ?? choices[0]?.value ?? "";
    setSelectedCategory(init);
    setUserOverride(false);
    setFeedbackStatus("idle");
  }, [identity, suggested, choiceKey]);

  const onCategoryChange = useCallback(
    async (nextRaw) => {
      const next = String(nextRaw ?? "").trim();
      setSelectedCategory(next);
      const override = !normEq(next, suggested);
      setUserOverride(override);
      setFeedbackStatus("idle");
      if (!override || !next) return;
      try {
        await recordReasoningOverrideFeedback({
          originalCategory: suggested,
          correctedCategory: next,
          chosenCategory: next,
          filename,
          originalLabels: suggested ? [suggested] : [],
          semanticTokens: vm.intentCandidates.map((c) => c.label).filter(Boolean).slice(0, 12),
          labelThemes: ["reasoning_panel_override"],
          reasoningContext: {
            source: "reasoning_panel",
            userOverride: true,
            reasoningConfidence: vm.reasoningConfidence,
            signalState: vm.signalState,
            signalConflictLevel: vm.signalConflictLevel,
            intentCanonical: vm.intentCanonical,
          },
        });
        setFeedbackStatus("ok");
      } catch {
        setFeedbackStatus("error");
      }
    },
    [filename, suggested, vm.intentCandidates, vm.reasoningConfidence, vm.signalState, vm.signalConflictLevel, vm.intentCanonical],
  );

  const altJson = useMemo(() => {
    try {
      return JSON.stringify(vm.alternativeCategoriesDetailed, null, 2);
    } catch {
      return "—";
    }
  }, [vm.alternativeCategoriesDetailed]);

  return (
    <aside className="reasoning-panel" aria-label="Claira reasoning details">
      <h3 className="reasoning-panel__title">Reasoning</h3>
      {emptyHint ? <p className="reasoning-panel__hint">{emptyHint}</p> : null}
      <p className="reasoning-panel__hint" style={{ marginBottom: "0.5rem" }}>
        Asset: <strong>{vm.assetLabel}</strong>
        {!vm.hasPayload && pipelineRow != null ? (
          <span> · No Claira reasoning items on this row (moduleResults.claira_reasoning.data.items empty).</span>
        ) : null}
      </p>

      <section className="reasoning-panel__section reasoning-panel__section--interactive" aria-labelledby="rp-category">
        <h4 id="rp-category" className="reasoning-panel__section-title">
          Category
        </h4>
        <div className={`reasoning-panel__category-bar ${userOverride ? "reasoning-panel__category-bar--override" : ""}`}>
          <div className="reasoning-panel__category-line">
            <span className="reasoning-panel__badge reasoning-panel__badge--suggested">Suggested</span>
            <span className={userOverride ? "reasoning-panel__strike" : ""}>{fmtStr(suggested)}</span>
          </div>
          <div className="reasoning-panel__category-line">
            <label htmlFor="reasoning-panel-category-select" className="reasoning-panel__select-label">
              <span className="reasoning-panel__badge reasoning-panel__badge--selected">Selected</span>
            </label>
            <select
              id="reasoning-panel-category-select"
              className="reasoning-panel__select"
              value={selectedCategory}
              disabled={choices.length === 0}
              onChange={(e) => void onCategoryChange(e.target.value)}
            >
              {choices.length === 0 ? (
                <option value="">— no categories —</option>
              ) : (
                choices.map((c) => (
                  <option key={`${c.source}-${c.value}`} value={c.value}>
                    {c.value} ({c.source === "refined" ? "refined" : "alternative"})
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
        {userOverride ? (
          <p className="reasoning-panel__diff" role="status">
            Differs from Claira’s suggestion — corrective feedback recorded (does not re-run the pipeline).
          </p>
        ) : null}
        {feedbackStatus === "ok" ? (
          <p className="reasoning-panel__feedback-ok" role="status">
            Feedback saved to store.
          </p>
        ) : null}
        {feedbackStatus === "error" ? (
          <p className="reasoning-panel__feedback-err" role="alert">
            Could not save feedback — check that the dev API is running.
          </p>
        ) : null}
      </section>

      <section className="reasoning-panel__section" aria-labelledby="rp-decision">
        <h4 id="rp-decision" className="reasoning-panel__section-title">
          Decision
        </h4>
        <dl className="reasoning-panel__grid">
          <dt className="reasoning-panel__dt">refinedCategory</dt>
          <dd className={`reasoning-panel__dd ${userOverride ? "reasoning-panel__strike" : ""}`}>{fmtStr(vm.refinedCategory)}</dd>
          <dt className="reasoning-panel__dt">reasoningConfidence</dt>
          <dd className="reasoning-panel__dd">{fmtNum(vm.reasoningConfidence)}</dd>
        </dl>
      </section>

      <section className="reasoning-panel__section" aria-labelledby="rp-signals">
        <h4 id="rp-signals" className="reasoning-panel__section-title">
          Signals
        </h4>
        <dl className="reasoning-panel__grid">
          <dt className="reasoning-panel__dt">signalAgreementScore</dt>
          <dd className="reasoning-panel__dd">{fmtNum(vm.signalAgreementScore)}</dd>
          <dt className="reasoning-panel__dt">signalConflictLevel</dt>
          <dd className="reasoning-panel__dd">{fmtStr(vm.signalConflictLevel)}</dd>
          <dt className="reasoning-panel__dt">signalState</dt>
          <dd className="reasoning-panel__dd">{fmtStr(vm.signalState)}</dd>
          <dt className="reasoning-panel__dt">effectiveThreshold</dt>
          <dd className="reasoning-panel__dd">{fmtNum(vm.effectiveThreshold)}</dd>
        </dl>
      </section>

      <section className="reasoning-panel__section" aria-labelledby="rp-memory">
        <h4 id="rp-memory" className="reasoning-panel__section-title">
          Memory
        </h4>
        <dl className="reasoning-panel__grid">
          <dt className="reasoning-panel__dt">memoryInfluenceScore</dt>
          <dd className="reasoning-panel__dd">{fmtNum(vm.memoryInfluenceScore)}</dd>
          <dt className="reasoning-panel__dt">weightTier</dt>
          <dd className="reasoning-panel__dd">{fmtStr(vm.weightTier)}</dd>
          <dt className="reasoning-panel__dt">historicalConfidence</dt>
          <dd className="reasoning-panel__dd">{fmtNum(vm.historicalConfidence)}</dd>
          <dt className="reasoning-panel__dt">usageCount</dt>
          <dd className="reasoning-panel__dd">{vm.usageCount != null ? String(Math.floor(vm.usageCount)) : "—"}</dd>
          <dt className="reasoning-panel__dt">successRate</dt>
          <dd className="reasoning-panel__dd">{fmtNum(vm.successRate)}</dd>
        </dl>
      </section>

      <section className="reasoning-panel__section" aria-labelledby="rp-intent">
        <h4 id="rp-intent" className="reasoning-panel__section-title">
          Intent
        </h4>
        <p className="reasoning-panel__hint" style={{ marginBottom: "0.35rem" }}>
          intentCanonical: <span className="reasoning-panel__mono">{fmtStr(vm.intentCanonical)}</span>
        </p>
        <p className="reasoning-panel__section-title" style={{ marginBottom: "0.25rem" }}>
          intentCandidates (up to 5)
        </p>
        {vm.intentCandidates.length === 0 ? (
          <p className="reasoning-panel__hint">—</p>
        ) : (
          <ol className="reasoning-panel__list">
            {vm.intentCandidates.slice(0, 5).map((c, i) => (
              <li key={`${c.label}-${i}`}>
                {c.label}
                {typeof c.score === "number" && Number.isFinite(c.score) ? ` · ${fmtNum(c.score)}` : ""}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="reasoning-panel__section" aria-labelledby="rp-alt">
        <h4 id="rp-alt" className="reasoning-panel__section-title">
          Alternatives
        </h4>
        {vm.alternativeCategoriesDetailed.length === 0 ? (
          <p className="reasoning-panel__hint">—</p>
        ) : (
          <pre className="reasoning-panel__mono">{altJson}</pre>
        )}
      </section>
    </aside>
  );
}

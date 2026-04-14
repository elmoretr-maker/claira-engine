import { useCallback, useState } from "react";
import GuidedStepChrome from "../onboarding/GuidedStepChrome.jsx";
import { ONBOARDING_STEP } from "../onboarding/onboardingFlowMeta.js";
import {
  getIntakeStructureAnswers,
  getOversightLevel,
  setIntakeStructureAnswers,
  setOversightLevel,
  setStructureSetupComplete,
} from "../userPrefs.js";
import "./StructureSetupScreen.css";

/**
 * @param {{ value: boolean | null, onChange: (v: boolean | null) => void, groupName: string }} props
 */
function TriStateRow({ value, onChange, groupName }) {
  return (
    <div className="structure-tri" role="radiogroup" aria-label={groupName}>
      <label className="structure-tri-opt">
        <input type="radio" name={groupName} checked={value === true} onChange={() => onChange(true)} />
        Yes
      </label>
      <label className="structure-tri-opt">
        <input type="radio" name={groupName} checked={value === false} onChange={() => onChange(false)} />
        No
      </label>
      <label className="structure-tri-opt">
        <input type="radio" name={groupName} checked={value === null} onChange={() => onChange(null)} />
        Not sure
      </label>
    </div>
  );
}

/**
 * @param {{ onContinue: () => void }} props
 */
export default function StructureSetupScreen({ onContinue }) {
  const saved = getIntakeStructureAnswers();
  const [multipleSizes, setMultipleSizes] = useState(/** @type {boolean | null} */ (saved?.multipleSizes ?? null));
  const [usesSkus, setUsesSkus] = useState(/** @type {boolean | null} */ (saved?.usesSkus ?? null));
  const [hasVariations, setHasVariations] = useState(/** @type {boolean | null} */ (saved?.hasVariations ?? null));
  const [oversightLevel, setOversightLocal] = useState(() => getOversightLevel());

  const handleNext = useCallback(() => {
    setIntakeStructureAnswers({ multipleSizes, usesSkus, hasVariations });
    setOversightLevel(oversightLevel);
    setStructureSetupComplete(true);
    onContinue();
  }, [multipleSizes, usesSkus, hasVariations, oversightLevel, onContinue]);

  return (
    <div className="structure-setup">
      <GuidedStepChrome step={ONBOARDING_STEP.structure} phaseLabel="Structure" />

      <div className="structure-setup-card card">
        <header className="structure-setup-header">
          <h1>How are your items structured?</h1>
          <p className="structure-setup-desc">
            This is only to set expectations in the UI—it doesn&apos;t change how the engine runs. Answer in whatever way
            feels closest; you can always adjust later.
          </p>
        </header>

        <section className="structure-q" aria-labelledby="q-sizes">
          <h2 id="q-sizes" className="structure-q-title">
            Do you have multiple sizes?
          </h2>
          <TriStateRow value={multipleSizes} onChange={setMultipleSizes} groupName="intake-sizes" />
        </section>

        <section className="structure-q" aria-labelledby="q-sku">
          <h2 id="q-sku" className="structure-q-title">
            Do you use product numbers or SKUs?
          </h2>
          <TriStateRow value={usesSkus} onChange={setUsesSkus} groupName="intake-sku" />
        </section>

        <section className="structure-q" aria-labelledby="q-var">
          <h2 id="q-var" className="structure-q-title">
            Do you have variations?
          </h2>
          <TriStateRow value={hasVariations} onChange={setHasVariations} groupName="intake-variations" />
        </section>

        <section className="structure-q structure-q--oversight" aria-labelledby="q-oversight">
          <h2 id="q-oversight" className="structure-q-title">
            How closely should I review new items?
          </h2>
          <div className="structure-oversight" role="radiogroup">
            {(
              [
                { value: "light", label: "Light — stay out of the way" },
                { value: "medium", label: "Medium — balanced" },
                { value: "strict", label: "Strict — check in more so I learn faster" },
              ]
            ).map((opt) => (
              <label key={opt.value} className="structure-oversight-opt">
                <input
                  type="radio"
                  name="oversight-structure"
                  value={opt.value}
                  checked={oversightLevel === opt.value}
                  onChange={() => setOversightLocal(/** @type {"light"|"medium"|"strict"} */ (opt.value))}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </section>

        <div className="structure-actions">
          <button type="button" className="btn btn-primary" onClick={handleNext}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

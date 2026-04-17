# Claira Engine

Standalone package for embedding-based **classification**, **config-driven routing**, **confidence/margin decisions**, and **passive learning** (correction logging in memory only). **No dependency on the game project.**

## Design principles

- **Deterministic decision pipeline** — same inputs + config → same outputs.
- **No guessing policy** — destinations only from `resolveDestination` (categories + aliases).
- **Immutable config** — `loadEngineConfig()` returns a **deep clone**; on-disk `engine.config.json` is never mutated by the engine.
- **Human-in-the-loop** — `applyDecision` records corrections when the chosen label differs from the prediction (does not change routing or classifiers).
- **Learning-ready** — in-memory `learningStore`; optional `learning_hint` on place cards when stats exist.

## Routing rule

If **`predicted_label`** resolves, it is always **`proposed_destination`**. Otherwise, cosine-ranked candidates are used in order.

## Learning (passive)

- **`recordCorrection(predicted_label, selected_label)`** — increments stats for the `predicted→selected` key (only when labels differ).
- **`getLearningStats(predicted_label, selected_label)`** — `{ count, total, confidence }` or `null` (`confidence` = mean optional model confidence stored with corrections).
- **`applyDecision({ predicted_label, selected_label, confidence? })`** — calls `recordCorrection` when `selected_label !== predicted_label`.
- **`generatePlaceCard()`** may include **`learning_hint: { seen, confidence }`** when historical stats exist for `(predicted_label, routing_label)`.

## API (Node ESM)

```js
import { analyze, generatePlaceCard, applyDecision } from "./index.js";

const result = await analyze({ inputEmbedding, referenceEmbeddingsByLabel, file: "optional/path" });
const { placeCard } = await generatePlaceCard(result);
await applyDecision({
  predicted_label: placeCard.predicted_label,
  selected_label: "user_chosen_label",
  confidence: placeCard.confidence,
});
```

## Layout

| Path | Role |
|------|------|
| `core/classifier.js` | Embeddings + scores |
| `core/decision.js` | Threshold gate |
| `routing/router.js` | Label → path |
| `learning/learningStore.js` | In-memory corrections |
| `interfaces/sessionLedger.js` | Session aggregates + report |
| `utils/loadConfig.js` | Deep-cloned config |
| `dev/smoke_test.mjs` | Smoke test (see below) |

## Development & Testing

### Smoke Test

**Location:** `dev/smoke_test.mjs`

**Purpose:**

- Verifies full pipeline: classify → route → decide → learning → session ledger

**Run** (from the `claira-engine` directory):

```bash
node dev/smoke_test.mjs
```

**Notes:**

- This is a non-destructive test
- Does not depend on external systems
- Validates core engine behavior

## Scripts

```bash
npm start
```

## Workflow System Rules

- Never commit ui/dist/ (build output)
- Always run npm run ui:build locally or in CI
- workflowBuildState is the single source of truth
- Analyzer must not mutate state directly
- No fallback logic allowed
- Clarification must resolve gaps only

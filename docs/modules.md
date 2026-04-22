# Claira Engine — Module System

This document describes the module layer of the Claira Engine: what modules are, how they are structured, and which modules have been defined.

Modules are defined in `workflow/modules/`. All modules must pass `assertEngineContract` before being registered with the module orchestrator.

For execution and ordering behavior, see `docs/architecture.md`. For the Claira Insights system, see `docs/claira-insights.md`.

---

## Core Principle

> Modules are orchestration wrappers. The engine is the only executor.

A module:

- declares which artifact kinds it consumes and produces
- shapes consumed artifact data into an engine payload (`buildPayload`)
- calls `runClaira(kind, payload, context)` for each `engineKind`
- normalizes engine output into artifact records (`normalizeToArtifacts`)

A module must **not**:

- implement scoring, ranking, analysis, classification, or recommendation logic
- call pipeline functions directly
- share raw JavaScript objects between modules instead of artifact records
- call `CLAIRA_RUN_HANDLERS` as a direct map lookup

All of this is enforced by `assertEngineContract` in `workflow/modules/moduleContract.js`.

---

## Artifact Kind Vocabulary

All `consumes` and `produces` entries use registered kinds from `workflow/pipeline/artifactKindRegistry.js`:

| Kind | Semantic meaning |
|------|-----------------|
| `entity` | Named, trackable items (products, clients, members, etc.) |
| `event` | Timestamped occurrences against entities (deliveries, sales, etc.) |
| `asset` | Files, images, or binary content |
| `analysis` | Computed analytical output (deltas, trends, comparisons) |
| `aggregate` | Summarized or ordered collections (snapshots, rankings, alerts) |
| `deliverable` | Final output intended for user action (recommendations, reports) |
| `ui_model` | Structured data driving UI rendering |

The `artifactType` field on each artifact record (e.g. `"EntitySet"`, `"SnapshotSet"`, `"TrendReport"`) distinguishes specific types within a kind. This is module-level data, not part of the artifact kind vocabulary.

---

# Module System — Shoe Store Workflow (Section 15)

This module set defines the first complete real-world workflow built on the Claira engine, using inventory tracking for a shoe store as the reference domain.

The workflow is **domain-agnostic**. The same module set applies verbatim to clothing, electronics, medical supplies, gym equipment, or any entity-with-quantity domain.

---

## Overview

This module set demonstrates:

- entity tracking (register and maintain trackable items)
- state logging (record point-in-time state per entity)
- event logging (correctly separated delivery and sale events)
- analytical processing (compute deltas, interpret trends)
- ranking and recommendation pipeline (order by performance, generate actions)

---

## Key Design Decisions

### Event Separation

The original `event_logger` module has been replaced by two separate modules:

- `delivery_logger`
- `sales_logger`

**Reason:** delivery and sale events represent different event semantics, carry different payload shapes, produce different artifact types (`DeliveryEventLog` vs `SalesEventLog`), and serve as separate inputs to the delta computation step. Combining them violates plan.md §16 Rule 1 (single responsibility).

Both modules use the same underlying engine kind (`addTrackingSnapshot`) with an `eventType` field in the payload as the distinguisher — the distinction is in the payload, not the architecture.

---

### Processing Layer Separation

Processing modules are strictly layered. Each module transforms data without mixing responsibilities:

| Step | Module | Input | Output | Responsibility |
|------|--------|-------|--------|----------------|
| 1 | `state_delta_computer` | SnapshotSet + EventLogs | StateDelta | Raw numerical changes |
| 2 | `trend_interpreter` | StateDelta | TrendReport | Direction and velocity (meaning) |
| 3 | `ranking_engine` | TrendReport | RankedEntities | Ordering by performance metric |
| 4 | `recommendation_generator` | AlertSet + RankedEntities | RecommendationSet | Actionable output |

No step is combined with another. Each can be individually tested, replaced, or extended.

---

## Module List

### Tracking Modules — Existing Engine Capabilities

All `engineKinds` listed below exist in `CLAIRA_RUN_HANDLERS`.

---

#### `entity_registry`

| Field | Value |
|-------|-------|
| File | `workflow/modules/entityRegistryModule.js` |
| Pipeline type | `tracking` |
| Engine kinds | `createTrackingEntity` ✅, `listTrackingEntities` ✅ |
| Consumes | `entity` → artifact type: `RawEntityInput` (from `entity_input`) |
| Produces | `entity` (mode: `create`) → artifact type: `EntitySet` |
| Purpose | Register ingested entity definitions as durable tracked records. Distinct from `entity_input` which handles raw ingestion. |

---

#### `inventory_snapshot_logger`

| Field | Value |
|-------|-------|
| File | `workflow/modules/inventorySnapshotLoggerModule.js` |
| Pipeline type | `tracking` |
| Engine kinds | `addTrackingSnapshot` ✅, `listTrackingSnapshots` ✅ |
| Consumes | `entity` → artifact type: `EntitySet` |
| Produces | `aggregate` (mode: `create`) → artifact type: `SnapshotSet` |
| Purpose | Record the current state of each entity as a point-in-time snapshot. **STATE**, not an event. Produces the baseline for delta computation. |

---

#### `delivery_logger`

| Field | Value |
|-------|-------|
| File | `workflow/modules/deliveryLoggerModule.js` |
| Pipeline type | `tracking` |
| Engine kinds | `addTrackingSnapshot` ✅ (payload: `eventType: "delivery"`) |
| Consumes | `entity` → artifact type: `EntitySet` |
| Produces | `event` (mode: `create`) → artifact type: `DeliveryEventLog` |
| Purpose | Record incoming stock deliveries as timestamped events. **EVENT**, not a state update. |

---

#### `sales_logger`

| Field | Value |
|-------|-------|
| File | `workflow/modules/salesLoggerModule.js` |
| Pipeline type | `tracking` |
| Engine kinds | `addTrackingSnapshot` ✅ (payload: `eventType: "sale"`) |
| Consumes | `entity` → artifact type: `EntitySet` |
| Produces | `event` (mode: `create`) → artifact type: `SalesEventLog` |
| Purpose | Record outgoing sales as timestamped events. **EVENT**, not a state update. |

---

### Processing Modules — New Engine Capabilities Required

All `engineKinds` listed below **do not yet exist** in `CLAIRA_RUN_HANDLERS`. Modules are fully defined and pass `assertEngineContract`, but cannot execute until the corresponding engine kinds are built and registered.

---

#### `state_delta_computer`

| Field | Value |
|-------|-------|
| File | `workflow/modules/stateDeltaComputerModule.js` |
| Pipeline type | `processing` |
| Engine kinds | `computeStateDelta` ❌ **must be built** |
| Consumes | `aggregate` → `SnapshotSet`; `event` → `DeliveryEventLog` + `SalesEventLog` |
| Produces | `analysis` (mode: `create`) → artifact type: `StateDelta` |
| Purpose | Compute raw per-entity numerical differences between baseline state and event history. Produces numbers — not meaning. |
| Engine input | `{ snapshots[], deliveryEvents[], saleEvents[] }` |
| Engine output | `{ deltas: [{ entityId, startValue, endValue, netDelta, deliveryTotal, salesTotal }] }` |

`buildPayload` distinguishes `DeliveryEventLog` from `SalesEventLog` within the `"event"` kind by filtering on `artifact.artifactType`.

---

#### `trend_interpreter`

| Field | Value |
|-------|-------|
| File | `workflow/modules/trendInterpreterModule.js` |
| Pipeline type | `processing` |
| Engine kinds | `interpretTrends` ❌ **must be built** |
| Consumes | `analysis` → `StateDelta` |
| Produces | `analysis` (mode: `derive`) → artifact type: `TrendReport` |
| Purpose | Interpret raw delta values into directional trend signals. Produces meaning — not numbers. Distinct from `state_delta_computer`. |
| Engine input | `{ deltas[], velocityWindow? }` |
| Engine output | `{ trends: [{ entityId, direction: "up"\|"down"\|"flat", velocity, periodCount }] }` |

---

#### `ranking_engine`

| Field | Value |
|-------|-------|
| File | `workflow/modules/rankingEngineModule.js` |
| Pipeline type | `processing` |
| Engine kinds | `analyzePerformanceTrends` ❌ **must be built** |
| Consumes | `analysis` → `TrendReport` |
| Produces | `aggregate` (mode: `create`) → artifact type: `RankedEntities` |
| Purpose | Sort and rank entities by a configurable performance metric. Produces order — not labels. |
| Engine input | `{ trends[], rankBy: "velocity"\|"netDelta"\|"salesTotal" }` |
| Engine output | `{ entities: [{ entityId, label, rank, score }] }` sorted descending |
| `moduleOptions.rankBy` | Default: `"velocity"`. Configures sort metric without changing module structure. |

---

#### `recommendation_generator`

| Field | Value |
|-------|-------|
| File | `workflow/modules/recommendationGeneratorModule.js` |
| Pipeline type | `processing` |
| Engine kinds | `generateRecommendations` ❌ **must be built** |
| Consumes | `aggregate` → `AlertSet` + `RankedEntities` (distinguished by `artifactType` within same kind) |
| Produces | `deliverable` (mode: `create`) → artifact type: `RecommendationSet` |
| Purpose | Generate actionable recommendations from alert conditions and ranked performance data. |
| Engine input | `{ alerts[], rankedEntities[], actionTypes? }` |
| Engine output | `{ recommendations: [{ entityId, label, action, urgency: "high"\|"medium"\|"low", reason }] }` |
| `moduleOptions.actionTypes` | e.g. `["reorder", "promote", "retire"]` — passed to engine to scope output types |

---

### Pending Modules — Defined in plan.md §15, Not Yet Written

These two modules are required to complete the full workflow chain. They are architecturally defined in `plan.md §15` (Modules 9 and 10) but module files have not been created yet.

| Module | Requires | Consumes | Produces |
|--------|----------|----------|----------|
| `performance_classifier` | `classifyPerformance` ❌ | `aggregate` (RankedEntities) | `aggregate` (PerformanceLabels) |
| `threshold_evaluator` | `evaluateThresholds` ❌ | `aggregate` (SnapshotSet + PerformanceLabels) | `aggregate` (AlertSet) |

`threshold_evaluator` must run before `recommendation_generator`. `performance_classifier` must run before `threshold_evaluator`.

---

## Artifact Flow (Canonical)

```
[User provides entity definitions]
        │
        ▼
entity_input                         (kind: ingestData ✅)
        │ produces: entity (RawEntityInput)
        ▼
entity_registry                      (kinds: createTrackingEntity ✅, listTrackingEntities ✅)
        │ produces: entity (EntitySet)
        │
        ├─────────────────────────────────────────────┐
        │                                             │
        ▼                                             ▼
inventory_snapshot_logger           delivery_logger + sales_logger
(addTrackingSnapshot ✅)             (addTrackingSnapshot ✅, eventType: "delivery"/"sale")
        │                                             │
        │ produces: aggregate (SnapshotSet / STATE)   │ produces: event (DeliveryEventLog, SalesEventLog / EVENTS)
        │                                             │
        └──────────────────────┬──────────────────────┘
                               │
                               ▼
state_delta_computer           (kind: computeStateDelta ❌)
consumes: aggregate (SnapshotSet) + event (DeliveryEventLog, SalesEventLog)
        │ produces: analysis (StateDelta)
        ▼
trend_interpreter              (kind: interpretTrends ❌)
consumes: analysis (StateDelta)
        │ produces: analysis (TrendReport)
        ▼
ranking_engine                 (kind: analyzePerformanceTrends ❌)
consumes: analysis (TrendReport)
        │ produces: aggregate (RankedEntities)
        ▼
performance_classifier         (kind: classifyPerformance ❌)  [PENDING MODULE]
consumes: aggregate (RankedEntities)
        │ produces: aggregate (PerformanceLabels)
        ▼
threshold_evaluator            (kind: evaluateThresholds ❌)   [PENDING MODULE]
consumes: aggregate (SnapshotSet + PerformanceLabels)
        │ produces: aggregate (AlertSet)
        ▼
recommendation_generator       (kind: generateRecommendations ❌)
consumes: aggregate (AlertSet + RankedEntities)
        │ produces: deliverable (RecommendationSet)
        ▼
dashboard_presenter            (UI only — no engine call)
renders all artifacts from session artifact store
```

---

## Capability Gap Summary

| Engine kind | Status | Required by |
|-------------|--------|-------------|
| `createTrackingEntity` | ✅ exists | `entity_registry` |
| `listTrackingEntities` | ✅ exists | `entity_registry` |
| `addTrackingSnapshot` | ✅ exists | `inventory_snapshot_logger`, `delivery_logger`, `sales_logger` |
| `listTrackingSnapshots` | ✅ exists | `inventory_snapshot_logger` |
| `computeStateDelta` | ❌ **missing** | `state_delta_computer` |
| `interpretTrends` | ❌ **missing** | `trend_interpreter` |
| `analyzePerformanceTrends` | ❌ **missing** | `ranking_engine` |
| `classifyPerformance` | ❌ **missing** | `performance_classifier` *(module pending)* |
| `evaluateThresholds` | ❌ **missing** | `threshold_evaluator` *(module pending)* |
| `generateRecommendations` | ❌ **missing** | `recommendation_generator` |

**4 missing engine kinds** affect the 4 modules written in this phase.
**2 additional engine kinds** (`classifyPerformance`, `evaluateThresholds`) are required by the 2 pending module definitions.

The workflow **cannot fully execute end-to-end** until all 6 missing engine kinds are built and registered. The tracking layer (entity_registry, inventory_snapshot_logger, delivery_logger, sales_logger) is **immediately executable** with existing capabilities.

---

## Validation

| Rule | Status |
|------|--------|
| All 8 modules pass `assertEngineContract` | ✅ 26/26 assertions, 0 failures |
| No module contains business logic | ✅ verified — all logic delegated to `engineKinds` |
| All `consumes` entries use registered `ARTIFACT_KINDS` | ✅ |
| All `produces` entries use `{ kind, mode }` with valid values | ✅ |
| `event_logger` correctly split into `delivery_logger` + `sales_logger` | ✅ per plan.md §16 Rule 1 |
| All artifact types resolve via artifact system (no raw object passing) | ✅ |
| All `buildPayload` functions fail clearly on missing prerequisites | ✅ |
| No modifications to execution system, artifact store, or orchestrator | ✅ |

---

# Next Phase: Engine Capability Implementation

---

## Goal

Implement the missing `engineKinds` required by the Section 15 processing modules. This is the next concrete implementation step after the module definition phase.

---

## Priority Order

Implement in this exact order:

| Priority | Engine kind | Unblocks |
|----------|-------------|---------|
| 1 | `computeStateDelta` | `state_delta_computer` → all downstream modules |
| 2 | `interpretTrends` | `trend_interpreter` → `ranking_engine`, `recommendation_generator` |
| 3 | `analyzePerformanceTrends` | `ranking_engine` → `performance_classifier`, `threshold_evaluator` |
| 4 | `generateRecommendations` | `recommendation_generator` → complete workflow |

`classifyPerformance` and `evaluateThresholds` are not listed here because their modules (`performance_classifier`, `threshold_evaluator`) have not been written yet. They should be implemented after those module definitions are created.

---

## Reasoning

- `computeStateDelta` is the root dependency — without it, no processing module can execute
- `interpretTrends` requires `StateDelta` as input — builds directly on step 1
- `analyzePerformanceTrends` requires `TrendReport` as input — builds directly on step 2
- `generateRecommendations` requires `AlertSet` + `RankedEntities` — the final stage; depends on modules still pending
- This order enables incremental integration testing after each step: the system becomes partially executable after step 1, more complete after step 2, and so on

---

## Implementation Rules

- Engine logic **only** inside `CLAIRA_RUN_HANDLERS` in `server/index.js`
- **No logic added to modules** — module files are closed; do not modify them
- Each `engineKind` must:
  - validate its input payload (throw clearly on missing or malformed fields)
  - execute all computation internally (no delegation to module layer)
  - return a normalized output matching the shape defined in the module's `normalizeToArtifacts`
  - be independently callable and testable via `runClaira(kind, payload, context)` in isolation

---

## Input/Output Schemas (From Module Definitions)

Each schema is defined in the corresponding module file. The engine handler must match these schemas exactly.

### `computeStateDelta`

```js
// Input
{
  snapshots:       SnapshotRecord[],     // from inventory_snapshot_logger
  deliveryEvents:  DeliveryEvent[],      // from delivery_logger
  saleEvents:      SaleEvent[],          // from sales_logger
}

// Output
{
  deltas: [
    { entityId, startValue, endValue, netDelta, deliveryTotal, salesTotal }
  ]
}
```

### `interpretTrends`

```js
// Input
{
  deltas:           EntityDelta[],   // from computeStateDelta output
  velocityWindow?:  number,          // optional period window
}

// Output
{
  trends: [
    { entityId, direction: "up" | "down" | "flat", velocity, periodCount }
  ]
}
```

### `analyzePerformanceTrends`

```js
// Input
{
  trends:  TrendSignal[],                                 // from interpretTrends output
  rankBy:  "velocity" | "netDelta" | "salesTotal",        // from moduleOptions
}

// Output
{
  entities: [
    { entityId, label, rank, score }          // sorted descending by score
  ]
}
```

### `generateRecommendations`

```js
// Input
{
  alerts:          AlertRecord[],     // from threshold_evaluator (AlertSet)
  rankedEntities:  RankedEntity[],    // from ranking_engine (RankedEntities)
  actionTypes?:    string[],          // from moduleOptions (e.g. ["reorder", "promote"])
}

// Output
{
  recommendations: [
    { entityId, label, action, urgency: "high" | "medium" | "low", reason }
  ]
}
```

---

## Output Requirement

Each engine kind must produce artifacts that:

- match the input/output schema defined above and in the module's `normalizeToArtifacts`
- are written to `runtimeArtifactStore` via `writeArtifact()` through the module orchestrator
- carry `producedByStepId` and `stepIndex` for artifact lineage
- produce valid `RuntimeArtifact` records that pass the artifact store's schema validation

No engine kind should write to the artifact store directly — the module orchestrator handles all artifact writes after receiving the engine result.

---

## Testing Requirement

Each engine kind must have an isolated test before being considered complete:

```js
// Minimum test shape (in dev/testComputeStateDelta.mjs, etc.)
const result = await runClaira("computeStateDelta", {
  snapshots:      [...],
  deliveryEvents: [...],
  saleEvents:     [...],
}, { accountId: "test", rid: "test-rid", source: "workflow" });

assert(Array.isArray(result.deltas));
assert(result.deltas[0].netDelta !== undefined);
```

This confirms the kind is registered, callable, and produces the expected output shape — before any full workflow integration test runs.

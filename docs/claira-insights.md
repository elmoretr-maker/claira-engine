# Claira Insights — Comparative Analysis Engine

**Status:** Architectural definition. Not yet implemented.  
**Prerequisite:** Step-Based Versioned Artifacts — implemented in v0.4-step-architecture.  
**Implementation phase:** After Phase 9 (UI Foundation).

---

## 1. System Overview

Claira Insights is a planned system layer that sits above the core workflow execution engine. Its purpose is to transform multiple versions of the same artifact — produced by different execution steps within a single workflow run — into structured, actionable insight.

The system does not replace or modify execution behavior. It is a **post-execution analysis layer** that reads from the existing artifact store, processes differences between artifact versions, and produces new comparison artifacts that the UI and downstream modules can consume.

**One-line definition:**

> Claira Insights turns execution history into decisions.

---

## 2. Why This System Exists

### 2.1 Why Multiple Artifacts Exist

The Claira execution engine supports **Step-Based Versioned Artifacts** (plan.md §19, architecture.md). When the same module runs more than once in a workflow — or when two different modules produce the same artifact type — the runtime artifact store (`runtimeArtifactStore.js`) retains both. This is by design, not a side effect.

Example workflow: `[photo_analysis, filter_photos, photo_analysis]`

| Step | stepId | Artifact Produced |
|---|---|---|
| 0 | `photo_analysis__0` | `AnalysisBatch` — full photo set |
| 1 | `filter_photos__1` | `FilteredSet` — criteria-based subset |
| 2 | `photo_analysis__2` | `AnalysisBatch` — filtered photo set |

The store now holds **two** `AnalysisBatch` artifacts. Both are preserved. Neither is deleted.

This happens for a reason: the second analysis was run on a different input (the filtered set). The difference between the two outputs is not noise — it is the measurable effect of applying a filter.

### 2.2 Why Execution Only Uses the Latest

During execution, the module orchestrator (`moduleOrchestrator.js`) follows a deterministic consumption rule: when multiple artifacts of the same type exist, modules always consume the **most recent** — the last element in the array returned by `readArtifactsByType()`.

```javascript
// Enforced by convention in moduleOrchestrator.buildConsumedArtifactsMap
const batch = consumedArtifacts["AnalysisBatch"].at(-1); // most recent
```

This rule exists to ensure:

- No ambiguity in which artifact feeds a downstream module
- No user prompt required mid-execution
- Deterministic, reproducible runs

The execution system is not designed to compare artifacts. It is designed to produce them.

### 2.3 Why Earlier Artifacts Still Matter

The artifact store intentionally retains all versions. An earlier artifact is not incorrect — it represents a **prior state of the world** under different conditions. The difference between the prior state and the current state encodes information that execution alone cannot surface:

- What changed between runs?
- Did the filter improve the result?
- Which variables drove the change?
- What should happen next?

These questions cannot be answered by a single artifact. They require comparison across versions. That is the problem Claira Insights is designed to solve.

### 2.4 Why Differences Are Meaningful

In most analytics systems, having two versions of the same data structure is a versioning problem. In Claira, it is a **measurement opportunity**.

Each `AnalysisBatch` produced at a different step represents a distinct experimental condition:

- Step 0: analysis on the full set (the baseline)
- Step 2: analysis on the filtered set (the intervention)

The delta between them is the measured effect of the intervention. Claira Insights formalizes this observation: differences between artifact versions are not anomalies — they are structured data that can be compared, ranked, and interpreted.

---

## 3. What We Already Have That Enables Claira Insights

The following capabilities are **already implemented** (v0.4-step-architecture). Claira Insights builds directly on them without modifying any existing system.

### 3.1 Step-Based Execution

`workflow/execution/workflowRunner.js` expands every module into a step with a unique `stepId` and `stepIndex` before execution begins:

```
expandToSteps([A, B, A])
→ [
    { module: A, stepId: "mod_a__0", stepIndex: 0 },
    { module: B, stepId: "mod_b__1", stepIndex: 1 },
    { module: A, stepId: "mod_a__2", stepIndex: 2 },
  ]
```

This means every execution is uniquely identified — including duplicate module runs. The same module at index 0 and at index 2 are different steps with different identities.

### 3.2 Artifact Lineage Fields

`workflow/pipeline/runtimeArtifactStore.js` stamps every artifact with step-lineage metadata at write time:

```
RuntimeArtifact {
  artifactType:     "AnalysisBatch",
  artifactId:       "uuid-...",
  producedByStepId: "photo_analysis__2",   ← which step produced it
  stepIndex:        2,                      ← its position in the run
  sessionId:        "sess_...",
  workflowRunId:    "run_...",
  moduleId:         "photo_analysis",
  rid:              "orch_...",
  createdAt:        "2026-04-21T14:03:22Z",
  data:             { ... }
}
```

Every artifact can be traced back to exactly which execution step produced it. This lineage is the foundation of artifact comparison.

### 3.3 The Runtime Artifact Store

`createRuntimeArtifactStore()` provides:

```javascript
// Read all versions of an artifact type:
readArtifactsByType(sessionId, workflowRunId, "AnalysisBatch")
→ RuntimeArtifact[]   // oldest first, most recent last

// Check existence:
hasArtifactType(sessionId, workflowRunId, "AnalysisBatch")
→ boolean

// Read everything produced in a run:
getAll(sessionId, workflowRunId)
→ RuntimeArtifact[]
```

Claira Insights needs only `readArtifactsByType` to retrieve all versions for comparison. No new store methods are required.

### 3.4 Module Orchestrator Behavior (Non-Destructive)

`moduleOrchestrator.js` consumes the most recent artifact for execution but **does not delete earlier versions**. The store's append-only contract means all prior artifacts remain fully accessible at comparison time.

### 3.5 Step-Level Ordering

`workflowOrdering.js` exports `orderSteps`, which can order comparison modules within a larger workflow that includes both production steps and comparison steps. The comparison modules are ordinary engine-aware modules — they participate in the same ordering graph as any other module.

### 3.6 Engine Contract (assertEngineContract)

All Claira Insights modules will follow the existing engine-aware module contract (`moduleContract.js`). No changes to the contract are required. New modules declare `engineKinds`, `consumes`, and `produces` exactly as existing modules do.

---

## 4. System Definition

### 4.1 Name

**Claira Insights**  
Also referred to as the **Comparative Analysis Engine**.

### 4.2 Purpose

| Purpose | Description |
|---|---|
| **Compare** | Identify structural differences between artifact versions |
| **Analyze** | Determine what changed, how much it changed, and in which direction |
| **Attribute** | Link changes to the execution steps and conditions that caused them |
| **Rank** | Order results by performance against defined metrics |
| **Recommend** | Produce prioritized next actions based on the comparison |

### 4.3 Guiding Principle

> Claira Insights does not run alongside execution. It runs **after** execution, on artifacts that already exist. It reads. It does not write to execution state.

---

## 5. Inputs

All inputs come from the runtime artifact store. No new storage mechanism is required.

### 5.1 Required Inputs

| Input | Type | Source |
|---|---|---|
| Two or more artifact records of the same `artifactType` | `RuntimeArtifact[]` | `runtimeArtifactStore.readArtifactsByType()` |
| `stepId` for each artifact | `string` | Stamped by `moduleOrchestrator` — field: `producedByStepId` |
| `stepIndex` for each artifact | `number` | Stamped by `moduleOrchestrator` — field: `stepIndex` |
| `artifactType` | `string` | The type token shared by all versions being compared |
| `data` payload | `unknown` | The domain-specific content of each artifact |

### 5.2 Optional Inputs (for advanced comparison)

| Input | Type | Purpose |
|---|---|---|
| Comparison metric definition | `{ field: string, direction: "asc" \| "desc" }[]` | Specifies which fields to rank by and in which direction |
| Step labels | `{ stepId: string, label: string }[]` | Human-readable names for each step (e.g. `"Baseline"`, `"Post-filter"`) |
| Threshold definitions | `{ field: string, delta: number }[]` | Minimum delta required to flag a change as significant |

### 5.3 Selection Logic

When a comparison module runs, it selects which artifact versions to compare using `stepIndex`:

```javascript
const versions = artifactStore.readArtifactsByType(sessionId, workflowRunId, "AnalysisBatch");
// versions[0] = oldest (baseline)
// versions[versions.length - 1] = most recent (intervention result)
```

For pairwise comparison: `[versions[0], versions.at(-1)]`.  
For trend analysis across all versions: the full array.

---

## 6. Outputs — New Artifact Types

The following artifact types are **new** — they do not exist in the current system. They must be registered in `artifactKindRegistry.js` when implementation begins.

### 6.1 `ComparisonReport`

**Purpose:** Structural diff of two or more artifact `data` payloads.

```
ComparisonReport.data {
  artifactType:    string,           // the type being compared
  versions:        [
    { stepId, stepIndex, summary: string },
    ...
  ],
  fields:          [
    {
      path:          string,         // dot-path into artifact.data
      baseline:      unknown,        // value in the earlier version
      current:       unknown,        // value in the most recent version
      delta:         number | null,  // numeric delta if applicable
      changeType:    "increased" | "decreased" | "changed" | "unchanged" | "added" | "removed",
    },
    ...
  ],
  overallDelta:    "improved" | "degraded" | "neutral" | "mixed",
}
```

### 6.2 `InsightSummary`

**Purpose:** Human-readable interpretation of a `ComparisonReport`. Explains what changed, whether it was meaningful, and why.

```
InsightSummary.data {
  headline:         string,          // one sentence: "Filtering reduced the batch by 40%..."
  findings:         string[],        // bullet-level findings
  significance:     "high" | "medium" | "low" | "none",
  basedOn:          string,          // references ComparisonReport artifactId
}
```

### 6.3 `PerformanceRanking`

**Purpose:** Ranks artifact versions against each other using one or more metrics. Applicable when three or more versions exist.

```
PerformanceRanking.data {
  metric:    string,                 // e.g. "confidence_score", "entity_count"
  direction: "asc" | "desc",        // higher is better ("desc") or lower is better ("asc")
  ranking:   [
    { rank: 1, stepId: string, stepIndex: number, value: unknown },
    { rank: 2, stepId: string, stepIndex: number, value: unknown },
    ...
  ],
  winner:    string,                 // stepId of top-ranked version
}
```

### 6.4 `OptimizationRecommendation`

**Purpose:** Ranked list of next actions derived from the comparison and ranking.

```
OptimizationRecommendation.data {
  recommendations: [
    {
      rank:        number,
      action:      string,           // e.g. "Tighten the filter criteria"
      rationale:   string,           // why this action is recommended
      expectedImpact: string,        // e.g. "Increase confidence_score by ~12%"
      confidence:  "high" | "medium" | "low",
    },
    ...
  ],
  basedOn: string[],                 // artifactIds of ComparisonReport + PerformanceRanking used
}
```

---

## 7. Required Engine Capabilities (New)

The following `runClaira` kinds are **new and do not yet exist**. Each must be added to `CLAIRA_RUN_HANDLERS` in `server/index.js` when implementation begins.

### 7.1 `computeArtifactDiff`

**Purpose:** Compute the structural difference between two artifact `data` payloads of the same type.

**Input shape:**

```javascript
{
  artifactType:  string,
  baseline: {
    stepId:     string,
    stepIndex:  number,
    data:       unknown,
  },
  current: {
    stepId:     string,
    stepIndex:  number,
    data:       unknown,
  },
  metricPaths:  string[],  // dot-paths to fields of interest (optional)
}
```

**Output shape:**

```javascript
{
  fields: [
    {
      path:        string,
      baseline:    unknown,
      current:     unknown,
      delta:       number | null,
      changeType:  "increased" | "decreased" | "changed" | "unchanged" | "added" | "removed",
    }
  ],
  overallDelta: "improved" | "degraded" | "neutral" | "mixed",
}
```

**Notes:** For numeric fields, delta is `current - baseline`. For non-numeric fields, `changeType` is `"changed"` or `"unchanged"`. For fields present in one version but not the other: `"added"` or `"removed"`.

---

### 7.2 `analyzeTrendsAcrossSteps`

**Purpose:** Identify patterns and directional trends across three or more artifact versions, ordered by `stepIndex`.

**Input shape:**

```javascript
{
  artifactType: string,
  versions: [
    { stepId: string, stepIndex: number, data: unknown },
    ...                                // must be >= 3, ordered ascending by stepIndex
  ],
  metricPaths: string[],              // fields to track
}
```

**Output shape:**

```javascript
{
  trends: [
    {
      path:        string,
      direction:   "increasing" | "decreasing" | "stable" | "volatile",
      values:      Array<{ stepId: string, stepIndex: number, value: unknown }>,
      peakStepId:  string,
      troughStepId: string,
    }
  ],
  summary: string,                    // e.g. "confidence_score increased consistently across all 3 steps"
}
```

---

### 7.3 `rankPerformanceByMetric`

**Purpose:** Rank artifact versions against each other on a specified metric field.

**Input shape:**

```javascript
{
  artifactType: string,
  versions: [
    { stepId: string, stepIndex: number, data: unknown },
    ...
  ],
  metric: {
    path:      string,               // dot-path into data, e.g. "summary.confidence_score"
    direction: "asc" | "desc",      // "desc" = higher is better
  },
}
```

**Output shape:**

```javascript
{
  metric:    string,
  direction: "asc" | "desc",
  ranking: [
    { rank: number, stepId: string, stepIndex: number, value: unknown },
    ...
  ],
  winner: string,                   // stepId of rank-1 version
}
```

---

### 7.4 `generateOptimizationRecommendations`

**Purpose:** Derive a ranked list of follow-up actions from a `ComparisonReport` and optionally a `PerformanceRanking`.

**Input shape:**

```javascript
{
  comparisonReport:      object,     // ComparisonReport.data
  performanceRanking?:   object,     // PerformanceRanking.data (optional)
  context?: {
    domain:   string,                // e.g. "product_catalog", "employee_performance"
    goal:     string,                // e.g. "maximize confidence_score"
  },
}
```

**Output shape:**

```javascript
{
  recommendations: [
    {
      rank:           number,
      action:         string,
      rationale:      string,
      expectedImpact: string,
      confidence:     "high" | "medium" | "low",
    }
  ],
}
```

---

### 7.5 `generateInsightSummary`

**Purpose:** Produce a human-readable narrative explanation of a `ComparisonReport`. Written for a non-technical audience.

**Input shape:**

```javascript
{
  comparisonReport: object,          // ComparisonReport.data
  stepLabels?: { [stepId: string]: string },  // optional human names per step
  audience?: "operator" | "analyst" | "executive",
}
```

**Output shape:**

```javascript
{
  headline:     string,
  findings:     string[],
  significance: "high" | "medium" | "low" | "none",
}
```

---

## 8. Module Definitions (No Implementation)

The following modules would use the engine capabilities defined above. Each follows the full engine-aware module contract (`assertEngineContract`). None are implemented yet.

### 8.1 `artifact_diff_analyzer`

**Role:** Pairwise comparison of two artifact versions (baseline vs. most recent).

```
id:                  "artifact_diff_analyzer"
modulePipelineType:  "processing"
engineKinds:         ["computeArtifactDiff", "generateInsightSummary"]
consumes:            ["analysis"]       ← or any artifact kind being compared
produces:            [{ kind: "analysis", mode: "create" }]  ← ComparisonReport + InsightSummary

buildPayload(consumedArtifacts):
  versions = consumedArtifacts["analysis"]
  baseline = versions[0]
  current  = versions.at(-1)
  → { artifactType, baseline: { stepId, stepIndex, data }, current: { stepId, stepIndex, data } }

normalizeToArtifacts(engineResults):
  → ComparisonReport artifact
  → InsightSummary artifact
```

---

### 8.2 `trend_analyzer`

**Role:** Identifies directional trends across three or more artifact versions.

```
id:                  "trend_analyzer"
modulePipelineType:  "processing"
engineKinds:         ["analyzeTrendsAcrossSteps"]
consumes:            ["analysis"]
produces:            [{ kind: "aggregate", mode: "create" }]

buildPayload(consumedArtifacts):
  versions = consumedArtifacts["analysis"]   // all versions, ≥ 3 required
  → { artifactType, versions: [...], metricPaths: [...] }

normalizeToArtifacts(engineResults):
  → TrendReport artifact (stored as "aggregate")
```

**Guard:** This module should validate `consumedArtifacts["analysis"].length >= 3` in `buildPayload` and throw with a clear error if fewer versions exist.

---

### 8.3 `performance_ranker`

**Role:** Ranks artifact versions by a specified metric. Most useful after `artifact_diff_analyzer` has confirmed a meaningful difference exists.

```
id:                  "performance_ranker"
modulePipelineType:  "aggregation"
engineKinds:         ["rankPerformanceByMetric"]
consumes:            ["analysis"]
produces:            [{ kind: "aggregate", mode: "create" }]

buildPayload(consumedArtifacts, context):
  versions = consumedArtifacts["analysis"]
  metric   = context.metric ?? { path: "summary.score", direction: "desc" }
  → { artifactType, versions: [...], metric }

normalizeToArtifacts(engineResults):
  → PerformanceRanking artifact (stored as "aggregate")
```

---

### 8.4 `optimization_engine`

**Role:** Derives recommendations from a `ComparisonReport` and optionally a `PerformanceRanking`. The final step in a Claira Insights pipeline.

```
id:                  "optimization_engine"
modulePipelineType:  "output"
engineKinds:         ["generateOptimizationRecommendations"]
consumes:            ["analysis", "aggregate"]   ← ComparisonReport + PerformanceRanking
produces:            [{ kind: "deliverable", mode: "create" }]

buildPayload(consumedArtifacts):
  comparisonReport   = consumedArtifacts["analysis"].at(-1).data
  performanceRanking = consumedArtifacts["aggregate"].at(-1)?.data
  → { comparisonReport, performanceRanking, context: { domain, goal } }

normalizeToArtifacts(engineResults):
  → OptimizationRecommendation artifact (stored as "deliverable")
```

---

### 8.5 Example: Full Claira Insights Pipeline

```
Workflow: [
  photo_analysis,           // produces: AnalysisBatch (step 0)
  filter_photos,            // produces: FilteredSet   (step 1)
  photo_analysis,           // produces: AnalysisBatch (step 2)
  artifact_diff_analyzer,   // consumes: AnalysisBatch ×2, produces: ComparisonReport + InsightSummary
  performance_ranker,       // consumes: AnalysisBatch ×2, produces: PerformanceRanking
  optimization_engine,      // consumes: ComparisonReport + PerformanceRanking, produces: Recommendation
]
```

The first four modules are execution modules. The last three are Claira Insights modules. They run in the same `executeWorkflow` call, share the same artifact store, and are ordered by the same `orderSteps` system. No special execution path is needed.

---

## 9. Relationship to Existing Architecture

### 9.1 How Claira Insights Plugs Into Workflow Execution

Claira Insights modules are **ordinary engine-aware modules**. They participate in the exact same execution pipeline as any other module:

| Step | System | Action |
|---|---|---|
| 1 | `workflowOrdering.expandToSteps` | Assigns `stepId` and `stepIndex` to Insights modules |
| 2 | `workflowOrdering.orderSteps` | Orders Insights modules after the production modules they consume from |
| 3 | `workflowRunner.executeWorkflow` | Drives `executeModuleStep` for each step in order |
| 4 | `moduleOrchestrator.executeModuleStep` | Validates contract, reads artifacts, calls `runClaira`, writes output artifacts |
| 5 | `runtimeArtifactStore` | Stores `ComparisonReport`, `InsightSummary`, etc. like any other artifact |

Nothing changes. No new execution infrastructure is required.

### 9.2 How Claira Insights Uses the Artifact Store

Insights modules consume artifact arrays directly via `buildConsumedArtifactsMap`. When the same artifact type has multiple versions:

```javascript
// In artifact_diff_analyzer.buildPayload:
const versions = consumedArtifacts["analysis"];   // all AnalysisBatch versions
const baseline = versions[0];                     // oldest
const current  = versions.at(-1);                 // most recent
```

This is the only change in consumption behavior. All other modules continue using `.at(-1)` only. Insights modules explicitly use multiple versions — that is their purpose.

### 9.3 Why Claira Insights Must Remain Separate From Execution Logic

| Concern | Reason |
|---|---|
| **Single responsibility** | Execution produces artifacts. Insights compares them. These are different operations on different timescales. |
| **Non-destructive** | Insights modules read artifacts but must not modify execution state, re-run steps, or alter the store's write history. |
| **Optional** | A workflow run is complete and valid without any Insights modules. Adding them is additive, not required. |
| **Testability** | Execution tests and Insights tests must be independently runnable. Coupling them would break both. |
| **Performance** | Comparison operations (especially diff and LLM-driven insight generation) may be slow. They must not block the execution path. |

The separation is enforced structurally: Insights modules only appear **after** all production modules in the step list. `orderSteps` guarantees this because Insights modules consume artifact types that only exist after production steps run.

### 9.4 Artifact Kind Registration

The following artifact types must be added to `workflow/pipeline/artifactKindRegistry.js` before implementation:

| Artifact Type | Registered Kind | Notes |
|---|---|---|
| `ComparisonReport` | `"analysis"` | Stored under existing `analysis` kind |
| `InsightSummary` | `"analysis"` | Stored under existing `analysis` kind |
| `PerformanceRanking` | `"aggregate"` | Stored under existing `aggregate` kind |
| `OptimizationRecommendation` | `"deliverable"` | Stored under existing `deliverable` kind |

No new artifact kinds need to be registered in `ARTIFACT_KINDS`. The existing vocabulary (`analysis`, `aggregate`, `deliverable`) maps correctly to Insights output types. The `artifactType` field on the artifact record distinguishes specific types within a kind.

---

## 10. UI Implications (High-Level)

The UI requirements for Claira Insights are defined at the surface level only. Full UI design is deferred.

### 10.1 What the UI Must Show

| Requirement | Description |
|---|---|
| **Multiple result indicator** | When `readArtifactsByType(...).length > 1` for any type, the output panel must signal that multiple versions exist. |
| **Comparison access point** | A secondary indicator (badge, dropdown, or "Compare" button) reveals previous artifact versions with their `stepId` labels. |
| **Primary result** | Always the most recent artifact (`.at(-1)`). Never a random or user-selected version unless Option C pinning is implemented. |
| **Insight presentation** | `InsightSummary.data.headline` and `findings` must be surfaced in a readable panel — not raw JSON. |
| **Recommendation list** | `OptimizationRecommendation.data.recommendations` must render as a ranked, actionable list. |
| **Step attribution** | Each artifact version must be labelled with its `producedByStepId` and `stepIndex` when displayed in comparison mode. |

### 10.2 What the UI Must NOT Do

- Trigger re-execution of modules from within a comparison panel.
- Allow the user to merge or overwrite artifact versions.
- Show raw artifact JSON as the default view (JSON is a fallback only).
- Display comparison data without the producing step's identity.

### 10.3 Comparison View (Future)

When implemented, the comparison view will show:

```
┌─────────────────────┐   ┌─────────────────────┐
│  AnalysisBatch      │   │  AnalysisBatch       │
│  photo_analysis__0  │   │  photo_analysis__2   │
│  step 0 — baseline  │   │  step 2 — filtered   │
│                     │   │                      │
│  Photos: 240        │   │  Photos: 96          │
│  Confidence: 0.61   │   │  Confidence: 0.83 ↑  │
│  Matches: 44        │   │  Matches: 71 ↑       │
└─────────────────────┘   └─────────────────────┘

Delta: confidence +36%  |  matches +61%  |  volume -60%

InsightSummary:
  "Filtering improved match quality significantly. The 60% volume
   reduction produced a 36% confidence gain, suggesting the removed
   photos introduced noise rather than signal."

OptimizationRecommendations:
  1. [HIGH] Apply the same filter criteria to future batch runs.
  2. [MEDIUM] Investigate the 8 removed photos that were close to threshold.
```

---

## 11. Example Use Cases

| Domain | Workflow | What Claira Insights Surfaces |
|---|---|---|
| **Photo catalog** | Analyze → Filter → Re-analyze | Did filtering improve photo quality scores? Which filter setting worked best? |
| **Employee performance** | Track outputs weekly across 4 weeks | Is Jim's productivity trending up? At what point did it peak? |
| **Product catalog** | Build catalog → Refine tags → Rebuild | Did tag refinement improve discoverability metrics? |
| **Sales scenarios** | Model revenue under 3 pricing assumptions | Which pricing assumption produced the highest projected revenue? |
| **Fitness tracking** | Log behavior weekly → Compare outcomes | Which week's habits correlated with the best outcome metrics? |
| **Shoe store (§15)** | Register entities (broad) → Re-register (refined) | Which entity category structure produced better downstream completeness? |

---

## 12. Implementation Checklist (Deferred)

When implementation begins, the following steps must be completed in order:

- [ ] Register new artifact kinds in `artifactKindRegistry.js` if required
- [ ] Add `computeArtifactDiff` handler to `CLAIRA_RUN_HANDLERS`
- [ ] Add `analyzeTrendsAcrossSteps` handler to `CLAIRA_RUN_HANDLERS`
- [ ] Add `rankPerformanceByMetric` handler to `CLAIRA_RUN_HANDLERS`
- [ ] Add `generateOptimizationRecommendations` handler to `CLAIRA_RUN_HANDLERS`
- [ ] Add `generateInsightSummary` handler to `CLAIRA_RUN_HANDLERS`
- [ ] Implement `artifact_diff_analyzer` module (§8.1)
- [ ] Implement `trend_analyzer` module (§8.2)
- [ ] Implement `performance_ranker` module (§8.3)
- [ ] Implement `optimization_engine` module (§8.4)
- [ ] Create test suite `dev/testInsightsPipeline.mjs`
- [ ] Register `ComparisonReportPanel` in UI `outputRegistry`
- [ ] Register `InsightSummaryPanel` in UI `outputRegistry`
- [ ] Register `PerformanceRankingPanel` in UI `outputRegistry`
- [ ] Register `OptimizationRecommendationPanel` in UI `outputRegistry`
- [ ] Implement comparison indicator in UI output panel (§20, Option A)

---

## References

| Resource | Location |
|---|---|
| Step-Based Versioned Artifacts | `plan.md §19`, `docs/architecture.md` |
| UI handling for multiple artifacts | `plan.md §20` |
| Comparative Analysis Engine (plan.md entry) | `plan.md §21` |
| Runtime artifact store implementation | `workflow/pipeline/runtimeArtifactStore.js` |
| Module orchestrator (consumption rule) | `workflow/execution/moduleOrchestrator.js` |
| Step expansion and ordering | `workflow/execution/workflowOrdering.js` |
| Engine-aware module contract | `workflow/modules/moduleContract.js` |
| Artifact kind registry | `workflow/pipeline/artifactKindRegistry.js` |
| Shoe store example (§15) | `plan.md §15` |

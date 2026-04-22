# Claira Engine — Architecture

This document describes the internal architecture of Claira.

Unlike the README (which focuses on product features), this document explains:

- internal systems
- execution flow
- capabilities and handlers
- domain modules
- infrastructure (jobs, auth, integrations)
- voice pipeline
- UI screen flow

---

# 🧠 Core Architecture

Claira is built as a **unified execution engine** with multiple entry points.

All processing flows through:

```
/__claira/run → CLAIRA_RUN_HANDLERS → interfaces/api.js → pipelines
```

---

## Key Principle

Adapters **do not** contain business logic.

All logic is executed inside the engine via handlers and pipelines.

---

# 🧩 Execution Flow

### Input Sources

- UI (Photo Sorter, Catalog Builder, Categories)
- Integrations (Wix, external APIs)
- Workflows / presets

### Flow

1. Input received
2. Routed to `/__claira/run`
3. `kind` resolves handler in `CLAIRA_RUN_HANDLERS`
4. Handler calls `interfaces/api.js`
5. API calls appropriate pipeline(s)
6. Response returned to caller

```
Input (UI / integration / script)
        │
        ▼
POST /__claira/run
        │
        ▼
CLAIRA_RUN_HANDLERS  ──  kind: "analyzePhotos"
        │                kind: "buildProductCatalog"
        │                kind: "loadIndustryPack"
        │                kind: "..."  (65+ handlers)
        ▼
interfaces/api.js
        │
        ▼
Pipelines (photoAnalyzer, productCatalog, workspace, tracking, ...)
        │
        ▼
Response
```

---

# ⚙️ Handler System (`CLAIRA_RUN_HANDLERS`)

The system currently contains **65+ handlers**, grouped by domain. Each is registered by a `kind` string.

---

## 🧠 Core Capabilities

| kind | purpose |
|------|---------|
| `analyzePhotos` | Photo quality analysis, scoring, tag generation |
| `buildProductCatalog` | Images → grouped products with metadata and file output |
| `ingestData` | Ingest structured or webhook data |
| `processFolder` | Analyse a local folder |
| `processData` | Classify structured payloads |
| `getRiskInsights` | Risk insights from engine state |
| `applyDecision` | Apply a classification decision |

---

## 🧩 Industry / Pack System

| kind | purpose |
|------|---------|
| `loadIndustryPack` | Activate an industry pack |
| `listIndustryPacks` | Enumerate available packs |
| `createIndustryFromInput` | Autogenerate a new industry pack from user description |
| `confirmIndustryPackActivation` | Confirm and finalise pack activation |
| `getIndustryBuildReport` | Coverage and quality report for a pack |
| `autoImproveIndustryPack` | AI-driven iterative pack improvement |
| `previewIndustryModuleComposition` | Preview module composition before activation |
| `getIndustryFeatures` | Features available for an industry |
| `getActiveReferenceAssets` | Active reference assets for a category |
| `getPackReference` | Pack reference structure |
| `getPackProcesses` | Processes defined in a pack |
| `getStructureCategories` | Categories within the structure |
| `ensureCapabilityOutputFolders` | Initialise output folder structure |
| `tunnelUploadStaged` | Stage uploads for a tunnel category |

---

## 🏢 Workspace System

| kind | purpose |
|------|---------|
| `workspaceScan` | Scan and build workspace read model |
| `workspaceSync` | Sync workspace state |
| `workspaceSimulationIngest` | Simulate pipeline ingest |
| `workspaceGeneratorSnapshot` | Snapshot of workspace generator state |
| `checkInternetConnection` | Connectivity check |

---

## 📊 Tracking System

| kind | purpose |
|------|---------|
| `listTrackingEntities` | List entities being tracked |
| `createTrackingEntity` | Create a new tracked entity |
| `addTrackingSnapshot` | Add a progress snapshot |
| `listTrackingSnapshots` | Retrieve snapshots for an entity |
| `getTrackingProgress` | Current progress state |
| `getTrackingConfig` | Tracking configuration for a pack |
| `categoryTrackingSupport` | Whether a category supports tracking |

---

## 🔁 Workflow System

| kind | purpose |
|------|---------|
| `getActiveWorkflowTemplate` | Currently active workflow template |
| `listWorkflowCompositions` | All available workflow compositions |
| `createTrainerClient` | Create a trainer client |
| `listTrainerClients` | List trainer clients |
| `getTrainerClient` | Get a specific trainer client |

---

## ⚠️ Risk / Review System

| kind | purpose |
|------|---------|
| `getRiskInsights` | Risk insights |
| `getRooms` | Configured output rooms with results |
| `getSuggestions` | AI suggestions |
| `getUserControlState` | Current user-defined rules |
| `setUserControlRule` | Update a user rule |
| `applyDecision` | Apply a manual review decision |

---

## 🧾 Domain: Tax

| kind | purpose |
|------|---------|
| `taxDocumentComparison` | Compare two tax PDF documents and extract fields |

---

## 💪 Domain: Fitness

| kind | purpose |
|------|---------|
| `fitnessTimelineScan` | Timeline analysis from fitness data |
| `fitnessImageComparison` | Before/after image comparison |
| `fitnessImageRead` | Extract data from a fitness image |

---

## 🏗 Domain: Contractor

| kind | purpose |
|------|---------|
| `contractorTimelineScan` | Timeline analysis for contractor project |
| `contractorCostTracking` | Track project costs |
| `contractorReceiptAdd` | Add a receipt to project |
| `contractorReceiptList` | List receipts |
| `contractorProjectSave` | Save a project |
| `contractorProjectLoad` | Load a project |
| `contractorProjectList` | List all projects |
| `contractorProjectExportReport` | Export project as a report |
| `contractorProjectExportPdf` | Export project as PDF |
| `contractorGenerateShareLink` | Generate a public share link |

---

## 🧾 Domain: Receipts

| kind | purpose |
|------|---------|
| `receiptAdd` | Add a receipt |
| `receiptList` | List receipts |
| `receiptExtract` | Extract structured data from a receipt image |

---

## 🧠 Capability Meta System

| kind | purpose |
|------|---------|
| `attachPipelineCapabilities` | Attach capabilities to a pipeline |
| `recordCapabilityOverride` | Record a human override of a capability decision |
| `getAppliedCapabilityRecords` | Retrieve applied capability records |
| `saveAppliedCapabilityRecord` | Persist a capability record |
| `previewCapabilityRow` | Preview a single capability row before applying |

---

# 🧱 Pipelines

Located in `interfaces/`

---

## 📦 `productCatalog.js`

- image grouping (heuristic + CLIP similarity)
- metadata generation (tags, labels, suggested title)
- user-editable product names (passed back as `editedProducts`)
- file output: creates `/products/{product-name}/` folder structure with renamed assets
- unique folder naming (appends `-2`, `-3` etc. on collision)

---

## 📸 `photoAnalyzer.js`

- sharpness via Laplacian variance
- resolution from image dimensions
- CLIP label inference (`inferPhotoLabels`)
- composite scoring (`computePhotoScore`)
- tag generation (portrait, smile, blurry, high-res, etc.)
- tier grouping: best / good / poor (`groupPhotoResults`)

---

## 🧠 CLIP Integration

- semantic understanding of images via `@xenova/transformers`
- normalised via `normaliseClipResult` helper (label + confidence)
- reused across pipelines — never run twice for the same input
- result shape: `{ label: string, confidence: number }`

---

# 🧩 Capability Registry

`server/capabilities.js` provides a lightweight registry separate from the handler map.

```js
capabilities = {
  ingestData:           { description, input, output },
  processFolder:        { ... },
  buildProductCatalog:  { ... },
  analyzePhotos:        { ... },
  // ...10 registered entries
}
```

**`getCapabilityForEvent(eventType, platform, payload)`** maps incoming integration events to a capability key:

- event with images → `"buildProductCatalog"`
- event without images → `"ingestData"`
- unknown event → `null`

This is used in `/api/integrations/wix` for observability logging — not to replace handler dispatch.

---

# 🧩 Category & Module System

---

## Category Presets (Industry Packs)

Predefined workflows for industries such as Ecommerce, Photography, and Content.

Each pack defines:
- which capabilities to use
- the workflow structure
- the guided UI flow

---

## Build Your Own Category

Users can construct custom categories by combining modules.

Available modules include:
- analyze images
- filter by tags
- group assets
- generate metadata
- export results

---

## Module Composition

- modules are reusable building blocks
- categories = a configured set of modules
- users define execution order
- composability allows flexible pipelines without code changes

---

# 🖥 UI Screen Architecture

The UI is a single-page app with screen-level state (`screen` union in `ui/main.jsx`). Navigation is managed by `OnboardingNavContext`.

---

## Pre-App Phase

| Phase | purpose |
|-------|---------|
| `welcome` | `WelcomeScreen` — brand hero, voice narration, entry gate |
| `packEntry` | `IndustrySelector` — pack picker and custom category tools |

---

## Core Guided Flow

| Screen | `screen` value | purpose |
|--------|---------------|---------|
| `CapabilityScreen` | `capabilities` | Category / capability selection from the loaded pack |
| `StructureSetupScreen` | `structure` | Per-pack configuration (SKUs, variations, oversight level) |
| `TunnelScreen` | `tunnel` | Reference uploads and folder input per category |
| `ProcessingScreen` | `processing` | Live ingest pipeline with progress |
| `SessionReport` | `report` | Post-run summary: counts, review reasons, workflow compare |

---

## Workflow & Control Screens

| Screen | `screen` value | purpose |
|--------|---------------|---------|
| `WorkflowHubScreen` | `workflow_hub` | Lists available workflow compositions |
| `WorkflowScreen` | `workflow_run` | Executes a selected workflow template |
| `WaitingRoom` | `waiting` | Human review queue: conflicts, user rules, overrides |
| `RoomsDashboard` | `rooms` | Where processed files landed across output rooms |
| `SuggestionsPanel` | — | AI recommendations display |

---

## Feature Screens

| Screen | `screen` value | purpose |
|--------|---------------|---------|
| `PhotoSorterScreen` | `photo_sorter` | Upload → analyze → tag-filter → sort → export to catalog |
| `CatalogBuilderScreen` | `catalog_builder` | Upload images → build product catalog → edit names → output |

---

## Domain Panels (rendered inside `WorkflowScreen`)

| Panel | domain |
|-------|--------|
| `TaxDocumentComparePanel` | Tax PDF extraction and comparison |
| `FitnessTrackingPanel` | Fitness timeline, image comparisons, progress |
| `ContractorTrackingPanel` | Projects, receipts, timelines, PDF export |

---

## Public View (no auth required)

| Route | component | purpose |
|-------|-----------|---------|
| `#/reports/{slug}/{id}` | `ContractorReportShareView` | Read-only public contractor report |

---

## Voice Onboarding Integration

Each guided screen receives a `guidedStep` prop (index from `ONBOARDING_STEP`). `OnboardingVoiceSync` + `VoiceOnboardingRouteSync` synchronise step changes to audio playback automatically.

---

# 🎙 Voice System

---

## Two Isolated Audio Modes

### Mode 1 — Global Narration

- used for: welcome narration, onboarding step narration
- controller: `voiceAudioController.js`
- UI: `GuidedVoiceControls`, `VoiceToggleButton`, `ClairaVoiceReplay`
- **only** play/pause/replay controls should touch this mode

### Mode 2 — Inline Audio

- used for: paragraph speaker buttons, warning clips
- controller: local `Audio()` instances per component (`inlineAudio.js`)
- UI: `InlineVoiceButton`
- **never** touches `voiceAudioController`

**These two modes never share state. Playing inline audio does not affect global controls and vice versa.**

---

## Voice Content

| Source | contents |
|--------|---------|
| `clairaVoiceSteps.js` | 10 onboarding step scripts (`CLAIRA_VOICE_STEPS[0–9]`) |
| `clairaInlineVoiceKeys.js` | 7 inline keys: `industry_existing_intro`, `industry_create_intro`, `capability_intro`, `structure_setup_intro`, `workflow_hub_intro`, `warning_start_over`, `warning_delete_rule` |

---

## Asset Pipeline

```
dev/generateVoiceAssets.mjs
        │
        ├── reads CLAIRA_VOICE_STEPS + CLAIRA_INLINE_VOICE_KEYS
        ├── calls ElevenLabs API
        ├── writes ui/public/assets/audio/voice/*.mp3
        └── writes voice-manifest.json
              keyed by { byTextSha256, byKey }
```

**Runtime never calls ElevenLabs.** All audio is pre-generated and served as static MP3 files.

---

## Playback Resolution

`speakClaira(text)` → hashes text → looks up `byTextSha256` in manifest → fetches MP3 → plays via `voiceAudioController`

`speakClairaByKey(key)` → looks up `byKey` in manifest → same playback path

---

# 🔁 Workflow System (Photo Sorter)

---

## Workflow Steps

Three step types are logged per session:

| type | logged when |
|------|------------|
| `analyze` | `analyzePhotos` completes |
| `filter` | tag/mode state changes and a rebuild is triggered |
| `catalog` | `buildProductCatalog` completes successfully |

---

## Reapply Pattern

Clicking **Reapply** on a past filter step:
1. Restores `tagState` and `filterMode` from the log entry
2. Sets `pendingReapply = true`
3. A `useEffect` fires after render with settled state
4. Calls `handleBuildCatalog(images)` with an explicit images override — no stale closure risk

---

## Preset Export

```json
{
  "version": 1,
  "name": "Portrait Picks",
  "tagState": [["portrait", "include"], ["blurry", "exclude"]],
  "filterMode": "all",
  "steps": [...]
}
```

`tagState` is stored as `Array.from(tagState.entries())` (not a `Map`) for JSON portability.

---

# 🔗 Integration Layer

---

## Wix Webhook

```
POST /api/integrations/wix
```

- receives raw Wix webhook payload
- transforms: `{ instanceId, eventType, ... }` → `{ kind, accountId, metadata }`
- logs capability selection via `getCapabilityForEvent`
- registers a job, returns `{ success: true, rid }` immediately
- processing runs asynchronously

---

## Job System

Jobs are persisted to `server/jobsStore.json`.

| field | values |
|-------|--------|
| `status` | `pending` / `processing` / `done` / `error` |
| `attempts` | number |
| `lastError` | string or null |
| `rawPayload` | stored for replay |
| `createdAt` / `updatedAt` | timestamps |

**Limits:** max 500 jobs; oldest are pruned before save. Writes are atomic (write to `.tmp` then rename).

**Retry strategy:** up to 3 attempts with 1s → 2s → 4s exponential backoff.

**Manual retry:**
```
POST /api/integrations/jobs/:id/retry
```
Only allowed when `status === "error"`. Resets attempts to 0, re-queues `rawPayload`.

**Job status:**
```
GET /api/integrations/jobs/:id
```

---

## External API

```
POST /api/claira/run    →  same dispatch as /__claira/run, wrapped response
GET  /api/claira/health →  { status: "ok", ts: ISO }
```

Response wrapper (external routes only):
```json
{ "success": true,  "data": { ... } }
{ "success": false, "error": "message" }
```

`/__claira/run` always returns the raw handler response (no wrapper).

---

## Auth & Rate Limiting

Applied to `/api/claira/*` and `/api/integrations/*` only. `/__claira/run` is not behind this middleware.

| header | behaviour |
|--------|-----------|
| `x-claira-key` | Optional. Validated against in-memory key registry. |
| `x-claira-request-id` | Optional. Used as `rid` for log tracing. |

| env var | default | effect |
|---------|---------|--------|
| `CLAIRA_REQUIRE_API_KEY` | `false` | If `true`, missing key → 401 |
| `CLAIRA_RATE_LIMIT` | `60` | Requests per minute per key |

**Invalid key** → 401 `{ error: "Invalid API key" }`  
**Rate exceeded** → 429 `{ error: "Rate limit exceeded" }`  
**Valid key** → `body.accountId` is overridden with the key's registered `accountId` (prevents spoofing)

Dev key pre-seeded: `test-key-123` → `acct_test_001`

---

## Request Tracing

Every `/__claira/run` request generates or inherits a `rid`:

```
[run] rid=abc123xy account=acct_001 key=present kind=analyzePhotos status=ok ms=42
[run] rid=abc123xy account=anon    key=none    400 unknown-kind="foo"
```

---

# 🧠 Reasoning / Override System

Provides human-in-the-loop correction and audit capability:

- `recordReasoningOverrideFeedback` — log when a user overrides a system decision
- `recordCapabilityOverride` — record a capability-level override
- `getAppliedCapabilityRecords` / `saveAppliedCapabilityRecord` — read and persist applied records
- `previewCapabilityRow` — preview the effect of a capability change before committing

Purpose: allows the engine to be corrected without retraining; builds an audit trail of human decisions.

---

# 🧪 Workspace Model

| kind | purpose |
|------|---------|
| `workspaceScan` | Build a read model of the current workspace |
| `workspaceSync` | Synchronise workspace state with stored model |
| `workspaceSimulationIngest` | Simulate a pipeline ingest without writing output |
| `workspaceGeneratorSnapshot` | Snapshot the current generator state |

Purpose: manage datasets, simulate pipeline runs, and track how the system's understanding of a workspace evolves over time.

---

# ⚙️ Build & Runtime Details

---

## Browser / Server Split

`interfaces/api.js` has two implementations:

| context | resolution |
|---------|-----------|
| Node.js (server) | `interfaces/api.js` — calls engine directly |
| Browser (Vite) | `ui/clairaApiClient.js` — HTTP calls to `/__claira/run` |

The swap is handled by a custom Vite plugin: **`claira-api-browser-stub`** in `ui/vite.config.mjs`. The same import path works in both environments.

---

## Server-Side Client

`server/clairaClient.js` provides a Node-side wrapper:

```js
runClaira(body, { apiKey, accountId, requestId })  // POST /__claira/run
checkHealth(baseUrl)                               // GET /api/claira/health
```

Used for server-to-server calls and integration testing.

---

## Desktop App (Electron)

`electron/main.cjs`:

1. Spawns `server/index.js` as a child process
2. Waits for `CLAIRA_SERVER_READY:<port>` on stdout
3. Opens `BrowserWindow` at `http://127.0.0.1:<port>`
4. Forwards child process logs
5. Opens external links in system browser
6. On quit: `taskkill /F /T` (Windows) to clean up the server process

Port is resolved dynamically — if 3000 is in use, the next available port is used.

---

## PWA

| file | purpose |
|------|---------|
| `ui/public/manifest.json` | Name, icons (192/512), standalone display, theme `#0b0f14` |
| `ui/public/sw.js` | `claira-shell-v1` cache; network-only for `/__claira/`, `/api/`; cache-first for shell |
| `ui/main.jsx` | Registers `/sw.js` on `window` load |

---

## Voice Asset Generation (Dev)

```bash
node dev/generateVoiceAssets.mjs
```

Requires `ELEVENLABS_API_KEY` in `.env`. Writes to `ui/public/assets/audio/voice/` and updates `voice-manifest.json`. Run once when scripts change — output is committed to the repo.

---

# 🔒 Design Rules

## Enforced

- All processing routes through `/__claira/run`
- Adapters (integrations, UI) only transform input — no business logic
- Pipelines are defined in `interfaces/` and called by handlers only
- CLIP is never run twice for the same input
- Two voice modes never share state

## Forbidden

- Running business logic inside `/api/integrations/*` routes
- Bypassing `CLAIRA_RUN_HANDLERS` to call pipelines directly
- Duplicating pipeline logic across features
- Using `voiceAudioController` from inline audio components
- Hardcoding `localhost:3000` (port is dynamic)

---

# 🧾 Summary

Claira is a **modular, capability-driven AI system** built on:

- a unified execution engine (`/__claira/run`)
- 65+ registered handlers across 10+ domains
- reusable pipelines (photo analysis, product catalog, CLIP)
- composable modules powering category presets
- multi-domain support (tax, fitness, contractor, ecommerce)

It supports:

- UI-driven workflows (guided onboarding, feature screens)
- external integrations (Wix webhook, `/api/claira/run`)
- domain-specific processing (receipts, fitness, contractor projects)
- human-in-the-loop refinement (review queue, reasoning overrides)

All while maintaining a strict separation between:

- **adapters** — input transformation only
- **engine** — all business logic
- **pipelines** — reusable execution units

---

## Step-Based Versioned Artifacts

The system now supports step-level execution and artifact lineage.

Each module execution is uniquely identified by:

- `stepId` (e.g. `"photo_analysis__2"`)
- `stepIndex` (execution order within the workflow run)

Artifacts now support multiple versions of the same type within a single run.

Example:

- `AnalysisBatch` from step `photo_analysis__0`
- `AnalysisBatch` from step `photo_analysis__2`

Each artifact carries:

- `producedByStepId` — which execution step produced it
- `stepIndex` — its position in the workflow

---

### Execution vs Storage vs UI Behavior

The system distinguishes between execution, storage, and display:

**Execution:**

- Modules consume **only the most recent artifact** (highest `stepIndex`, last element in store array).
- Ensures deterministic, unambiguous execution — no user prompt required.
- Rule enforced by convention in `moduleOrchestrator.js`: `consumedArtifacts["Type"].at(-1)`.

**Storage:**

- All artifacts are preserved in the `runtimeArtifactStore`.
- No data is discarded. Earlier versions remain accessible.
- `readArtifactsByType()` returns all versions in write order (oldest first, most recent last).

**UI (defined behavior, not yet fully built):**

- The most recent artifact is shown as the primary output.
- Previous artifacts are accessible via a comparison indicator (badge or dropdown).
- Full side-by-side comparison is a future UI layer.

---

### Naming This Pattern

This capability is formally defined as:

> **"Step-Based Versioned Artifacts"**

This is a core architectural feature of the Claira Engine. It is documented in full in `plan.md §19`.

---

### Why This Matters

This enables:

- before/after comparisons within a single workflow run
- multi-step workflows where the same module runs more than once
- scenario evaluation (different inputs → different outputs of same type)
- optimization analysis (which configuration produced a better result)
- historical traceability (full lineage from `stepId` to artifact `data`)

---

### Implementation Locations

| File | Role |
|---|---|
| `workflow/pipeline/runtimeArtifactStore.js` | Append-only write, all-versions read, `producedByStepId` / `stepIndex` on every artifact |
| `workflow/execution/moduleOrchestrator.js` | Consumption rule documented; stamps `producedByStepId` and `stepIndex` on produced artifacts |
| `workflow/execution/workflowOrdering.js` | `expandToSteps` assigns unique `stepId` / `stepIndex` before execution begins |
| `workflow/execution/workflowRunner.js` | Passes `stepId` and `stepIndex` into each `executeModuleStep` call |

---

## Future System: Comparative Analysis Engine (Claira Insights)

This system is enabled by Step-Based Versioned Artifacts. It is **not yet implemented**.

---

### Purpose

- Compare outputs across execution steps
- Analyze structural differences between artifact versions
- Identify which variables produce better outcomes
- Support optimization and decision-making

---

### Core Input

- Two or more `RuntimeArtifact` records of the same `artifactType`
- Each with `stepId` and `stepIndex` to establish their lineage

---

### Core Output

| Artifact | Description |
|---|---|
| `ComparisonReport` | Structural diff of two artifact `data` payloads |
| `InsightSummary` | Human-readable explanation of what changed and why it matters |
| `OptimizationRecommendations` | Ranked follow-up actions derived from the comparison |

---

### Example Use Cases

| Scenario | What is compared |
|---|---|
| Employee performance (Jim vs Wade) | Output metrics across two `EntitySet` artifacts |
| Before/after analysis (step 0 vs step 2) | Same module, different input contexts |
| Behavior vs outcome tracking | `EventLog` from step N vs `OutcomeSet` from step N+2 |
| Sales optimization | Two `RevenueProjection` artifacts under different pricing assumptions |
| Product catalog refinement | `CatalogBatch` with original tags vs revised tags |

---

### Key Insight

The system does **not** treat multiple artifacts of the same type as an error.

> Differences between artifact versions represent **valuable information**, not ambiguity.

The Comparative Analysis Engine transforms those differences into actionable output.

---

### Architecture Notes

The engine is implemented as ordinary engine-aware modules (see `plan.md §16` and `§21`):

```
compare_artifacts   → engineKind: "artifact.diff"
insight_generator   → engineKind: "insight.generate"
```

Both follow `assertEngineContract`. No special execution path is required.

---

### Status

- **Not implemented.** Design documented in `plan.md §21`.
- Must remain **separate from the execution system** — comparison is a post-run operation.
- Will be implemented as a new module layer after the UI foundation (Phase 9) is complete.

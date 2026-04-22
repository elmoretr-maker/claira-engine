# Plan: Align "Create Your Category" With Intent (Engine-Unified Modules)

**Status:** Refined planning document — NOT an implementation checklist.  
**Version:** 2.1 — clarifies that the shared execution function (not HTTP) is the engine boundary; HTTP is one interface to that function.

**Non‑negotiables preserved:**

- **Choose Your Category** (prebuilt packs) continues to work unchanged.
- **Standalone features** (Photo Sorter, Build Product Catalog) remain first-class, fully functional.
- **Claira Engine** is the **only** execution authority. No alternate paths.
- No change may impede, hinder, or reduce performance of unrelated systems.

---

## 1. Core principle (architecture lock)

**Modules are orchestration wrappers. The engine is the only executor.**

The engine is **a shared internal function** — not the HTTP endpoint. HTTP is one interface to that function, not the function itself.

```text
                    ┌─────────────────────────────┐
                    │   runClaira(kind, payload)   │  ← SHARED INTERNAL ENGINE FUNCTION
                    │   (single source of truth)   │
                    └──────────────┬──────────────┘
                                   │  calls
                         CLAIRA_RUN_HANDLERS
                                   │
                         interfaces/api.js → pipelines
                         ╱                          ╲
          ╔══════════════╗               ╔═══════════════════════╗
          ║ HTTP layer   ║               ║  Module orchestrator  ║
          ║              ║               ║                       ║
          ║ POST         ║               ║  Module reads         ║
          ║ /__claira/run║               ║  artifacts → calls    ║
          ║ → calls      ║               ║  runClaira(kind, ...) ║
          ║  runClaira() ║               ║  → writes artifacts   ║
          ╚══════════════╝               ╚═══════════════════════╝
     (browser UI, integrations,         (workflow module steps,
      standalone tools)                  server-side orchestration)
```

Both callers use **identical execution logic** because they call the **same function**, not because modules make HTTP requests to themselves.

**Module execution flow:**

```text
  User triggers module step
       │
       ▼
  Module reads required artifacts from artifact store
       │
       ▼
  Module calls runClaira(kind, payload)  ← shared internal function
       │
       ▼
  CLAIRA_RUN_HANDLERS (same dispatch, same logging, same pipelines)
       │
       ▼
  interfaces/api.js → pipelines
       │
       ▼
  Engine response normalized into artifact(s)
       │
       ▼
  Artifacts written to session artifact store
       │
       ▼
  Next module reads artifacts (or run ends → dashboard)
```

**No module may:**

- call pipeline functions directly (e.g. `photoAnalyzer.js` functions);
- call `CLAIRA_RUN_HANDLERS` directly as a map lookup;
- share raw JavaScript objects between modules instead of artifact records;
- implement analysis, classification, or output logic of its own.

All of these violate the single-execution-path rule and will create drift.

---

## 2. Engine access rule (strict)

### Rule: One shared function, two callers

The engine is a **shared internal function** — call it `runClaira(kind, payload, context)` — that both the HTTP route and the module orchestrator call directly:

```js
// Shared internal function (single source of truth)
async function runClaira(kind, payload, context = {}) {
  const handler = CLAIRA_RUN_HANDLERS[kind];
  if (!handler) throw new Error(`Unknown kind: ${kind}`);
  // logging, validation, tracing happen here (once, not per caller)
  return await handler({ ...payload, ...context });
}

// HTTP interface — one caller of runClaira
app.post("/__claira/run", async (req, res) => {
  const { kind, ...payload } = req.body;
  const result = await runClaira(kind, payload, { accountId: req.accountId, rid: req.rid });
  res.json(result);
});

// Module orchestrator — another caller of runClaira (no HTTP involved)
async function executeModuleStep(module, artifacts, context) {
  const payload = module.buildPayload(artifacts);
  const result = await runClaira(module.kind, payload, context);
  return module.normalizeToArtifacts(result);
}
```

### What this means in practice

| Caller | How it reaches runClaira | HTTP involved? |
|--------|--------------------------|----------------|
| Browser UI (standalone tools) | `fetch POST /__claira/run` → Express handler → `runClaira()` | Yes |
| External integrations (Wix, `/api/claira/*`) | `fetch POST /__claira/run` → Express handler → `runClaira()` | Yes |
| Workflow module step (server-side) | Calls `runClaira()` directly | **No** |

HTTP is the **transport layer for external callers**. It is not the engine.

### What stays identical across both callers

Because both callers invoke the **same `runClaira` function**, the following are guaranteed to be the same regardless of entry point:

- dispatch logic (handler lookup by `kind`);
- logging (`rid`, `accountId`, status, timing);
- validation (unknown `kind` → error);
- pipeline execution (`interfaces/api.js` → pipelines);
- response shape.

### Responsibility boundary

| Layer | Responsibility | May NOT |
|-------|---------------|---------|
| Module orchestrator | Build payload, call `runClaira()`, read/write artifacts | Call pipeline functions directly; call handlers directly |
| `runClaira()` | Dispatch, validate, log, call handler | Be duplicated or substituted |
| `/__claira/run` HTTP route | Parse HTTP request, call `runClaira()`, serialize response | Contain dispatch or pipeline logic |
| Handler | Execute `kind` logic, call pipelines | Be called from module layer directly |
| Pipeline (`interfaces/`) | Perform work | Be imported and called from anywhere except handlers |

---

## 3. Module definition (target model)

Each registered workflow module must declare:

```js
{
  id: "photo_analysis",         // stable module ID
  label: "Photo Analysis",
  description: "Scores and tags a set of images for quality.",

  // What this module calls (one or more kind values)
  engineKinds: ["analyzePhotos"],

  // Artifact types this module requires from prior steps (empty = module is a source)
  consumes: [],

  // Artifact types this module produces into the artifact store
  produces: ["AnalysisBatch", "ImageSetRef"],

  // modulePipelineType (for ordering validation)
  pipelineType: "processing",

  // How moduleOptions affect which kind is called (documented conditions)
  kindConditions: [
    { if: "moduleOptions.useVision === true", kind: "analyzePhotos" }
  ]
}
```

**Modules = orchestration + artifact definition. Not intelligence.**

---

## 4. Artifact system (enforcement)

### 4.1 Rule: Modules ONLY communicate via artifacts

Modules must **not** pass JavaScript objects, closures, or state directly to one another.

Every piece of data produced by one module and consumed by another **must** be:

- written to the **session artifact store** with a defined artifact type;
- read back from the store by the consuming module using its declared `consumes` list.

### 4.2 Artifact type catalog (initial set)

| Type | Description | Produced by | Consumed by |
|------|-------------|-------------|-------------|
| `ImageSetRef` | List of image paths or base64 refs to be processed | `image_input` | `photo_analysis`, `product_catalog_builder` |
| `AnalysisBatch` | Array of `{ image, score, labels, quality }` per image | `photo_analysis` | `image_filter`, `product_catalog_builder`, dashboard |
| `FilterSpec` | Active tag state, filter mode (ANY/ALL), excluded tags | `image_filter` | `product_catalog_builder`, dashboard |
| `FilteredImageSet` | Subset of `ImageSetRef` after applying a `FilterSpec` | `image_filter` | `product_catalog_builder` |
| `ProductCatalogDraft` | Array of `{ id, name, images, tags, metadata }` | `product_catalog_builder` | `catalog_editor`, dashboard |
| `FileManifest` | List of written files and folder structure on disk | `product_catalog_builder` (with `outputMode: "files"`) | dashboard |
| `EntitySet` | List of tracked entities (clients, items, etc.) | `entity_input` | `event_logger`, `asset_attacher`, dashboard |
| `EventLog` | Ordered log of events tied to entities | `event_logger` | dashboard |
| `AssetAttachmentSet` | Files or uploads attached to entities | `asset_attacher` | dashboard |
| `RunRecord` | Metadata for a completed workflow run | orchestrator | dashboard |

### 4.3 Artifact schema requirements

Every artifact record must include:

```json
{
  "artifactType": "AnalysisBatch",
  "artifactVersion": 1,
  "artifactId": "<uuid>",
  "sessionId": "<session id>",
  "workflowRunId": "<run id>",
  "moduleId": "photo_analysis",
  "sourceKind": "analyzePhotos",
  "rid": "<engine request id>",
  "createdAt": "<ISO timestamp>",
  "data": { ... }
}
```

### 4.4 Artifact store

- **Scope:** per session / per workflow run.
- **In-memory** during the run; **persisted to disk** at run completion (see §8).
- Modules declare `consumes`. The orchestrator validates: if a required artifact is missing before a step runs, the step **fails visibly** with a clear error — **never** silently skipped.
- **No module reads from another module's local state.** Store is the only channel.

---

## 5. Ordering rules (explicit rule table)

### 5.1 Hard structural constraints (non-negotiable)

These match existing `validatePipelineConfiguration` semantics and must be preserved:

| Rule | Description |
|------|-------------|
| **INPUT before PROCESSING** | A module of `pipelineType: "processing"` cannot run unless at least one `"input"` module preceded it. |
| **PROCESSING before OUTPUT** | A module of `pipelineType: "output"` cannot run unless at least one `"processing"` module preceded it. |
| **OUTPUT before PRESENTATION** | A module of `pipelineType: "presentation"` cannot run unless at least one `"output"` module preceded it. |

### 5.2 Artifact dependency constraints

The orchestrator must build a dependency graph from `consumes` / `produces` declarations and **reject** any ordering where a module runs before its `consumes` types are available.

| Rule | Example |
|------|---------|
| Producer before consumer | `photo_analysis` must precede `image_filter` (filter consumes `AnalysisBatch`) |
| Filter before catalog | `image_filter` must precede `product_catalog_builder` when both are selected (catalog consumes `FilteredImageSet`) |
| Entity before event/asset | `entity_input` must precede `event_logger` and `asset_attacher` |

### 5.3 Intent-aware tie-break table

When two modules have no dependency relationship and either order is structurally valid, apply the **first matching rule** in this table (deterministic — same inputs always yield same order):

| Rule # | Condition | Ordered result |
|--------|-----------|----------------|
| 1 | `photo_analysis` and `product_catalog_builder` both selected | `photo_analysis` → `image_filter` → `product_catalog_builder` |
| 2 | `image_filter` selected without `photo_analysis` | `image_filter` removed from proposal (no `AnalysisBatch` to filter) |
| 3 | `entity_input` and `event_logger` both selected | `entity_input` → `event_logger` |
| 4 | `entity_input` and `asset_attacher` both selected | `entity_input` → `asset_attacher` |
| 5 | Any `"output"` module and `simple_presentation` both selected | `"output"` → `simple_presentation` |
| 6 | No matching rule | Use `MODULE_SELECTION_ORDER` registry position as tie-break |

### 5.4 Ordering algorithm (concrete steps)

```
1. Start with user-confirmed module ID set S.
2. Build directed graph G: add edge A → B for each (A produces X, B consumes X).
3. Add structural constraint edges from §5.1.
4. Attempt topological sort of G.
   - If cycle detected: reject with visible error (invalid selection).
   - If ambiguous (multiple valid sorts): apply §5.3 tie-break rules in order.
5. Output is the deterministic ordered list for this run.
6. Write order into workflow_template.json under "moduleOrder".
```

No ML, no random choice, no "planner" that isn't defined by this table.

---

## 6. Module selection: auto-propose + confirm

### 6.1 Current model (being replaced as default)

User must **manually** select all modules; system only pre-suggests via checkboxes that start **off** by default except for high-confidence keyword matches.

### 6.2 Target model

| Step | Who acts | What happens |
|------|----------|-------------|
| 1. Describe | User | Free-text description of need |
| 2. Detect | System (deterministic) | Keyword + domain + preset rules → candidate module IDs |
| 3. Propose | System | **Pre-checks** all high-confidence candidates. Low-confidence ones shown as "suggested, unchecked." |
| 4. Review | User | Sees proposed set with plain-language summaries; can toggle on/off |
| 5. Clarify gaps | System | If structural dependencies are violated after user edits (e.g. removed entity_input but kept event_logger), show **blocking message** explaining which modules require which |
| 6. Confirm | User | Explicit "Build" action |
| 7. Persist | System | Writes `workflow_template.json` from confirmed set only |

### 6.3 High-confidence vs low-confidence

| Signal type | Behavior |
|-------------|----------|
| **Keyword match** in `MODULE_KEYWORD_MAP` | Pre-checked |
| **Domain suggestion** from `DOMAIN_MODULE_HINTS` | Shown as "Recommended" — pre-checked |
| **Preset match** | Shown as "Often used together" — pre-checked |
| **No signal** → clarification flow | Structured questions; answers convert to pre-checks |
| **User describes intent matching unbuilt capability** | Module shown as "Not yet available" — informational only, cannot be selected |

### 6.4 Compatibility

- All existing **validation rules** (entity tracking dependencies, etc.) remain and are enforced **before** build.
- No module is **ever** injected into a persisted template without user having seen and confirmed it.
- Existing `analyzeModuleCompositionForBuild` logic is **extended**, not replaced.

---

## 7. Module abstraction layer (user intent → capabilities)

### 7.1 Problem

A user says "I need to track my shoe inventory." That does not map 1:1 to a single `kind` value or a single module. It maps to a **composite intent** that requires multiple modules, each calling one or more engine capabilities.

### 7.2 Abstraction model

Introduce **intent labels** as a named grouping above individual modules:

```
Intent label:  "Inventory tracking"
  │
  ├── Module: entity_input         → kind: createTrackingEntity, listTrackingEntities
  ├── Module: asset_attacher       → kind: addTrackingSnapshot, receiptAdd
  ├── Module: event_logger         → kind: addTrackingSnapshot, getTrackingProgress
  └── Module: simple_presentation  → kind: getTrackingProgress (for dashboard view)
```

The user never sees "entity_input" or "addTrackingSnapshot." They see "Inventory tracking" with a plain-language description: "Track what items you have, add deliveries, and monitor changes over time."

### 7.3 Intent label registry (initial set)

| Intent label | Plain description | Modules involved | Engine kinds used |
|---|---|---|---|
| **Inventory tracking** | Track items, quantities, and changes | `entity_input`, `event_logger`, `asset_attacher`, `simple_presentation` | `createTrackingEntity`, `addTrackingSnapshot`, `listTrackingSnapshots`, `getTrackingProgress` |
| **Photo analysis** | Score and tag images for quality | `image_input`, `photo_analysis` | `analyzePhotos` |
| **Photo filtering** | Filter images by tags, include/exclude | `image_filter` | *(client-side rule application; or future `filterPhotos` kind)* |
| **Product catalog** | Group images into structured product data | `product_catalog_builder` | `buildProductCatalog` |
| **Photo → Catalog workflow** | Analyze → filter → build catalog | `image_input`, `photo_analysis`, `image_filter`, `product_catalog_builder` | `analyzePhotos`, `buildProductCatalog` |
| **Client tracking** | Manage people + their progress over time | `entity_input`, `event_logger`, `simple_presentation` | `createTrackingEntity`, `addTrackingSnapshot`, `listTrackingSnapshots` |
| **Document comparison** | Compare two documents and extract fields | `document_input`, `document_compare` | `taxDocumentComparison` |
| **Receipt management** | Log, list, and extract receipt data | `receipt_logger` | `receiptAdd`, `receiptList`, `receiptExtract` |
| **Project tracking** | Track contractor/project progress | `entity_input`, `event_logger`, `asset_attacher` | `contractorProjectSave`, `contractorCostTracking`, `contractorReceiptAdd` |

### 7.4 Intent label → module mapping rules

- Intent labels are **detected from user text** using the same keyword/domain/preset detection layer, but at the **intent level** (coarser grain than individual module keywords).
- Intent labels are a **UI/UX convenience layer** only. Under the hood, individual modules are always the unit of composition, ordering, and execution.
- If user text matches multiple intent labels, the **union** of their module sets is proposed (de-duplicated, ordered per §5).
- **"Not yet available" labels** (e.g. "Sales velocity analysis," "Reorder optimization") must be displayed as informational with clear messaging — no fake modules.

---

## 8. Output system (dashboard + persistence)

### 8.1 Problem with current state

`RoomsDashboard` groups pipeline results into destination folders — useful for file-move outcomes but **not** a general output surface. There is no unified view of "what workflow produced what output" across runs or sessions.

### 8.2 Run record structure

Every module workflow run produces a **run record** written to `server/workflowRuns.json` (same atomic-write pattern as `jobsStore.json`):

```json
{
  "runId": "run_abc123",
  "sessionId": "sess_xyz",
  "packSlug": "shoe-store",
  "workflowTemplateId": "shoe-store_composition_v1",
  "moduleOrder": ["entity_input", "event_logger", "simple_presentation"],
  "intentLabel": "Inventory tracking",
  "status": "done",
  "createdAt": "2026-04-21T12:00:00Z",
  "completedAt": "2026-04-21T12:00:45Z",
  "artifactRefs": [
    { "type": "EntitySet",  "artifactId": "art_001" },
    { "type": "EventLog",   "artifactId": "art_002" },
    { "type": "RunRecord",  "artifactId": "art_003" }
  ]
}
```

### 8.3 Artifact store persistence

- During a run: in-memory, keyed by `sessionId`.
- At run completion: serialize to `server/artifactStore/<runId>.json`.
- File cap: 200 run artifact files; oldest pruned automatically (same pattern as jobs).
- Atomic write (`.tmp` → rename) to prevent corruption.

### 8.4 Dashboard design

The **Output Dashboard** (new screen or extended `RoomsDashboard`) must:

| Feature | Design |
|---------|--------|
| **Run list** | Sorted by `completedAt` descending. Shows: pack name, intent label, status, date, module count. |
| **Run detail** | Drill into a run: shows module sequence, per-module artifact summary, engine `kind`s called. |
| **Artifact panels** | Each artifact type has a registered panel component: `AnalysisBatch` → photo grid + scores; `ProductCatalogDraft` → editable product list; `EntitySet` → entity table; etc. |
| **Multi-module grouping** | Artifacts from the same run are grouped under the run header — not interleaved. If a run has 3 modules, their 3 outputs appear as a cohesive result set. |
| **Continue / Recall** | User clicks "Continue" on a past run → session re-hydrates from persisted artifact store → modules that wrote artifacts show as "completed"; subsequent modules can run from current state. |
| **Save note** | User can add a text label to a run (stored in the run record). |
| **Download** | Any `FileManifest` artifact renders download links directly. |

### 8.5 Returning to previous work

1. User opens the Output Dashboard.
2. Selects a past run.
3. System loads `artifactStore/<runId>.json` into session memory.
4. Workflow UI re-opens for that pack, showing which modules have completed artifacts and which have not.
5. User can re-run any step (re-calls the engine, overwrites artifacts for that step forward).

### 8.6 Isolation guarantee

Run record writes and artifact persistence are **async and non-blocking**. They do not share any write path with:

- `/__claira/run` handler response;
- `jobsStore.json` (integration jobs);
- standalone tool state (Photo Sorter / Catalog Builder);
- prebuilt pack flows.

---

## 9. Standalone features (non-negotiable)

Photo Sorter and Build Product Catalog:

- **Remain** at their current routes and entry points (IndustrySelector standalone tools).
- **Call** `POST /__claira/run` with `analyzePhotos` / `buildProductCatalog` — **unchanged**.
- **Are not rewritten** for module parity.

When these same capabilities are invoked **through a workflow module path**, the call goes through:

```text
Module layer → POST /__claira/run with same kind + payload → same handler → same pipeline
```

**One backend.** Two entry points. No drift.

Optional (later, not blocking): standalone tools may **opt in** to writing artifacts into the session artifact store so their results can appear on the Output Dashboard alongside workflow runs. This is **additive** and **not required** for standalone tools to remain functional.

---

## 10. Domain coverage (reality check)

| User intent | Satisfiable today? | Notes |
|-------------|-------------------|-------|
| Photo analysis and sorting | Yes | `analyzePhotos` handler + pipeline |
| Product catalog from images | Yes | `buildProductCatalog` handler + pipeline |
| Client / entity tracking | Yes | `createTrackingEntity`, `addTrackingSnapshot`, etc. |
| Document comparison | Yes | `taxDocumentComparison` |
| Fitness progress tracking | Yes | `fitnessTimelineScan`, etc. |
| Contractor / project tracking | Yes | `contractorProjectSave`, etc. |
| Receipt logging | Yes | `receiptAdd`, `receiptList`, `receiptExtract` |
| **Inventory by SKU + sales velocity** | **No** | No `kind` for sales velocity or SKU-level sell-through analytics |
| **Reorder suggestions / demand forecast** | **No** | No such pipeline or handler |
| **Point-of-sale integration** | **No** | No integration layer for POS systems |

For gaps: Create Your Category must surface an **honest message** (e.g. "Sales analytics is not available yet — this will be added in a future release") rather than offering a module that cannot be backed by an engine capability.

New capabilities require: **new pipeline code** + **new `kind` in `CLAIRA_RUN_HANDLERS`** + **new module definition** — in that order. The orchestration layer is added **last**, after the engine capability exists.

---

## 11. Phased rollout (non-breaking)

| Phase | Deliverable | Risk | Touches existing systems? |
|-------|-------------|------|--------------------------|
| **0 — Define** | Write artifact type schema docs + `moduleCapabilityMap` (data only, no code change) | None | No |
| **1 — Map** | Add `engineKinds` + `produces/consumes` declarations to each module definition file | Very low | Module registry only |
| **2 — Adapter** | Implement engine-call adapters behind each module; feature-flagged off by default | Low | New code only |
| **3 — UX** | Pre-select + confirm selection model; intent label layer in CreateIndustryPanel | Low | CreateIndustryPanel only |
| **4 — Ordering** | Implement ordering algorithm (§5.4) replacing fixed registry order for generated packs | Medium | Workflow composition only |
| **5 — Artifacts** | Implement artifact store; modules write/read via store | Medium | New module execution path |
| **6 — Dashboard** | Output Dashboard MVP: run list, run detail, artifact panels | Low | New screen only |
| **7 — Persistence** | Run records + artifact store persistence to disk | Low | New storage only |
| **8 — Legacy convergence** | Deprecate `executeWorkflow` internal logic that bypasses engine | High | Workflow executor — careful QA needed |
| **9 — New kinds** | Add new `kind`s and pipelines for unmet intents (e.g. inventory analytics) | Isolated | New handlers only |

**Rollback per phase:** Phases 0–7 are additive; each can be reverted without affecting standalone or prebuilt flows. Phase 8 requires careful regression testing of all generated-pack workflows.

---

## 12. Compatibility matrix

| System | Constraint | Modified in this plan? |
|--------|------------|----------------------|
| **Choose Your Category** (prebuilt) | No change to pack loading, capability screens, processing, report, rooms | No |
| **Photo Sorter** | Unchanged routes, calls, UX | No (optional artifact opt-in later) |
| **Build Product Catalog** | Unchanged routes, calls, UX | No (optional artifact opt-in later) |
| **`/__claira/run`** | Unchanged endpoint, no new required fields | No |
| **`CLAIRA_RUN_HANDLERS`** | New kinds added in Phase 9 only, additive | Phase 9 only |
| **Integration layer** (Wix, `/api/claira/*`) | Unchanged | No |
| **Voice system** | Unchanged | No |
| **Electron / PWA** | Unchanged | No |
| **`jobsStore.json`** | Not shared with new run record store | No |

---

## 13. Success criteria (gate before implementation begins)

These must be answerable with "yes" before any code is written:

1. **Engine access:** Is it documented which HTTP call each module makes? (yes = each module has `engineKinds` declared)
2. **Artifact enforcement:** Is it documented what each module produces and consumes? (yes = `produces/consumes` in each module definition)
3. **Ordering:** Can the ordering algorithm produce a deterministic result for any valid module set without any undocumented decisions? (yes = §5 rule table covers all cases)
4. **Dashboard:** Is it clear how a run is stored, recalled, and grouped? (yes = §8 run record schema + artifact store design)
5. **Abstraction:** Is it clear how "inventory tracking" becomes a module set? (yes = §7 intent label registry)
6. **No drift:** Is every module's work ultimately traceable to a `kind` in `CLAIRA_RUN_HANDLERS`? (yes = `moduleCapabilityMap` validation)
7. **No regression:** Does any part of this plan require modifying standalone tool code to function? (no)

---

## 14. Summary

| Topic | Answer |
|-------|--------|
| How modules map to engine | `engineKinds` list per module; all execution via `POST /__claira/run` |
| How execution is unified | One HTTP interface, same handler dispatch, same log/trace for all paths |
| How artifacts flow | Typed artifact store; producer writes, consumer reads; no direct object passing |
| How selection changes | Keyword/domain detection → pre-checked proposal → user confirm/adjust |
| How standalone shares backend | Same `kind`, same handler, same pipeline — module path is a second caller of the same endpoint |
| How ordering works | Structural constraints + artifact dependency graph + explicit tie-break rule table |
| How dashboard works | Run records + artifact store + per-type panel components |
| How intent maps to modules | Intent label layer (§7) groups modules under user-facing descriptions |
| What is not yet possible | Sales analytics, demand forecasting, POS — acknowledged, no fake modules |

---

*Document version: 2.1 — §1–2 corrected to shared internal `runClaira()` function; HTTP is one interface, not the engine.*

---

## 15. Example: Making a Real User Intent Actionable (Shoe Store Case)

This section translates a real-world user prompt into concrete system requirements: atomic modules, engine capabilities (`kind` values), artifact flow, and an honest identification of what does not yet exist.

### The prompt

> *"I have a shoe store and I need to keep track of my inventory, new deliveries, different shoes I have, which shoes are selling more or less so I can decide what I need to reorder. I want to tell you what my current inventory is and keep track from there."*

---

### Data model rule (enforced throughout this section)

**Snapshots represent state. Events represent changes. They must not share structure or be interchangeable.**

| Concept | Type | Meaning | Artifact produced |
|---------|------|---------|-------------------|
| Current stock levels | **State** | A point-in-time value per entity | `SnapshotSet` |
| A delivery arriving | **Event** | An action that occurred at a timestamp | `DeliveryEventLog` |
| A sale occurring | **Event** | An action that occurred at a timestamp | `SalesEventLog` |

State and event artifacts have different schemas. No module may treat them as equivalent.

---

### Step 1: Intent breakdown

| # | User need | System-level requirement |
|---|-----------|--------------------------|
| 1 | Define what items exist | Ingest entity definitions (SKUs, names, attributes) |
| 2 | Register those entities in the system | Create tracked entity records |
| 3 | Record current stock levels | Capture a baseline state snapshot per entity |
| 4 | Log new deliveries | Record incoming stock as timestamped events |
| 5 | Log sales | Record outgoing stock as timestamped events |
| 6 | Compute what has changed | Diff state snapshots against event history |
| 7 | Determine direction of change | Interpret deltas as trends (up / down / flat) |
| 8 | Rank entities by performance | Sort by trend score, velocity, or volume |
| 9 | Label performance status | Classify as top performer, slow seller, etc. |
| 10 | Detect low-stock or declining conditions | Evaluate against configurable thresholds |
| 11 | Generate reorder actions | Produce actionable recommendations per entity |
| 12 | Present all output | Render artifacts as structured dashboard panels |

None of these needs are shoe-specific. The shoe store is one instance of a universal entity-tracking + event-analysis + recommendation pattern.

---

### Step 2: Module design (atomic, universal, engine-backed)

Each module has one responsibility. No module contains computation logic — all work is delegated to engine kinds via `runClaira(kind, payload)`.

---

#### Module 1: `entity_input`

| Field | Value |
|-------|-------|
| **Purpose** | Ingest initial entity definitions from user input, file, or structured data. This is the ingestion step — it produces raw entity data for the registry. Universal: works for products, clients, assets, patients, anything with an identity. |
| **engineKinds** | `ingestData` |
| **Consumes** | *(none — source module)* |
| **Produces** | `RawEntityInput` |
| **Status** | ✅ `ingestData` exists in `CLAIRA_RUN_HANDLERS` |

---

#### Module 2: `entity_registry`

| Field | Value |
|-------|-------|
| **Purpose** | Register ingested entities as tracked records in the system. Distinct from ingestion: `entity_input` brings data in; `entity_registry` creates the durable tracked records. Universal: products, clients, members, patients, etc. |
| **engineKinds** | `createTrackingEntity`, `listTrackingEntities` |
| **Consumes** | `RawEntityInput` |
| **Produces** | `EntitySet` |
| **Status** | ✅ Kinds exist in `CLAIRA_RUN_HANDLERS` |

---

#### Module 3: `inventory_snapshot_logger`

| Field | Value |
|-------|-------|
| **Purpose** | Record the current state of each entity as a point-in-time snapshot (quantities, attributes, levels). This is **state**, not an event. Universal: inventory counts, measurements, financial positions, client metrics. |
| **engineKinds** | `addTrackingSnapshot`, `listTrackingSnapshots` |
| **Consumes** | `EntitySet` |
| **Produces** | `SnapshotSet` |
| **Status** | ✅ Kinds exist in `CLAIRA_RUN_HANDLERS` |

---

#### Module 4: `delivery_logger`

| Field | Value |
|-------|-------|
| **Purpose** | Record incoming stock deliveries as timestamped events against entities. This is an **event**, not a state update. Universal: any domain with incoming stock, intake, or arrival events. |
| **engineKinds** | `addTrackingSnapshot` with `eventType: "delivery"` in payload |
| **Consumes** | `EntitySet` |
| **Produces** | `DeliveryEventLog` |
| **Status** | ✅ Kind exists; `eventType` field is a payload extension — minor, not a new kind |

---

#### Module 5: `sales_logger`

| Field | Value |
|-------|-------|
| **Purpose** | Record outgoing sales as timestamped events against entities. This is an **event**, not a state update. Universal: any domain with outgoing activity, consumption, dispensing, or discharge events. |
| **engineKinds** | `addTrackingSnapshot` with `eventType: "sale"` in payload |
| **Consumes** | `EntitySet` |
| **Produces** | `SalesEventLog` |
| **Status** | ✅ Kind exists; `eventType` field is a payload extension — minor, not a new kind |

---

#### Module 6: `state_delta_computer` ❌ NEW CAPABILITY REQUIRED

| Field | Value |
|-------|-------|
| **Purpose** | Compute raw numerical differences between baseline state and current state, incorporating event history. Produces per-entity delta values. Universal: inventory, fitness metrics, financial balances, any measurable state. |
| **engineKinds** | **`computeStateDelta`** — does not exist yet |
| **Consumes** | `SnapshotSet`, `DeliveryEventLog`, `SalesEventLog` |
| **Produces** | `StateDelta` |
| **Status** | ❌ **Requires new handler + pipeline in `CLAIRA_RUN_HANDLERS`** |
| **Output shape** | `{ entityId, startValue, endValue, netDelta, deliveryTotal, salesTotal }` per entity |

---

#### Module 7: `trend_interpreter` ❌ NEW CAPABILITY REQUIRED

| Field | Value |
|-------|-------|
| **Purpose** | Interpret raw deltas into directional trend signals. Distinct from `state_delta_computer`, which produces numbers — this module produces meaning. Universal: any domain where delta direction matters (up / down / flat / accelerating). |
| **engineKinds** | **`interpretTrends`** — does not exist yet |
| **Consumes** | `StateDelta` |
| **Produces** | `TrendReport` |
| **Status** | ❌ **Requires new handler + pipeline in `CLAIRA_RUN_HANDLERS`** |
| **Output shape** | `{ entityId, direction: "up" \| "down" \| "flat", velocity, periodCount }` per entity |

---

#### Module 8: `ranking_engine` ❌ NEW CAPABILITY REQUIRED

| Field | Value |
|-------|-------|
| **Purpose** | Sort and rank entities by a configurable performance metric (sales volume, net delta, velocity). Produces an ordered list. Universal: products, clients, campaigns, assets — any entity set that needs ranked output. |
| **engineKinds** | **`analyzePerformanceTrends`** — does not exist yet |
| **Consumes** | `TrendReport` |
| **Produces** | `RankedEntities` |
| **Status** | ❌ **Requires new handler + pipeline in `CLAIRA_RUN_HANDLERS`** |
| **Output shape** | `[{ entityId, label, rank, score }]` sorted descending by score; sort key configurable via `moduleOptions.rankBy` |

---

#### Module 9: `performance_classifier` ❌ NEW CAPABILITY REQUIRED

| Field | Value |
|-------|-------|
| **Purpose** | Apply human-readable classification labels to ranked entities. Distinct from ranking: `ranking_engine` produces order; this module produces labels. Universal: top performer, slow seller, stable, critical — labels configurable via `moduleOptions`. |
| **engineKinds** | **`classifyPerformance`** — does not exist yet |
| **Consumes** | `RankedEntities` |
| **Produces** | `PerformanceLabels` |
| **Status** | ❌ **Requires new handler + pipeline in `CLAIRA_RUN_HANDLERS`** |
| **Output shape** | `{ entityId, label: "top_performer" \| "slow_seller" \| "stable" \| "critical" }` per entity |

---

#### Module 10: `threshold_evaluator` ❌ NEW CAPABILITY REQUIRED

| Field | Value |
|-------|-------|
| **Purpose** | Evaluate current state against configurable thresholds to detect alert conditions (low stock, sustained decline). Produces an alert set. Universal: any domain with min/max rules, reorder points, or trigger conditions. |
| **engineKinds** | **`evaluateThresholds`** — does not exist yet |
| **Consumes** | `SnapshotSet`, `PerformanceLabels` |
| **Produces** | `AlertSet` |
| **Status** | ❌ **Requires new handler + pipeline in `CLAIRA_RUN_HANDLERS`** |
| **Output shape** | `{ entityId, alertType: "low_stock" \| "declining" \| "critical", currentValue, threshold }` per triggered entity |

---

#### Module 11: `recommendation_generator` ❌ NEW CAPABILITY REQUIRED

| Field | Value |
|-------|-------|
| **Purpose** | Generate specific actionable recommendations from alert conditions and performance data. Produces a recommendation set. Universal: reorder, escalate, retire, promote — action types configurable via `moduleOptions`. |
| **engineKinds** | **`generateRecommendations`** — does not exist yet |
| **Consumes** | `AlertSet`, `RankedEntities` |
| **Produces** | `RecommendationSet` |
| **Status** | ❌ **Requires new handler + pipeline in `CLAIRA_RUN_HANDLERS`** |
| **Output shape** | `{ entityId, label, action, urgency: "high" \| "medium" \| "low", reason }` per recommendation |

---

#### Module 12: `dashboard_presenter`

| Field | Value |
|-------|-------|
| **Purpose** | Render all available artifacts from the current run as structured UI panels. UI-only: no computation, no engine calls. Reads from the artifact store and maps each artifact type to a registered panel component. |
| **engineKinds** | `getTrackingProgress` (optional, for live refresh only) |
| **Consumes** | `EntitySet`, `SnapshotSet`, `DeliveryEventLog`, `SalesEventLog`, `StateDelta`, `TrendReport`, `RankedEntities`, `PerformanceLabels`, `AlertSet`, `RecommendationSet` |
| **Produces** | *(nothing — UI only)* |
| **Status** | ✅ Panel framework exists; new panel components required for `TrendReport`, `RankedEntities`, `PerformanceLabels`, `AlertSet`, `RecommendationSet` |

> **Note:** `RunRecord` is produced by the **orchestrator** at run completion, not by `dashboard_presenter`. The presenter renders; the orchestrator records.

---

### Step 3: Artifact flow

```text
  [User provides entity definitions]
       │
       ▼
  entity_input
  kind: ingestData
       │ produces
       ▼
  RawEntityInput
       │
       ▼
  entity_registry
  kind: createTrackingEntity (per entity)
       │ produces
       ▼
  EntitySet ─────────────────────────────────────────────────────────────┐
       │                                                                   │
       ├──────────────────────────────────┐                               │
       │                                  │                               │
       ▼                                  ▼                               │
  inventory_snapshot_logger         delivery_logger                       │
  kind: addTrackingSnapshot         kind: addTrackingSnapshot             │
        (baseline state)                  (eventType: "delivery")         │
       │ produces                         │ produces                      │
       ▼                                  ▼                               │
  SnapshotSet (STATE)              DeliveryEventLog (EVENTS)              │
       │                                  │                               │
       │                    sales_logger  │                               │
       │                    kind: addTrackingSnapshot                     │
       │                          (eventType: "sale")                     │
       │                          │ produces                              │
       │                          ▼                                       │
       │                    SalesEventLog (EVENTS)                        │
       │                          │                                       │
       └──────────────────────────┘                                       │
                      │                                                   │
                      ▼                                                   │
  state_delta_computer                                                    │
  kind: computeStateDelta (NEW)                                           │
  consumes: SnapshotSet + DeliveryEventLog + SalesEventLog               │
       │ produces                                                         │
       ▼                                                                  │
  StateDelta                                                              │
       │                                                                  │
       ▼                                                                  │
  trend_interpreter                                                       │
  kind: interpretTrends (NEW)                                             │
       │ produces                                                         │
       ▼                                                                  │
  TrendReport                                                             │
       │                                                                  │
       ▼                                                                  │
  ranking_engine                                                          │
  kind: analyzePerformanceTrends (NEW)                                    │
       │ produces                                                         │
       ▼                                                                  │
  RankedEntities                                                          │
       │                                                                  │
       ▼                                                                  │
  performance_classifier                                                  │
  kind: classifyPerformance (NEW)                                         │
       │ produces                                                         │
       ▼                                                                  │
  PerformanceLabels                                                       │
       │                                                                  │
       ▼                                                                  │
  threshold_evaluator ←─ also consumes SnapshotSet ──────────────────────┘
  kind: evaluateThresholds (NEW)
       │ produces
       ▼
  AlertSet
       │
       ▼
  recommendation_generator ←─ also consumes RankedEntities
  kind: generateRecommendations (NEW)
       │ produces
       ▼
  RecommendationSet
       │
       ▼
  dashboard_presenter
  (UI only — renders all artifacts from artifact store)

  [orchestrator]
  produces: RunRecord → Output Dashboard (at run completion)
```

---

### Step 4: Capability gap summary

| Capability needed | Kind required | Status | Build priority |
|-------------------|---------------|--------|----------------|
| Ingest entity definitions | `ingestData` | ✅ Exists | — |
| Register entities as tracked records | `createTrackingEntity`, `listTrackingEntities` | ✅ Exists | — |
| Record baseline state snapshot | `addTrackingSnapshot`, `listTrackingSnapshots` | ✅ Exists | — |
| Log delivery events | `addTrackingSnapshot` + `eventType: "delivery"` | ✅ Near-exists | Minor — payload extension only |
| Log sale events | `addTrackingSnapshot` + `eventType: "sale"` | ✅ Near-exists | Minor — payload extension only |
| Compute state delta | `computeStateDelta` | ❌ Missing | **Must build** |
| Interpret trends from deltas | `interpretTrends` | ❌ Missing | **Must build** |
| Rank entities by performance | `analyzePerformanceTrends` | ❌ Missing | **Must build** |
| Classify performance labels | `classifyPerformance` | ❌ Missing | **Must build** |
| Evaluate thresholds / alerts | `evaluateThresholds` | ❌ Missing | **Must build** |
| Generate recommendations | `generateRecommendations` | ❌ Missing | **Must build** |
| Render dashboard panels | UI panel components (partial) | 🔶 Partial | Low effort — new panel components |

**Bottom line:** 3 capabilities exist fully. 2 need minor payload extensions. 5 require new handlers and pipelines. 1 requires new UI panel components.

The shoe-store workflow **cannot** be fully delivered until `computeStateDelta`, `interpretTrends`, `analyzePerformanceTrends`, `classifyPerformance`, `evaluateThresholds`, and `generateRecommendations` are built and registered in `CLAIRA_RUN_HANDLERS`. This must be communicated to the user during module selection — not after confirmation.

---

### Step 5: What the user sees (UX translation)

| Module | What the user sees |
|--------|--------------------|
| `entity_input` | "Describe or upload your items" |
| `entity_registry` | "Your items are registered in the system" |
| `inventory_snapshot_logger` | "Record your current stock levels" |
| `delivery_logger` | "Log new deliveries" |
| `sales_logger` | "Log sales" |
| `state_delta_computer` | *(runs automatically, no user label needed)* |
| `trend_interpreter` | "See how your stock is moving" |
| `ranking_engine` | "See which items sell most" |
| `performance_classifier` | "Items labelled: top seller, slow mover, etc." |
| `threshold_evaluator` | "Alerts for low or declining stock" |
| `recommendation_generator` | "Get reorder suggestions" |
| `dashboard_presenter` | "Your inventory dashboard" |
| ❌ Gap message | "Trend analysis, rankings, alerts, and recommendations are not yet available. You can start tracking your inventory and logging activity now. These features will be added in a future release." |

---

### Step 6: What the intent label registry entry looks like

```
Intent label:  "Inventory tracking"
Plain description: "Track what items you have, record new deliveries and sales, see what's changing, and get reorder suggestions."

Detected keywords: "inventory", "deliveries", "track", "reorder", "selling"
Domain match: "commerce"

Proposed modules (pre-checked):
  ✅ entity_input
  ✅ entity_registry
  ✅ inventory_snapshot_logger
  ✅ delivery_logger
  ✅ sales_logger
  ⚠ state_delta_computer      [NOT YET AVAILABLE — shown informational]
  ⚠ trend_interpreter         [NOT YET AVAILABLE — shown informational]
  ⚠ ranking_engine            [NOT YET AVAILABLE — shown informational]
  ⚠ performance_classifier    [NOT YET AVAILABLE — shown informational]
  ⚠ threshold_evaluator       [NOT YET AVAILABLE — shown informational]
  ⚠ recommendation_generator  [NOT YET AVAILABLE — shown informational]
  ✅ dashboard_presenter

User message:
  "You can start recording your inventory, deliveries, and sales today.
   Trend analysis, performance rankings, and reorder suggestions are not
   yet available — they will be added in a future release."
```

---

### Summary of this section

1. **12 atomic modules replace the original 7 overloaded ones.** Each module has exactly one responsibility, one set of engine kinds, and one artifact it produces.

2. **State and events are kept strictly separate.** `SnapshotSet` (state), `DeliveryEventLog` (events), and `SalesEventLog` (events) are different artifact types with different schemas. No module treats them as equivalent.

3. **`dashboard_presenter` produces nothing.** It is a UI-only module. The orchestrator produces `RunRecord` at run completion.

4. **`entity_input` and `entity_registry` are distinct.** Ingestion and registration are separate concerns handled by separate modules.

5. **5 new engine capabilities are required** (`computeStateDelta`, `interpretTrends`, `analyzePerformanceTrends`, `classifyPerformance`, `evaluateThresholds`, `generateRecommendations`). All must exist in `CLAIRA_RUN_HANDLERS` before the corresponding modules can be written. Orchestration is always last.

6. **All 12 modules are domain-agnostic.** The same set applies verbatim to clothing, electronics, medical supplies, gym equipment, or any entity-with-quantity domain.

---

## 16. Module Granularity Rules (System-Wide Standard)

This section defines how modules must be designed across the entire Claira system, regardless of domain, feature, or entry point.

**Goal:** ensure every module is composable, reusable, engine-aligned, non-overlapping, and scalable across domains.

---

### Core principle

Modules must be **atomic orchestration units.**

A module represents:

- one clear responsibility
- one stage in a workflow
- one transformation of data, delegated entirely to the engine

A module is **not** a full feature, a complete tool, or a multi-step process.

---

### Rule 1: Single responsibility

Each module must do exactly one thing.

**✅ Correct granularity:**

| Module | Single responsibility |
|--------|-----------------------|
| `entity_registry` | Register tracked entities |
| `inventory_snapshot_logger` | Record a point-in-time state |
| `sales_logger` | Log outgoing sale events |
| `ranking_engine` | Sort entities by a metric |
| `trend_interpreter` | Interpret delta values as direction |
| `threshold_evaluator` | Detect alert conditions against thresholds |

**❌ Too large (violations):**

| Overloaded module | Problem |
|-------------------|---------|
| `inventory_manager` | Combines tracking + analysis + recommendations — three responsibilities |
| `photo_sorter` | Combines analysis + filtering + ranking + grouping — four responsibilities |
| `business_dashboard` | Renders + computes + aggregates — presentation mixed with logic |
| `event_logger` (original) | Mixed delivery events and sale events — two distinct event types |
| `state_diff_analyzer` (original) | Combined raw computation with trend interpretation |

**Test:** If you can describe a module with the word "and" — *"it tracks entities and logs events and ranks them"* — it must be split.

---

### Rule 2: Engine mapping

Each module must map cleanly to engine capabilities via `runClaira(kind, payload)`.

**✅ Preferred — one module, one kind:**

```
sales_logger → runClaira("addTrackingSnapshot", { eventType: "sale", ... })
trend_interpreter → runClaira("interpretTrends", { stateDelta })
recommendation_generator → runClaira("generateRecommendations", { alertSet })
```

**✅ Allowed — one module, a small set of closely related kinds:**

A module may call more than one kind if:
- the kinds are semantically inseparable (create + verify, list + hydrate);
- both kinds always run together for the same stage;
- there is no scenario where only one would run.

```
entity_registry → runClaira("createTrackingEntity", ...)
                  runClaira("listTrackingEntities", ...)   ← always paired
```

**❌ Forbidden:**

| Pattern | Why forbidden |
|---------|---------------|
| Module calls many unrelated kinds based on conditions | Creates hidden branching — the module is actually multiple modules |
| Module conditionally behaves like a different system | Violates single responsibility; impossible to compose predictably |
| Module calls kinds from different domains without a clear shared purpose | Tight coupling across unrelated capabilities |

**Rule:** If the set of kinds a module calls changes based on `moduleOptions` in a way that produces fundamentally different outputs, the module must be split.

---

### Rule 3: No internal logic

Modules must not implement any of the following:

- scoring
- ranking
- analysis
- transformation
- classification
- threshold evaluation
- recommendation logic
- filtering or sorting algorithms

**✅ Correct module behavior:**

```js
// Module builds payload from artifacts and calls the engine
async function execute(artifacts, moduleOptions, context) {
  const payload = buildPayload(artifacts, moduleOptions);   // shape only
  const result  = await runClaira("interpretTrends", payload, context);
  return normalizeToArtifacts(result);                      // schema only
}
```

**❌ Violation — logic inside the module:**

```js
// WRONG: module is doing analysis itself
async function execute(artifacts) {
  const deltas = artifacts.stateDelta.data;
  const trends = deltas.map(d => ({
    ...d,
    direction: d.netDelta > 0 ? "up" : d.netDelta < 0 ? "down" : "flat",
    velocity: Math.abs(d.netDelta) / d.periodCount   // ← logic belongs in engine
  }));
  return { type: "TrendReport", data: trends };       // bypasses engine entirely
}
```

The logic in the violation example belongs in the `interpretTrends` handler inside `CLAIRA_RUN_HANDLERS`. The module's job is only to call it.

---

### Rule 4: Artifact contract

Each module must declare a complete artifact contract. No exceptions.

```js
{
  id: "trend_interpreter",
  engineKinds: ["interpretTrends"],
  consumes: ["StateDelta"],      // must exist in artifact store before this module runs
  produces: ["TrendReport"],     // written to artifact store after engine responds
}
```

**Rules:**

| Field | Requirement |
|-------|-------------|
| `engineKinds` | At least one. All must exist in `CLAIRA_RUN_HANDLERS` or be marked `NEW`. |
| `consumes` | All listed types must be producible by a module earlier in the valid ordering. If a type is missing at runtime, the module fails visibly. |
| `produces` | Exactly the artifact types written after the engine call. No implicit side-effects. |

**A module with no `consumes` is a source module** (e.g. `entity_input`). There must be at least one source module in every workflow.

**A module with no `produces` is a terminal module** (e.g. `dashboard_presenter`). There can be at most one per run, and it must have no modules that depend on it.

---

### Rule 5: Universal design (no domain hardcoding)

Modules must not reference specific domains, industries, business types, or entity names in their code or contract.

**✅ Universal:**

```
sales_logger       — works for retail, gym attendance, medication dispensing, file downloads
threshold_evaluator — works for stock levels, client metrics, document counts, any numeric threshold
ranking_engine     — works for products, clients, campaigns, assets, anything with a score
```

**❌ Domain-hardcoded (forbidden):**

```
shoe_reorder_checker    — hardcoded to shoe retail
fitness_client_ranker   — hardcoded to fitness domain
tax_document_diff       — hardcoded to tax, cannot reuse for financial or medical docs
```

Domain-specific behavior is expressed only through `moduleOptions` (labels, thresholds, field names, sort keys) — never through module IDs or module code.

---

### Rule 6: Ordering compatibility

Every module must declare a `pipelineType` that is compatible with the ordering rules in §5.

| pipelineType | Meaning | Constraint |
|---|---|---|
| `"input"` | Source — brings data into the run | No `consumes` requirement; must run before any `"processing"` module |
| `"processing"` | Transform — calls engine, produces artifacts | Must follow at least one `"input"` module |
| `"output"` | Materialize — produces final data artifact (files, records) | Must follow at least one `"processing"` module |
| `"presentation"` | Render — UI only, produces nothing | Must follow at least one `"output"` module; terminal |

A module whose only job is to call the engine and write an artifact is `"processing"`. A module that writes files to disk is `"output"`. A module that only renders the artifact store is `"presentation"`.

---

### Rule 7: New capabilities before new modules

If a module requires a `kind` that does not exist in `CLAIRA_RUN_HANDLERS`, the module cannot be built until:

1. The pipeline logic is written in `interfaces/`;
2. The handler is registered in `CLAIRA_RUN_HANDLERS` with the `kind` string;
3. The handler is tested independently via `/__claira/run`.

**The orchestration (module) layer is always last.** A module stub that calls a non-existent kind is forbidden. Mark the capability as `❌ NEW — must build` in the registry and block module creation until the handler exists.

---

### Granularity decision guide

When designing a new module, answer these questions in order:

```
1. Can I describe this module's job in one sentence without the word "and"?
      No  → split it
      Yes → continue

2. Does it map to one or a small set of closely related engine kinds?
      No  → split it or design the missing kind first
      Yes → continue

3. Does it contain any logic (scoring, filtering, ranking, interpretation)?
      Yes → move that logic to a handler + pipeline; module only calls runClaira()
      No  → continue

4. Does it have explicit consumes and produces?
      No  → add them before proceeding
      Yes → continue

5. Would this module work in a domain completely different from the one I'm building for?
      No  → remove domain-specific assumptions; use moduleOptions for domain config
      Yes → module design is valid
```

---

### Summary table: rules at a glance

| Rule | Requirement | Violation |
|------|-------------|-----------|
| **1 — Single responsibility** | One purpose, one stage | Module does multiple things; describable with "and" |
| **2 — Engine mapping** | 1–few closely related kinds | Many unrelated kinds; conditional kind switching |
| **3 — No internal logic** | Only `runClaira()` + artifact shaping | Analysis, scoring, ranking inside module |
| **4 — Artifact contract** | `engineKinds`, `consumes`, `produces` declared | Missing fields; implicit side-effects |
| **5 — Universal design** | Works across domains via `moduleOptions` | Domain name or entity type hardcoded in module |
| **6 — Ordering compatibility** | `pipelineType` declared and valid | Missing type; incompatible position in pipeline |
| **7 — Engine-first build order** | Handler exists before module is written | Module calls non-existent kind |

---

## 17. UI Rendering System (Module Output Layout Architecture)

This section defines how module outputs are rendered into a structured, scalable UI. The UI is not ad hoc, not manually arranged per workflow, and not generated randomly. It is **composed deterministically from predefined layout rules driven entirely by module output definitions.**

---

### Core principle

```text
Module produces artifact
       │
       ▼
Artifact has a registered outputId
       │
       ▼
outputId maps to a UI component definition
       │
       ▼
Component definition declares section + layout + dimensions + behavior
       │
       ▼
Layout engine places component into the 3-section grid
       │
       ▼
Dashboard renders the final composed UI
```

No component is placed manually. No layout decision is made at render time. Every output's position, size, and behavior is determined **before** the workflow runs, from its component definition.

---

### 1. Output ID system

Every module output must declare a stable, unique `outputId`.

**Format:**

```
<moduleId>__<artifactType>
```

**Examples:**

| outputId | Module | Artifact |
|----------|--------|----------|
| `entity_registry__EntitySet` | `entity_registry` | `EntitySet` |
| `inventory_snapshot_logger__SnapshotSet` | `inventory_snapshot_logger` | `SnapshotSet` |
| `delivery_logger__DeliveryEventLog` | `delivery_logger` | `DeliveryEventLog` |
| `sales_logger__SalesEventLog` | `sales_logger` | `SalesEventLog` |
| `ranking_engine__RankedEntities` | `ranking_engine` | `RankedEntities` |
| `performance_classifier__PerformanceLabels` | `performance_classifier` | `PerformanceLabels` |
| `threshold_evaluator__AlertSet` | `threshold_evaluator` | `AlertSet` |
| `recommendation_generator__RecommendationSet` | `recommendation_generator` | `RecommendationSet` |
| `photo_analysis__AnalysisBatch` | `photo_analysis` | `AnalysisBatch` |
| `product_catalog_builder__ProductCatalogDraft` | `product_catalog_builder` | `ProductCatalogDraft` |

The `outputId` is the single key used for:
- rendering (component lookup);
- layout positioning (section assignment);
- persistence mapping (artifact store reference);
- dashboard recall (re-hydrating a past run).

---

### 2. Output component definition

Every module output must have a registered component definition. This definition is the contract between the module system and the UI renderer.

**Definition schema:**

```js
{
  outputId:     string,        // e.g. "ranking_engine__RankedEntities"
  title:        string,        // human-readable panel title
  artifactType: string,        // must match the artifact type produced by the module

  layout: {
    section:    "top" | "middle" | "bottom",
    columnSpan: 1 | 2 | 3,    // out of 3-column grid
    minWidth:   number,        // px
    minHeight:  number,        // px
    maxHeight:  number | null, // null = unconstrained
    grow:       boolean,       // flex-grow: 1 if true
  },

  behavior: {
    scrollable:  boolean,
    expandable:  boolean,      // user can click to expand to full width
    priority:    "high" | "medium" | "low",  // determines order within section
  },

  uiTab: string,               // which tab this output belongs to (see §17.8)
}
```

**No field may be omitted.** A module with an undeclared output component definition must not be registered.

---

### 3. Page layout system (3-row grid)

The dashboard is divided into three fixed sections arranged vertically:

```text
┌─────────────────────────────────────────────────────┐
│  TOP SECTION                                        │
│  Summary · Key insights · Decisions · Alerts        │
│  High-priority outputs                              │
├─────────────────────────────────────────────────────┤
│  MIDDLE SECTION                                     │
│  Core operational data · Entity lists · Snapshots  │
│  Medium-priority outputs                            │
├─────────────────────────────────────────────────────┤
│  BOTTOM SECTION                                     │
│  Logs · Raw event history · File manifests          │
│  Low-priority / detail outputs                      │
└─────────────────────────────────────────────────────┘
```

Each section is a flex container:

```css
display: flex;
flex-wrap: wrap;
gap: 16px;
padding: 16px;
align-items: flex-start;
```

Components inside a section are laid out left-to-right, wrapping to the next row when the row is full. The 3-column grid is defined by `columnSpan`:

```
columnSpan: 1  →  width: calc(33.33% - gap)
columnSpan: 2  →  width: calc(66.66% - gap)
columnSpan: 3  →  width: 100%
```

---

### 4. Layout rules (non-negotiable)

#### No overlap

- All components share the same document flow (no `position: absolute`).
- No `z-index` layering between output panels.
- Components never overlap. If they cannot fit on one row, they wrap to the next.

#### No manual arrangement

- No workflow definition, pack file, or user prompt may specify exact pixel positions.
- Position is always derived from `section` + `priority` + `columnSpan`.

#### Spacing

- Gap between panels: `16px` (consistent, not variable per module).
- Internal padding within each panel: `16px`.
- Panel title spacing: consistent heading style from the shared design system.

#### Responsiveness

- On narrow viewports, `columnSpan` is relaxed: all panels become `columnSpan: 3` (full width) below a defined breakpoint.
- `grow: true` causes the panel to expand to fill remaining row space when it is the only panel on a row.

#### Priority ordering within sections

Within each section, panels are ordered by `priority`:

```
1. "high"    → rendered first (leftmost / topmost)
2. "medium"  → rendered second
3. "low"     → rendered last
```

Ties within the same priority are broken by `outputId` alphabetical order (deterministic).

---

### 5. Section mapping rules

The following table is the canonical assignment of artifact types to sections. Modules must declare the section that matches their artifact type. Overrides require explicit justification in the module definition.

#### TOP — summary and decision layer

| Artifact type | Rationale |
|---|---|
| `RecommendationSet` | Actionable — user acts on this first |
| `AlertSet` | Urgent — draws immediate attention |
| `RankedEntities` | Summary insight — "what is performing best/worst" |
| `PerformanceLabels` | Classification labels — decision support |
| `TrendReport` (summarized view) | Direction signal — key business insight |

#### MIDDLE — core operational data

| Artifact type | Rationale |
|---|---|
| `EntitySet` | Primary reference data — the list of tracked items |
| `SnapshotSet` | Current state — the numbers the user cares about |
| `FilteredImageSet` | Working set — images selected for further action |
| `ProductCatalogDraft` | Core output — editable product list |
| `AnalysisBatch` | Main analysis result — thumbnails, scores, tags |
| `StateDelta` | Delta table — what changed and by how much |

#### BOTTOM — logs and detail

| Artifact type | Rationale |
|---|---|
| `DeliveryEventLog` | Timestamped history — detail layer |
| `SalesEventLog` | Timestamped history — detail layer |
| `EventLog` | Generic event history — detail layer |
| `FileManifest` | File output list — reference / download |
| `RawEntityInput` | Source data — lowest priority, rarely needed |

---

### 6. Standard dimension sizes

| Size label | columnSpan | minHeight | Typical use |
|---|---|---|---|
| **small** | 1 | 200px | Status chips, label sets, single-metric displays |
| **medium** | 2 | 300px | Tables, ranked lists, snapshot grids |
| **large** | 3 | 400px | Full-width dashboards, catalog editors, event logs |
| **full** | 3 | unconstrained | Expanding logs, detailed editors with scroll |

**Assignment rules:**

| Condition | Assigned size |
|---|---|
| `priority: "high"` | large (columnSpan: 3) |
| Tabular data (entity lists, snapshots, rankings) | medium (columnSpan: 2) |
| Timestamped logs | full (columnSpan: 3, scrollable) |
| Label sets or classification chips | small (columnSpan: 1) |
| Recommendations with action buttons | large (columnSpan: 3) |

---

### 7. Example layout: Shoe Store workflow

The following shows how the shoe store modules from §15 map to the UI layout.

#### Tab: "Inventory"

```text
┌─────────────────────────────────────────────────────────────────────┐
│  TOP                                                                │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ recommendation_generator__RecommendationSet                   │ │
│  │ "Reorder Suggestions"   [large · high priority · columnSpan:3]│ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─────────────────────────────┐ ┌─────────────────────────────┐   │
│  │ ranking_engine__             │ │ threshold_evaluator__        │   │
│  │ RankedEntities               │ │ AlertSet                     │   │
│  │ "Top / Worst Performers"     │ │ "Stock Alerts"               │   │
│  │ [medium · high · span:2]     │ │ [small · high · span:1]      │   │
│  └─────────────────────────────┘ └─────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  MIDDLE                                                             │
│                                                                     │
│  ┌─────────────────────────────┐ ┌─────────────────────────────┐   │
│  │ entity_registry__EntitySet  │ │ inventory_snapshot_logger__  │   │
│  │ "Current Inventory"         │ │ SnapshotSet                  │   │
│  │ [medium · medium · span:2]  │ │ "Stock Levels"               │   │
│  └─────────────────────────────┘ │ [medium · medium · span:2]   │   │
│                                   └─────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  BOTTOM                                                             │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ delivery_logger__DeliveryEventLog                             │ │
│  │ "Recent Deliveries"          [full · low · scrollable]        │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ sales_logger__SalesEventLog                                   │ │
│  │ "Recent Sales"               [full · low · scrollable]        │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 8. Tab system (multi-domain workflows)

When a workflow spans more than one intent domain, the dashboard is divided into tabs. Each tab has its own independent 3-section layout.

#### Tab generation rule

Tabs are created from `uiTab` values declared in module output definitions. One tab is created per unique `uiTab` value present in the active module set.

| `uiTab` value | Tab label |
|---|---|
| `"inventory"` | Inventory |
| `"finance"` | Finance |
| `"media"` | Media |
| `"documents"` | Documents |
| `"clients"` | Clients |
| `"activity"` | Activity |
| `"output"` | Output |

#### Module → tab assignment (examples)

| Module | `uiTab` |
|--------|---------|
| `entity_registry` | `"inventory"` |
| `inventory_snapshot_logger` | `"inventory"` |
| `delivery_logger` | `"inventory"` |
| `sales_logger` | `"inventory"` |
| `ranking_engine` | `"inventory"` |
| `recommendation_generator` | `"inventory"` |
| `receipt_logger` | `"finance"` |
| `photo_analysis` | `"media"` |
| `product_catalog_builder` | `"media"` |
| `document_compare` | `"documents"` |
| `entity_input` | `"inventory"` |
| `dashboard_presenter` | *(renders all tabs — no single tab assignment)* |

#### Tab behavior rules

- Each tab renders only the outputs assigned to it.
- Tabs are ordered by the sequence in which their first output appears in the module execution order.
- A shared artifact (one produced by a module in tab A, consumed in tab B) may be displayed in both tabs if declared in multiple output component definitions.
- `dashboard_presenter` is not assigned to a single tab; it is the container for the entire tab interface.

---

### 9. Full rendering pipeline

```text
1. Workflow runs → modules execute in order (§5 ordering rules)
       │
       ▼
2. Each module calls runClaira(kind, payload) → receives engine response
       │
       ▼
3. Module normalizes response → writes typed artifact(s) to artifact store
       │
       ▼
4. Orchestrator maps each artifact to its outputId
   Format: <moduleId>__<artifactType>
       │
       ▼
5. Renderer looks up component definition for each outputId
   (section, columnSpan, minHeight, priority, behavior, uiTab)
       │
       ▼
6. Renderer groups components by uiTab → creates tab structure
       │
       ▼
7. Within each tab, renderer groups components by section (top / middle / bottom)
       │
       ▼
8. Within each section, renderer orders components by priority (high → medium → low)
       │
       ▼
9. Layout engine applies flex rules → panels arranged in grid, no overlap
       │
       ▼
10. Each panel component receives its artifact data → renders its content
       │
       ▼
11. Orchestrator writes RunRecord to Output Dashboard index
       │
       ▼
12. User sees a fully composed, deterministic UI
```

No step in this pipeline makes a layout decision at runtime. All decisions are encoded in the component definitions (step 5).

---

### 10. Non-negotiable constraints

| Constraint | Rule |
|---|---|
| **No manual layout** | No workflow definition, pack file, or user prompt may specify component positions |
| **No absolute positioning** | All layout via `flex` / `grid` only |
| **No overlapping panels** | Components are always in document flow; no `z-index` stacking between panels |
| **No runtime layout logic** | Section, columnSpan, and priority are read from the component definition, not computed at render time |
| **No undefined outputs** | Every `produces` artifact type must have a registered component definition |
| **No orphaned definitions** | Every component definition must map to a real artifact type produced by a real module |

---

### 11. Future extensibility

The following features are explicitly planned but **must not break** the default deterministic layout:

| Future feature | Design constraint |
|---|---|
| **Drag-and-drop reordering** | Stores a user-override layout per `runId`; falls back to default if no override exists |
| **Panel resizing** | User can resize within the declared min/max bounds; layout persists to `server/layoutOverrides.json` |
| **Saving custom layouts** | Custom layout is keyed to `packSlug + templateId`; does not affect other packs |
| **Hiding / showing outputs** | User can toggle visibility; hidden state stored in layout override; default always shows all |
| **Dashboard themes** | Affects visual style only; never affects section assignment or priority rules |

The default layout (from component definitions) must always be reproducible without any stored overrides. Custom layouts are additive; they cannot remove the default layout as a fallback.

---

## 18. Frontend Architecture Specification (Phase 6 Reference)

The following two sub-sections are **specification-level documents** for Phase 6 (Dashboard MVP). They translate the module + artifact + outputId system defined in §§4, 16, and 17 into a concrete, implementable React architecture and a visual layout reference. No code should be written from this section until Phase 5 (artifact store) is complete.

**Assessment summary:**

| Sub-section | Architectural conflicts | Implementation phase |
|---|---|---|
| §18.1 React Component Architecture | None | Phase 6 (after Phase 5 artifact store) |
| §18.2 Visual Wireframe System | None | Design reference now; implement in Phase 6 |

---

### §18.1 React Component Architecture

**Purpose:** Translate the module + artifact + outputId system into a concrete, implementable React structure that can be built without ambiguity. This section is the implementation spec for the UI layer described in §17.

---

#### 18.1.1 Component Hierarchy

The full tree from root screen to rendered content:

```text
App
└── OutputDashboard                    ← manages run state and artifact store
    └── TabContainer                   ← drives tab switching from uiTab values
        └── TabPage (per uiTab)        ← owns one tab's full layout
            ├── SectionRow [top]       ← section region, flex container
            │   └── OutputGrid         ← flex wrap, priority-sorted
            │       ├── OutputCard (outputId="recommendation_generator__RecommendationSet")
            │       │   ├── OutputHeader
            │       │   └── OutputContent → <RecommendationSetPanel />
            │       └── OutputCard (outputId="ranking_engine__RankedEntities")
            │           ├── OutputHeader
            │           └── OutputContent → <RankedEntitiesPanel />
            ├── SectionRow [middle]
            │   └── OutputGrid
            │       ├── OutputCard (outputId="entity_registry__EntitySet")
            │       │   └── OutputContent → <EntitySetPanel />
            │       └── OutputCard (outputId="inventory_snapshot_logger__SnapshotSet")
            │           └── OutputContent → <SnapshotSetPanel />
            └── SectionRow [bottom]
                └── OutputGrid
                    ├── OutputCard (outputId="delivery_logger__DeliveryEventLog")
                    │   └── OutputContent → <EventLogPanel />
                    └── OutputCard (outputId="sales_logger__SalesEventLog")
                        └── OutputContent → <EventLogPanel />
```

---

#### 18.1.2 Component Responsibilities

Each component has exactly one responsibility. No component may cross into another's domain.

**`OutputDashboard`**
- Holds the artifact store for the current run (`useReducer` or `useState`)
- Loads artifacts on mount from `server/artifactStore.json` (Phase 5)
- Listens for run completion updates and refreshes the store
- Derives the list of active `uiTab` values from loaded artifacts
- Passes `{ artifacts, runId, activeTab, setActiveTab }` to `TabContainer`
- Never renders any output content directly

**`TabContainer`**
- Receives the list of tabs derived from active artifacts
- Renders one tab button per `uiTab` value
- Tracks `activeTab` state (or lifts to `OutputDashboard`)
- Renders one `TabPage` for each tab; hides inactive tabs (CSS, not unmount — preserves scroll position)
- Does not know about sections or output cards

**`TabPage`**
- Receives `{ tab, artifacts }` — all artifacts belonging to this tab
- Renders exactly three `SectionRow` instances: top, middle, bottom
- Passes each section its filtered artifact list (by `layout.section`)
- Does not know about layout dimensions or content rendering

**`SectionRow`**
- Receives `{ section: "top" | "middle" | "bottom", outputs }` — resolved output definitions for this section
- Renders a flex container with section label
- Passes ordered output list to `OutputGrid` (sorted by `behavior.priority`)
- Does not know about artifact types or content

**`OutputGrid`**
- Receives a list of `{ outputId, definition }` entries
- Renders them in document order using `display: flex; flex-wrap: wrap; gap: 16px`
- Applies `flex: 0 0 calc((columnSpan / 3) * 100% - gap)` per card
- Below breakpoint (768px): all items become `flex: 0 0 100%`
- Does not know about artifact content

**`OutputCard`**
- Receives `{ outputId, definition, artifact }`
- Reads `definition.layout` to set its flex sizing
- Reads `definition.behavior` to apply `overflow-y: auto` (scrollable) or expand toggle
- Renders `OutputHeader` (title, controls) and `OutputContent` (the domain panel)
- Never inspects `artifact.data` — passes it opaquely to `OutputContent`

**`OutputHeader`**
- Receives `{ title, expandable, onExpand, onCollapse }`
- Renders the card title and optional expand/collapse button
- Stateless; parent (`OutputCard`) owns expanded state

**`OutputContent`**
- Receives `{ artifactType, artifact, moduleOptions }`
- Looks up `ContentComponent = outputRegistry[artifactType]`
- Renders `<ContentComponent artifact={artifact} moduleOptions={moduleOptions} />`
- If no component found: renders a `<FallbackPanel>` with raw JSON

---

#### 18.1.3 Two-Level Registry System

There are two distinct registries. They serve different purposes and must not be merged.

**Registry 1 — `outputComponentRegistry`** (outputId → layout + content)

Defined once per workflow pack. Maps a specific module output to its full definition.

```js
// ui/registries/outputComponentRegistry.js

export const outputComponentRegistry = {
  "recommendation_generator__RecommendationSet": {
    definition: {
      outputId:     "recommendation_generator__RecommendationSet",
      title:        "Reorder Suggestions",
      artifactType: "RecommendationSet",
      layout:       { section: "top", columnSpan: 3, minHeight: 400, grow: true },
      behavior:     { scrollable: false, expandable: true, priority: "high" },
      uiTab:        "inventory",
    },
  },

  "ranking_engine__RankedEntities": {
    definition: {
      outputId:     "ranking_engine__RankedEntities",
      title:        "Top / Worst Performers",
      artifactType: "RankedEntities",
      layout:       { section: "top", columnSpan: 2, minHeight: 300 },
      behavior:     { scrollable: false, expandable: false, priority: "high" },
      uiTab:        "inventory",
    },
  },

  "entity_registry__EntitySet": {
    definition: {
      outputId:     "entity_registry__EntitySet",
      title:        "Current Inventory",
      artifactType: "EntitySet",
      layout:       { section: "middle", columnSpan: 2, minHeight: 300 },
      behavior:     { scrollable: true, expandable: false, priority: "medium" },
      uiTab:        "inventory",
    },
  },

  "delivery_logger__DeliveryEventLog": {
    definition: {
      outputId:     "delivery_logger__DeliveryEventLog",
      title:        "Recent Deliveries",
      artifactType: "DeliveryEventLog",
      layout:       { section: "bottom", columnSpan: 3, minHeight: 200 },
      behavior:     { scrollable: true, expandable: false, priority: "low" },
      uiTab:        "inventory",
    },
  },

  // ... one entry per outputId
};
```

**Registry 2 — `outputRegistry`** (artifactType → ContentComponent)

Global. Defined once for the entire application. Decouples content rendering from module identity.

```js
// ui/registries/outputRegistry.js
// artifactType → ContentComponent (lazy-loaded)

import { lazy } from "react";

export const outputRegistry = {
  RecommendationSet:    lazy(() => import("../panels/RecommendationSetPanel")),
  RankedEntities:       lazy(() => import("../panels/RankedEntitiesPanel")),
  EntitySet:            lazy(() => import("../panels/EntitySetPanel")),
  SnapshotSet:          lazy(() => import("../panels/SnapshotSetPanel")),
  DeliveryEventLog:     lazy(() => import("../panels/EventLogPanel")),
  SalesEventLog:        lazy(() => import("../panels/EventLogPanel")),
  AlertSet:             lazy(() => import("../panels/AlertSetPanel")),
  AnalysisBatch:        lazy(() => import("../panels/PhotoGridPanel")),
  ProductCatalogDraft:  lazy(() => import("../panels/CatalogListPanel")),
  PerformanceRanking:   lazy(() => import("../panels/RankingTablePanel")),
};
```

**Why two registries:**

| | `outputComponentRegistry` | `outputRegistry` |
|---|---|---|
| Key | `outputId` (module-specific) | `artifactType` (universal) |
| Contains | Layout definition + tab assignment | ContentComponent only |
| Scope | Per workflow pack | Global |
| Changes when | Modules change or new packs added | New artifact types added |
| Read by | `OutputCard` (for layout) | `OutputContent` (for rendering) |

The two are linked by `artifactType`. `outputComponentRegistry` declares `artifactType`; `outputRegistry` uses it as the key. This means: the same `ContentComponent` can be reused across multiple `outputId`s that share the same `artifactType`.

---

#### 18.1.4 Data Flow

Full path from server artifact to rendered component:

```
Step 1  Server completes a module step
        → writes artifact to server/artifactStore.json
        → artifact shape: { runId, moduleId, artifactType, version, data }

Step 2  OutputDashboard fetches or receives artifact store
        → stores as: artifactStore[runId][outputId] = artifact

Step 3  OutputDashboard derives active tabs
        → tabs = unique uiTab values from outputComponentRegistry entries
          whose outputId keys exist in artifactStore[runId]

Step 4  TabContainer renders one TabPage per tab
        → TabPage receives: artifacts filtered to its uiTab

Step 5  TabPage renders three SectionRows
        → SectionRow[top]    receives artifacts where definition.layout.section === "top"
        → SectionRow[middle] receives artifacts where definition.layout.section === "middle"
        → SectionRow[bottom] receives artifacts where definition.layout.section === "bottom"

Step 6  SectionRow passes sorted output list to OutputGrid
        → sorted by: behavior.priority (high → medium → low)

Step 7  OutputGrid renders one OutputCard per output
        → OutputCard props: { outputId, definition, artifact }

Step 8  OutputCard reads definition.layout → sets flex sizing
        → reads definition.behavior → applies scroll / expand

Step 9  OutputCard renders OutputContent
        → OutputContent looks up: ContentComponent = outputRegistry[artifact.artifactType]
        → renders: <ContentComponent artifact={artifact} moduleOptions={...} />

Step 10 ContentComponent renders its domain data
        → receives artifact.data only
        → knows nothing about layout, outputId, or module identity
```

---

#### 18.1.5 State Management

State is divided into three categories with distinct storage and update rules.

**Session state** — current run only, in memory, lost on reload

| State | Owner | Shape |
|-------|-------|-------|
| `currentRunId` | `OutputDashboard` | `string` |
| `artifactStore` | `OutputDashboard` | `{ [outputId]: artifact }` |
| `activeTab` | `TabContainer` | `string` |
| `expandedCards` | Each `OutputCard` | `boolean` |

Managed with `useState` / `useReducer` in `OutputDashboard`. Passed down as props. No context.

**Persisted state** — survives reload, stored server-side

| State | Storage | Updated by |
|-------|---------|------------|
| Previous run records | `server/runs.json` | Orchestrator after each run |
| Artifact data | `server/artifactStore.json` | Module step completion |
| Layout overrides | `server/layoutOverrides.json` | User drag/resize (Phase 7+) |

`OutputDashboard` loads persisted state on mount via `GET /claira/runs/:runId/artifacts`. Polling or server-sent events handle live updates during active runs.

**UI state** — transient layout preferences, no semantic value

| State | Owner | Persisted |
|-------|-------|-----------|
| Expanded / collapsed panels | `OutputCard` (local) | No |
| Active tab | `TabContainer` | Session only (URL hash optional) |
| Scroll position | Browser native | No |

UI state is never stored in the artifact store. It is never used by the module or engine systems.

---

#### 18.1.6 Component Rules

The following rules are non-negotiable. They mirror §17.10 (non-negotiable constraints) at the component level.

| Rule | Detail |
|------|--------|
| **Reusable across domains** | No component may import a domain constant (e.g. `SHOE_SKU_PREFIX`). All domain data comes from `artifact.data`. |
| **No module dependency** | `ContentComponent` panels depend only on `artifactType`, not on the module that produced the artifact. The same `EventLogPanel` renders `DeliveryEventLog` and `SalesEventLog`. |
| **Layout driven by definitions** | No `OutputCard` may hard-code a width, height, or section assignment. All sizing comes from `definition.layout`. |
| **No engine calls from UI** | No component may call `runClaira()` or `/__claira/run`. Triggering a new run is done through a workflow action button in `OutputDashboard`, not from within any panel. |
| **No cross-panel data reads** | `ContentComponent` receives only its own `artifact.data`. It may not read sibling artifacts from the store. |
| **One ContentComponent per artifactType** | `outputRegistry` must have exactly one component per type. If two artifact types need the same UI, they share a component but retain separate registry entries. |
| **FallbackPanel for unknown types** | If `outputRegistry[artifactType]` is undefined, `OutputContent` renders `<FallbackPanel>` showing the raw artifact as JSON. This prevents hard failures when new artifact types are produced before their panel exists. |

---

#### 18.1.7 Alignment with existing architecture

| Check | Result |
|-------|--------|
| §17 component definition schema | ✅ All fields (`outputId`, `layout`, `behavior`, `uiTab`) map directly to component props |
| §4 artifact system | ✅ `ContentComponent` receives `artifact.data` only; store coupling is isolated to `OutputDashboard` |
| §2 engine-first rules | ✅ No component makes engine calls; engine calls are in modules only |
| §16 module granularity | ✅ One `ContentComponent` per `artifactType`; no panels that combine multiple artifact types |
| Existing standalone tools | ✅ `OutputDashboard` is a new screen; `WorkflowScreen`, `CatalogBuilderScreen`, `PhotoSorterScreen` are untouched |
| Risk | Low — entirely additive; no existing component is modified |

**Phase:** Implement in **Phase 6** after Phase 5 (artifact store) is complete.

---

## §19 — Step-Based Versioned Artifacts

### 19.1 Pattern Name

**Step-Based Versioned Artifacts**

This is a core system capability unlocked by the step identity system (Phase 6 upgrade). It must be treated as a first-class architectural pattern and referenced explicitly in all documentation that touches the artifact store, module orchestration, and the UI output system.

---

### 19.2 What It Is

The artifact store retains ALL artifacts produced during a workflow run, including multiple artifacts of the same type produced by different execution steps.

Each artifact is identified by:

| Field | Description |
|---|---|
| `artifactType` | Semantic type token (`"AnalysisBatch"`, `"EntitySet"`, etc.) |
| `producedByStepId` | The unique step that produced it (e.g. `"photo_analysis__2"`) |
| `stepIndex` | Numeric position of the producing step in the workflow |
| `artifactId` | UUID for the specific artifact record |

When the same module runs twice in a workflow — or two different modules produce the same artifact type — the store contains multiple versions. This is not an error. It is the intended behavior.

---

### 19.3 Example

**Workflow:** `[photo_analysis, filter_photos, photo_analysis]`

| Step | stepId | Produces | Notes |
|---|---|---|---|
| 0 | `photo_analysis__0` | `AnalysisBatch` (v1) | Initial scan — all photos |
| 1 | `filter_photos__1` | `FilteredSet` | Subset selected by user criteria |
| 2 | `photo_analysis__2` | `AnalysisBatch` (v2) | Re-analysis of filtered set |

After execution, the store contains **two** `AnalysisBatch` artifacts:

```
readArtifactsByType(sid, rid, "AnalysisBatch")
→ [
    { producedByStepId: "photo_analysis__0", stepIndex: 0, data: { ... full batch ... } },
    { producedByStepId: "photo_analysis__2", stepIndex: 2, data: { ... filtered batch ... } },
  ]
```

---

### 19.4 Execution Rule

**Modules always consume the most recent artifact of a required type.**

- The most recent artifact is the LAST element in the array returned by `readArtifactsByType`.
- This is guaranteed by append-only write order in the store.
- No sorting is required: artifacts are always written in execution order.

In module `buildPayload`:

```javascript
// ✅ Correct — use most recent
const batch = consumedArtifacts["AnalysisBatch"].at(-1);

// ❌ Wrong — this is the oldest version
const batch = consumedArtifacts["AnalysisBatch"][0];

// ❌ Wrong — do not pass all versions to the engine
const allBatches = consumedArtifacts["AnalysisBatch"];
```

This rule is enforced by convention (documented in `moduleOrchestrator.js`) and does not require schema enforcement.

---

### 19.5 Store Contract

| Rule | Detail |
|---|---|
| **Always append** | Artifacts are never overwritten or deleted |
| **Write order = execution order** | The last artifact in the array is always the most recently produced |
| **All versions retained** | Earlier artifacts are available for UI comparison and the Comparative Analysis Engine |
| **No automatic pruning** | The store does not discard old versions during a run |

---

### 19.6 Why This Matters

Step-Based Versioned Artifacts enable:

| Capability | How |
|---|---|
| **Historical comparison** | Both artifact versions remain accessible |
| **Before/after analysis** | Artifact at step 0 vs. artifact at step 2 tells the full story |
| **Multi-scenario evaluation** | Run the same module with different inputs, compare outputs |
| **Optimization workflows** | Identify which configuration produced the better result |
| **Non-destructive re-runs** | Re-running a step does not erase the previous result |

This pattern is the direct prerequisite for the Comparative Analysis Engine (§21).

---

### 19.7 Implementation Locations

| Location | Role |
|---|---|
| `workflow/pipeline/runtimeArtifactStore.js` | Append-only write, all-versions read, step lineage fields on every artifact |
| `workflow/execution/moduleOrchestrator.js` | Consumption rule documented; passes `producedByStepId` + `stepIndex` to `buildArtifact` |
| `workflow/execution/workflowOrdering.js` | `expandToSteps` assigns `stepId` / `stepIndex` to each step before execution |
| UI output system (§20) | Surfaces multiple versions; shows latest as primary, provides comparison access |

---

## §20 — UI Handling for Multiple Artifacts

### 20.1 Scope

This section defines how the UI output system handles the presence of multiple artifacts of the same type within a single workflow run. It does not describe the full comparison UI (that is §21 / Comparative Analysis Engine).

---

### 20.2 Execution Behavior (Unchanged)

The execution system is unaffected by multiple artifacts:

- Modules always consume the most recent artifact (`consumedArtifacts["Type"].at(-1)`).
- No user prompt is shown during execution.
- No ambiguity exists. The rule is deterministic.

This section governs only the **display layer**.

---

### 20.3 Default Behavior — Option A (Required)

**The UI always shows the most recent artifact as the primary result.**

When a single artifact of a type exists, the output panel renders it normally.

When multiple artifacts of the same type exist, the output panel:

1. **Renders the most recent artifact** as the primary result (same layout as single-artifact case).
2. **Shows a secondary indicator** — a badge, icon, or dropdown — communicating that earlier versions exist.

The secondary indicator must:

- Be non-intrusive (does not replace or overlay the primary result).
- Reveal previous results on interaction (click or expand).
- Label each version by its `stepId` and `stepIndex` (e.g. `"photo_analysis__0"`, `"photo_analysis__2"`).
- Show at minimum: the artifact's `createdAt` timestamp and `stepIndex`.
- Optionally show a structural diff or summary of the change.

Example UI states:

```
[ Primary: AnalysisBatch from photo_analysis__2 ]     ← always shown

  ⚠ 1 earlier version exists  [Compare ▾]             ← secondary indicator
    └── photo_analysis__0  (step 0, 14:03:22)
        [View]  [Diff with current]
```

---

### 20.4 Comparison View — Option B (Future)

**Side-by-side dual comparison view.** Not required in the current build.

When implemented:

- Panel 1: artifact from step `A__0`
- Panel 2: artifact from step `A__2`
- Output strip below: structural diff, delta metrics, impact summary

This is a distinct UI mode, not a modification of the primary output panel.

---

### 20.5 User-Controlled Artifact Selection — Option C (Advanced / Future)

**User selects which artifact version feeds downstream execution.** Not required now.

When implemented:

- A "Use this version" control appears next to each older artifact.
- Selecting it pins that artifact as the "active" version for the current session.
- The next module step consumes the pinned version instead of the most recent.

This requires changes to the orchestrator's consumption rule and is deferred.

---

### 20.6 Implementation Notes

| Concern | Decision |
|---|---|
| When to show indicator | `readArtifactsByType(...).length > 1` |
| Which artifact to render | Always `artifacts.at(-1)` (most recent by write order) |
| Label format | `${producedByStepId}` + `step ${stepIndex}` + `createdAt` |
| Diff engine | Out of scope for current build; deferred to §21 |
| Option C (pinning) | DO NOT implement. Changes execution behavior. Deferred. |

---

## §21 — Comparative Analysis Engine (Claira Insights)

### 21.1 Overview

The Comparative Analysis Engine is a planned extension of the artifact system that enables structured comparison of multiple versions of the same artifact produced across execution steps.

**Status:** Defined. Not implemented. Implementation begins after the core execution system (Phases 1–8) and the UI foundation (Phase 9) are complete.

**Prerequisite:** Step-Based Versioned Artifacts (§19) — already implemented.

---

### 21.2 Purpose

Claira's module execution system can produce multiple versions of the same artifact type within a single workflow run. The Comparative Analysis Engine transforms these versions into actionable insight:

- Which configuration, input set, or filter produced a better output?
- What changed between step A__0 and step A__2?
- Which variables are responsible for the difference?
- What should be done next to optimize the result?

---

### 21.3 Core Inputs

| Input | Source |
|---|---|
| Two or more `RuntimeArtifact` records of the same `artifactType` | `runtimeArtifactStore.readArtifactsByType()` |
| `stepId` and `stepIndex` for each artifact | Stamped by `moduleOrchestrator` on every artifact |
| `workflowRunId` + `sessionId` | Workflow run context |

The engine does not require the original module definitions or engine payloads — only the produced artifacts.

---

### 21.4 Core Outputs

| Output Artifact | Description |
|---|---|
| `ComparisonReport` | Structural diff of two artifact `data` payloads |
| `InsightSummary` | Human-readable explanation of what changed and why it matters |
| `OptimizationRecommendations` | Ranked list of follow-up actions derived from the comparison |

---

### 21.5 Example Use Cases

| Scenario | Artifact Type | What Is Compared |
|---|---|---|
| Photo analysis before/after filtering | `AnalysisBatch` | Full photo set vs. filtered subset |
| Employee performance tracking | `EntitySet` | Jim's output at week 1 vs. week 4 |
| Product catalog optimization | `CatalogBatch` | Catalog with original tags vs. revised tags |
| Sales scenario modeling | `RevenueProjection` | Conservative vs. aggressive pricing |
| Behavior vs. outcome | `EventLog` + `OutcomeSet` | Actions taken vs. results observed |

The shoe store example (§15) is a direct candidate: running `entity_registry` twice (once with broad categories, once with refined categories) produces two `EntitySet` artifacts whose comparison tells the operator exactly which category structure drove more revenue.

---

### 21.6 Architecture

The Comparative Analysis Engine is itself a set of Claira modules (plan.md §16) that follow the engine-aware module contract:

```
compare_artifacts (module)
  engineKinds: ["artifact.diff"]
  consumes:    ["AnalysisBatch"]          ← reads both versions from store
  produces:    [{ kind: "analysis", mode: "create" }]

insight_generator (module)
  engineKinds: ["insight.generate"]
  consumes:    ["analysis"]
  produces:    [{ kind: "deliverable", mode: "create" }]
```

The `artifact.diff` engine kind receives two artifact payloads and produces a structured diff. The `insight.generate` kind receives the diff and produces a natural-language summary.

Both engine kinds will require new `CLAIRA_RUN_HANDLERS` entries (capability gap — added to §15.7 when implemented).

---

### 21.7 Integration With Existing Architecture

| Concern | Resolution |
|---|---|
| Artifact store access | Uses `readArtifactsByType(...).filter(a => ...)` to select versions by `stepId` or `stepIndex` |
| Module contract | All comparison modules follow `assertEngineContract` |
| Execution | Uses `executeWorkflow` + `orderModules` / `orderSteps` unchanged |
| UI surface | `ComparisonReport` artifact maps to a `ComparisonReportPanel` in `outputRegistry` |
| No special execution path | Comparison is a normal workflow run, not a special code path |

---

### 21.8 Implementation Plan (Deferred)

**Phase:** After Phase 9 (UI Foundation).

**Minimum viable implementation:**

1. Add `artifact.diff` handler to `CLAIRA_RUN_HANDLERS`.
2. Create `compare_artifacts` module following engine-aware contract.
3. Register `ComparisonReport` artifact type in `artifactKindRegistry`.
4. Add `ComparisonReportPanel` to `outputRegistry`.
5. Wire comparison trigger into UI (§20 secondary indicator → "Diff with current").

---

### §18.2 Visual Wireframe System

**Purpose:** Provide a structural visual reference for the layout system defined in §17. This is not a design mock. It is an annotated spatial diagram aligned to the module output system. Use it to validate layout decisions and guide Phase 6 frontend development.

---

#### 18.2.1 Quick-Reference Layout Map

Compact view of section → output placement (Shoe Store, Inventory tab):

```
┌─────────────────────────────────────────────────────────────────┐
│  TABS:  [ Inventory* ]   [ Finance ]   [ Media ]                │
├─────────────────────────────────────────────────────────────────┤
│  TOP SECTION                                                     │
│  [ Reorder Suggestions ·············· RecommendationSet · 3col ]│
│  [ Top/Worst Performers · 2col ]  [ Stock Alerts · 1col ]       │
├─────────────────────────────────────────────────────────────────┤
│  MIDDLE SECTION                                                  │
│  [ Current Inventory · 2col ]  [ Stock Levels · 2col ]          │
├─────────────────────────────────────────────────────────────────┤
│  BOTTOM SECTION                                                  │
│  [ Recent Deliveries · 3col · scroll ····················· ]    │
│  [ Recent Sales ······ 3col · scroll ····················· ]    │
└─────────────────────────────────────────────────────────────────┘
```

---

#### 18.2.2 Full Annotated Wireframe — Inventory Tab

```text
╔═══════════════════════════════════════════════════════════════════════╗
║  [ Inventory* ]  [ Finance ]  [ Media ]         ← TabContainer       ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║  ── TOP ──────────────────────────────────────────────────────────── ║
║     SectionRow[top] · padding: 16px · gap: 16px                      ║
║                                                                       ║
║     ┌──────────────────────────────────────────────────────────────┐ ║
║     │ Reorder Suggestions            priority:HIGH  span:3  h:400  │ ║
║     │ outputId: recommendation_generator__RecommendationSet        │ ║
║     │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │ ║
║     │  • Air Max 90     — reorder 24 units    urgency: HIGH        │ ║
║     │  • Classic Slip-On — reorder 12 units   urgency: MEDIUM      │ ║
║     │  • Running Pro    — monitor             urgency: LOW         │ ║
║     └──────────────────────────────────────────────────────────────┘ ║
║                                                                       ║
║     ┌──────────────────────────────┐  ┌───────────────────────────┐  ║
║     │ Top/Worst Performers         │  │ Stock Alerts               │  ║
║     │ ranking_engine__RankedEntities  │ threshold_evaluator__AlertSet │
║     │ priority:HIGH  span:2  h:300 │  │ priority:HIGH  span:1  h:200│ ║
║     │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  ║
║     │ 1. Air Max 90    ████  94   │  │ ⚠ Air Max 90               │  ║
║     │ 2. Classic Slip  ███   76   │  │   stock: 2  (min: 10)      │  ║
║     │ 3. Running Pro   █     24   │  │ ⚠ Classic Slip-On          │  ║
║     └──────────────────────────────┘  └───────────────────────────┘  ║
║                                                                       ║
║  ── MIDDLE ────────────────────────────────────────────────────────── ║
║     SectionRow[middle] · padding: 16px · gap: 16px                   ║
║                                                                       ║
║     ┌──────────────────────────────┐  ┌───────────────────────────┐  ║
║     │ Current Inventory            │  │ Stock Levels               │  ║
║     │ entity_registry__EntitySet   │  │ inventory_snapshot_        │  ║
║     │ priority:MED  span:2  h:300  │  │ logger__SnapshotSet        │  ║
║     │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │ priority:MED  span:2  h:300│  ║
║     │ Air Max 90      SKU-001      │  │ SKU-001   qty: 2           │  ║
║     │ Classic Slip-On SKU-002      │  │ SKU-002   qty: 8           │  ║
║     │ Running Pro     SKU-003      │  │ SKU-003   qty: 31          │  ║
║     │ Leather Boot    SKU-004      │  │ SKU-004   qty: 14          │  ║
║     └──────────────────────────────┘  └───────────────────────────┘  ║
║                                                                       ║
║  ── BOTTOM ────────────────────────────────────────────────────────── ║
║     SectionRow[bottom] · padding: 16px · gap: 16px                   ║
║                                                                       ║
║     ┌──────────────────────────────────────────────────────────────┐ ║
║     │ Recent Deliveries      priority:LOW  span:3  scrollable      │ ║
║     │ outputId: delivery_logger__DeliveryEventLog                  │ ║
║     │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │ ║
║     │  2026-04-18  SKU-001  +48 units  delivery                    │ ║
║     │  2026-04-10  SKU-003  +12 units  delivery                    │ ║
║     └──────────────────────────────────────────────────────────────┘ ║
║     ┌──────────────────────────────────────────────────────────────┐ ║
║     │ Recent Sales           priority:LOW  span:3  scrollable      │ ║
║     │ outputId: sales_logger__SalesEventLog                        │ ║
║     │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │ ║
║     │  2026-04-21  SKU-001  -1 unit   sale                         │ ║
║     │  2026-04-20  SKU-001  -1 unit   sale                         │ ║
║     │  2026-04-19  SKU-002  -2 units  sale                         │ ║
║     └──────────────────────────────────────────────────────────────┘ ║
╚═══════════════════════════════════════════════════════════════════════╝
```

---

#### 18.2.3 Multi-Tab Wireframes

**Finance tab active:**

```
┌─────────────────────────────────────────────────────────────────┐
│  TABS:  [ Inventory ]   [ Finance* ]   [ Media ]                │
├─────────────────────────────────────────────────────────────────┤
│  TOP SECTION                                                     │
│  [ Receipt Summary ·················· ReceiptSummary · 3col ]   │
├─────────────────────────────────────────────────────────────────┤
│  MIDDLE SECTION                                                  │
│  (no outputs assigned to this section for Finance tab)          │
├─────────────────────────────────────────────────────────────────┤
│  BOTTOM SECTION                                                  │
│  [ All Receipts ·············· ReceiptLog · 3col · scroll ]     │
└─────────────────────────────────────────────────────────────────┘
```

**Media tab active:**

```
┌─────────────────────────────────────────────────────────────────┐
│  TABS:  [ Inventory ]   [ Finance ]   [ Media* ]                │
├─────────────────────────────────────────────────────────────────┤
│  TOP SECTION                                                     │
│  [ Top Ranked Photos · 2col ]  [ Media Reorder Recs · 1col ]   │
├─────────────────────────────────────────────────────────────────┤
│  MIDDLE SECTION                                                  │
│  [ Photo Analysis Results ········· AnalysisBatch · 3col ]      │
│  [ Product Catalog Draft ·········· CatalogDraft · 3col ]       │
├─────────────────────────────────────────────────────────────────┤
│  BOTTOM SECTION                                                  │
│  (no log outputs for Media tab in this workflow)                │
└─────────────────────────────────────────────────────────────────┘
```

---

#### 18.2.4 Responsive Layout Behavior

Three breakpoints govern `OutputGrid` column behavior. The `columnSpan` system maps to `flex-basis` values:

| Breakpoint | Viewport | Column behavior |
|---|---|---|
| Desktop | ≥ 1024px | `span:1 = 33%`, `span:2 = 66%`, `span:3 = 100%` |
| Tablet | 768px – 1023px | `span:1 = 50%`, `span:2 = 100%`, `span:3 = 100%` |
| Mobile | < 768px | All spans collapse to `100%` (single column stacked) |

**Desktop (≥ 1024px) — multi-column:**

```
[ Top Performers · 66% ················ ]  [ Alerts · 33% ]
[ Inventory · 66% ················· ]  [ Stock · 66% ··· ]
```

**Tablet (768px – 1023px) — reduced columns:**

```
[ Top Performers · 100% ····················· ]
[ Alerts · 50% ····· ]  [ (wraps) ·········· ]
[ Inventory · 100% ·························· ]
[ Stock · 100% ······························ ]
```

**Mobile (< 768px) — single column stacked:**

```
[ Reorder Suggestions ··· ]
[ Top Performers ········· ]
[ Alerts ················· ]
[ Current Inventory ······ ]
[ Stock Levels ··········· ]
[ Recent Deliveries ······ ]
[ Recent Sales ··········· ]
```

Stacking order on mobile preserves section order (top → middle → bottom) and priority order within each section.

---

#### 18.2.5 Spacing and Sizing Reference

```text
┌───────────────────────────────────────────────────────────────┐
│ SectionRow                                                    │
│ padding: 16px all sides                                       │
│                                                               │
│  ┌─────────────────────┐  gap:16px  ┌──────────────────────┐ │
│  │ OutputCard          │            │ OutputCard            │ │
│  │ padding:  16px      │            │ padding:  16px        │ │
│  │ minHeight: 200–400px│            │ minHeight: 200–400px  │ │
│  │ border-radius: 8px  │            │ border-radius: 8px    │ │
│  │                     │            │                       │ │
│  │ OutputHeader        │            │ OutputHeader          │ │
│  │ ── 40px ───────── ─ │            │ ── 40px ────────────  │ │
│  │                     │            │                       │ │
│  │ OutputContent       │            │ OutputContent         │ │
│  │ (fills remaining)   │            │ (fills remaining)     │ │
│  └─────────────────────┘            └──────────────────────┘ │
│                                                               │
│  gap:16px (between rows)                                      │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ OutputCard (span:3 — full row width)                      │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

| Property | Value |
|----------|-------|
| SectionRow padding | 16px |
| OutputGrid gap | 16px (row and column) |
| OutputCard padding | 16px |
| OutputCard border-radius | 8px |
| OutputHeader height | 40px |
| minHeight (small panels) | 200px |
| minHeight (medium panels) | 300px |
| minHeight (large panels) | 400px |
| scrollable overflow | `overflow-y: auto` when content exceeds minHeight |

---

#### 18.2.6 No-Overlap Guarantee

All panels are in document flow. No `position: absolute` or `z-index` stacking is used for layout. Overlap cannot occur because:

1. `OutputGrid` uses `display: flex; flex-wrap: wrap` — items flow naturally
2. `columnSpan` values within one `SectionRow` are validated to sum ≤ 3 per visual row
3. Sections are stacked vertically in document order (top → middle → bottom) with no overlap region

If a future layout override produces invalid spans (e.g., two `span:2` cards in the same row), the `OutputGrid` automatically wraps the second card to the next row via `flex-wrap`.

---

#### 18.2.7 Alignment with existing architecture

| Check | Result |
|-------|--------|
| §17 layout rules (no overlap, no absolute positioning) | ✅ All panels in document flow; flex-wrap handles all overflow |
| §17 section mapping | ✅ All artifact types placed in canonical sections per §17.5 |
| §17 tab system | ✅ Each tab has independent 3-section layout; no cross-tab panel sharing |
| §17 dimension rules | ✅ HIGH → span:3 first, then span:2+1; tabular → span:2; logs → span:3 scrollable |
| §16 module granularity | ✅ Each panel maps to exactly one `outputId` |
| Existing UI | ✅ New `OutputDashboard` screen only; `WorkflowScreen`, `CatalogBuilderScreen`, `PhotoSorterScreen` untouched |
| Risk | None — wireframe is a planning artifact; no code changes |

**Phase:** Use as design reference now. Implement in **Phase 6** alongside §18.1 component architecture.

---

### §18.3 Combined Recommendation

| Sub-section | Conflicts | When to act |
|---|---|---|
| **§18.1 React Component Architecture** | None — fully aligned with §§4, 16, 17 | Phase 6 after Phase 5 artifact store |
| **§18.2 Visual Wireframe System** | None — planning artifact only | Available as design reference now |

Both sub-sections are architecturally consistent with the entire plan. Neither requires changes to §§1–17, the engine, the module system, or any existing standalone tool or screen. Both are implementation inputs for Phase 6, not current work items.

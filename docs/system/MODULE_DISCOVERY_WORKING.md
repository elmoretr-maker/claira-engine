# Module discovery — working reference

**Purpose:** Structural foundation for intent detection, module mapping, and guided clarification.  
**Not:** A feature spec for unbuilt modules; **future** modules are named here for planning only.  
**Executable rules:** `workflow/contracts/workflowRules.js`, `workflow/validation/workflowTemplateContract.js`, `docs/system/WORKFLOW_SYSTEM_ALIGNMENT.md`.

---

## Section 1 — Core system understanding

### Two entry paths (never mix)

| Path | Examples | `workflowSource` | Workflow behavior |
|------|-----------|------------------|-------------------|
| **Prebuilt** | `ecommerce`, `game-dev`, `medical` | `"prebuilt"` | Fixed in-repo flows. **No** modular workflow composition path. |
| **Generated** | Packs from **Create Your Category** | `"generated"` | **Only** path for composable `workflow_template.json` and modular workflow UI. |

Guards in code (e.g. `readPackWorkflowSource`, workflow hub, `WorkflowScreen`) enforce separation.

### Non-negotiable principles

1. **No fallbacks** — No guessing final modules, no default “full system,” no silent repair of invalid selection.
2. **No silent defaults** — Anything that changes pack shape or modules is visible and user-confirmed.
3. **Deterministic only** — Rules, lists, ordering; no LLM for **final** module membership.
4. **User-controlled system** — Propose → user selects → confirm → build.
5. **No system mixing** — Prebuilt ≠ generated; never blur entry paths.

### Guided resolution (not fallback)

Valid but **underspecified** input (e.g. “I want a fitness tracker”) must **not** fail and must **not** auto-fill a full module set. The system **asks** structured, module-mapped questions until intent is resolvable. That is **guided resolution**, not a fallback.

---

## Section 2 — Final product flow (target)

```text
input
 → detection
  → IF incomplete / ambiguous / partial coverage → clarification
  → reporting
  → suggestion (domain / preset hints)
  → user selection
  → confirmation
  → build
```

No user-facing step should be skipped: **clarification** runs only when needed; **confirmation** always precedes build.

**Implementation note:** The analyzer should eventually treat **partial** and **ambiguous** signals as clarification triggers (see §7). Today, verify `analyzeModuleCompositionForBuild.js` against this section when tightening behavior.

---

## Section 3 — Use cases (20) — organized

Each row: scenario → what users care about → **current core modules** that typically apply (not auto-selected).

| # | Use case | User intent (needs) | Typical core modules* |
|---|----------|---------------------|------------------------|
| 1 | Fitness coaching | Clients + progress photos + history | entity_tracking, event_log, asset_registry |
| 2 | Personal fitness | Self + workouts/goals over time | entity_tracking, event_log |
| 3 | Medical | Patients + visits + records | entity_tracking, event_log, asset_registry |
| 4 | Therapy | Clients + sessions + notes | entity_tracking, event_log, asset_registry |
| 5 | Ecommerce | Customers + orders + assets | entity_tracking, event_log, asset_registry |
| 6 | Customer support | Issues + activity trail | entity_tracking, event_log |
| 7 | Real estate | Properties + clients + files | entity_tracking, event_log, asset_registry |
| 8 | Project management | Work items + activity | entity_tracking, event_log |
| 9 | Inventory | Stock + movements | entity_tracking, event_log |
| 10 | Content creation | Uploads + versions | entity_tracking, asset_registry, event_log |
| 11 | Social media | Accounts + activity | entity_tracking, event_log |
| 12 | Education | Students + activity | entity_tracking, event_log, asset_registry |
| 13 | Event planning | Events + logistics | entity_tracking, event_log |
| 14 | HR | Employees + records | entity_tracking, event_log, asset_registry |
| 15 | Finance | Accounts + ledger-like activity | entity_tracking, event_log, asset_registry |
| 16 | Logistics | Deliveries + status trail | entity_tracking, event_log |
| 17 | Habit tracking | Routines + history | entity_tracking, event_log |
| 18 | Equipment | Assets + maintenance history | entity_tracking, event_log, asset_registry |
| 19 | Sales | Leads + touch history | entity_tracking, event_log |
| 20 | Property management | Tenants + docs + history | entity_tracking, event_log, asset_registry |

\*Typical = design hint only. **User always confirms** the final set.

**Future modules** (not in registry today): task_management, metrics_tracking, status_tracking, notes_module, relationship_mapping would refine rows 8–20 further when implemented.

---

## Section 4 — Capabilities (refined, deduped)

Single list covering the 20 use cases without redundant phrasing:

| Capability | Covers |
|------------|--------|
| Track entities (people, accounts, “things” with identity) | Most use cases |
| Log events and activity over time | Progress, history, sessions, visits |
| Store and retrieve files (images, documents) | Photos, scans, uploads |
| Track tasks or work items | PM, ops (future: task_management) |
| Track metrics / KPIs | Fitness goals, sales (future: metrics_tracking) |
| Track status / stage | Pipeline, inventory state (future: status_tracking) |
| Capture notes / narrative | Therapy, support (future: notes_module; today often event_log + asset) |
| Track relationships between entities | CRM-like (future: relationship_mapping) |

---

## Section 5 — Modules

### Core (implemented in contract + registry today)

#### `entity_tracking`

- **Purpose:** Primary “things with identity” the workflow is about (people, clients, patients, products-as-records, etc.).
- **What it does:** CRUD-ish UX and storage hooks for those entities; other modules often hang off an `entityId`.
- **When used:** Almost whenever the user is tracking **who** or **which record** something belongs to.

#### `event_log`

- **Purpose:** Append-only (conceptually) activity stream: what happened, when.
- **What it does:** Timeline of events tied to entities (sessions, uploads ingested, milestones).
- **When used:** Progress, history, audits, “what changed,” sessions.

#### `asset_registry`

- **Purpose:** Binary/file artifacts linked to entities (or global to pack, per product rules).
- **What it does:** Stores metadata and pipeline outputs for files/images.
- **When used:** Photos, PDFs, scans, uploads.

**Structural rule (validation, not injection):** If `asset_registry` or `event_log` is selected, **`entity_tracking` must also be selected** — user must add it or remove the dependents. See `validateWorkflowModuleSelection` in `workflow/contracts/workflowRules.js`.

### Future (not registered — planning only)

| Module | Purpose (summary) |
|--------|---------------------|
| `task_management` | Assignable work items, deadlines, ownership |
| `metrics_tracking` | Numeric KPIs, measurements over time |
| `status_tracking` | Phases, stages, workflow state fields |
| `notes_module` | Freeform notes/comments distinct from event types |
| `relationship_mapping` | Edges between entities (reports-to, owns, linked-to) |

Until registered in `workflowTemplateContract.js` + `moduleRegistry`, these **must not** appear in generated `workflow_template.json`.

---

## Section 6 — Keywords (refined starter set)

Scoped **per module**. Matching in product code is deterministic (e.g. substring on normalized text). Expand lists in `workflow/moduleMapping/moduleKeywordMap.js` when aligning with this doc.

### `entity_tracking`

client, customer, user, member, patient, student, tenant, employee, lead, contact, people, person, account, case, participant, athlete, resident, buyer, seller, vendor

### `event_log`

progress, history, timeline, activity, log, session, journal, visit, milestone, audit, trail, check-in, follow-up, reminder, change over time

### `asset_registry`

image, photo, picture, upload, file, document, scan, pdf, attachment, media, asset, intake, receipt, record (as file context — avoid overfitting “record” to entity if ambiguous)

### `task_management` (future)

task, todo, assignment, checklist, ticket, backlog, sprint, deliverable

### `metrics_tracking` (future)

metric, kpi, analytics, measurement, stats, performance data, dashboard (use carefully — “dashboard” alone is vague)

### `status_tracking` (future)

status, stage, phase, state, pipeline step

### `notes_module` (future)

note, notes, comment, comments, memo, narrative

### `relationship_mapping` (future)

relationship, linked to, reports to, owns, refers to, connection between

---

## Section 7 — Keyword → module map (authoritative shape)

Display form: **module → keywords** (source for maps in code).

```
entity_tracking  → client, customer, user, member, patient, student, tenant, employee,
 lead, contact, people, person, account, case, participant, athlete,
                   resident, buyer, seller, vendor

event_log        → progress, history, timeline, activity, log, session, journal, visit,
                   milestone, audit, trail, check-in, follow-up, reminder

asset_registry   → image, photo, picture, upload, file, document, scan, pdf, attachment,
                   media, asset, intake, receipt

task_management (future) → task, todo, assignment, checklist, ticket, backlog, sprint, deliverable

metrics_tracking (future) → metric, kpi, analytics, measurement, stats, performance data

status_tracking (future) → status, stage, phase, state, pipeline step

notes_module (future) → note, notes, comment, comments, memo, narrative

relationship_mapping (future) → relationship, linked to, reports to, owns, refers to, connection between
```

---

## Section 8 — System insights

### Most common core modules

- **entity_tracking** — Appears in nearly all 20 use cases (something has identity).
- **event_log** — Very common wherever time-ordered activity matters.
- **asset_registry** — Common when files/images/docs matter; optional for pure “status only” sketches.

### Common combinations (core only)

| Combination | Pattern |
|-------------|---------|
| All three | Coaching, medical, ecommerce, property — people + files + history |
| entity + event | Personal fitness, habits, support — no file emphasis |
| entity + asset + event | Default “rich” operational pack |

### Core vs optional (product meaning)

- **Core trio** are the only **implemented** composition set today.
- Within a pack, **optional** means “user may omit if they confirm a thinner system” — except **validation** forbids asset/event without entity (explicit error, no auto-add).

---

## Section 9 — Clarification logic (critical)

### When to trigger clarification

Trigger guided questions when **any** of:

1. **No modules detected** — No keyword hits **and** no domain/preset suggestions.
2. **Partial module coverage** — Domain or use-case pattern implies a **expected set** (e.g. fitness coaching → commonly entity + event at minimum) but detection only found a subset; user should confirm omissions.
3. **Ambiguous input** — Conflicting signals or ultra-short input that matches multiple domains equally.

**Example (fitness):** Domain expects at least **entity_tracking** (clients/self) and **event_log** (progress over time). If detection yields only **event_log**, clarification should highlight missing **entity_tracking** (ask: “Track people or clients?”) — **ask**, do not inject.

**Non-goals:** Do not “suggest all modules” as a fallback. Do not auto-check boxes.

### Clarification model (copy pattern)

**Title:** Help us understand your system:

**Options (1:1 with core modules in current product):**

- [ ] Track people (clients, users, members, patients) → `entity_tracking`
- [ ] Track activity over time (progress, history, sessions) → `event_log`
- [ ] Store files (images, documents, uploads) → `asset_registry`

Exact strings live in `workflow/contracts/workflowRules.js` (`CLARIFICATION_OPTIONS`).

---

## Section 10 — Validation rules

- **Single source:** `workflow/contracts/workflowRules.js` — `validateWorkflowModuleSelection`, `MODULE_SELECTION_ORDER`, messages.
- **No duplicated** validation strings between UI and API — UI imports the same module where the bundler allows, or mirrors messages only if technically required (prefer one source).
- **No auto-injection** of modules to satisfy the contract — only **errors** that tell the user what to add or remove.

---

## Section 11 — Preset rules

- Presets are **suggestions only** (extra reasons / layout hints).
- **Never** auto-select modules; **never** override `selectedModules` at build.
- **Invalid preset** files → **system configuration error**, visible in preview (`ok: false` + message). **Never** silently ignore.

---

## Section 12 — Label rule

- **Labels** (entity singular/plural, section titles) are **presentation only**, derived **after** module selection in composition (`composeWorkflowFromUserSelection`).
- **Must not** influence which modules are detected or selected.

---

## Section 13 — AI / implementer behavior

If a change request would:

- introduce **fallback** logic,
- **hide** behavior from the user,
- bypass **user selection** or **confirmation**,
- **mix** prebuilt and generated paths,

then:

1. **STOP**
2. **Explain** the conflict with this file and `WORKFLOW_SYSTEM_ALIGNMENT.md`
3. **PROPOSE** an aligned alternative

Do **not** blindly implement.

---

## Section 14 — Final rule

If the system does not understand input:

→ **It must ASK** (guided clarification).

It must **never**:

→ guess final modules  
→ fallback to a default pack  
→ degrade silently  
→ silently fix validation failures  

---

*This document is a working reference; the alignment contract remains `WORKFLOW_SYSTEM_ALIGNMENT.md`. Update both deliberately when behavior changes.*

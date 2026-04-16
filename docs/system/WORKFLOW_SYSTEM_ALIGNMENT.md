# Workflow system alignment

**Status:** Source of truth for how the workflow-related product behaves and how it may evolve.  
**Audience:** Humans and implementers (including AI assistants).  
**Scope:** Industry packs, modular workflows, Create Your Category, and entry-path rules.

---

## Section 1 — System overview

### Prebuilt categories vs generated categories

The product has **two entry paths** that **must not mix**:

| Path | Examples | Workflow model |
|------|----------|----------------|
| **Prebuilt categories** | `ecommerce`, `game-dev`, `medical` | Fixed pack UX and flows defined in-repo. **`workflowSource: "prebuilt"`** in `reference.json`. They **do not** use the modular workflow composition path for the trainer-style workflow UI. |
| **Generated categories** | Packs created via **Create Your Category** | **`workflowSource: "generated"`**. Workflow is defined by **`workflow_template.json`** built from **user-confirmed modules** only. |

Runtime guards (e.g. `readPackWorkflowSource`, workflow hub listing, `WorkflowScreen`) enforce that **modular workflow UIs** are only for **`workflowSource === "generated"`** packs with a valid strict template.

### Create Your Category flow

**Create Your Category** is the **only** product entry for:

- Autonomous industry pack generation (research → categories → pack files).
- **Composable** `workflow_template.json` tied to that pack.

The flow is **not** “type a name and we silently build a workflow.” It is:

1. User provides **industry name** and optional **build intent** text.
2. User runs **module preview** (deterministic analysis).
3. User **selects** modules (can differ from detected/suggested).
4. User **confirms** explicitly.
5. **Then** the long-running build runs and writes **`workflow_template.json`** using **exactly** the selected module set (subject to structural validation).

### Module-based workflow composition

A **workflow** here is an ordered, contract-valid set of **registered modules** (e.g. `entity_tracking`, `asset_registry`, `event_log`) plus **`moduleOptions`** that satisfy **`workflowTemplateContract`**.

Composition is **keyword + domain + optional presets → proposal**; **final membership** is **always user-chosen** before build.

---

## Section 2 — Core principles

### 1. No fallbacks

**Means:** If required data or a valid path is missing, the system **fails visibly** (error message, blocked screen, or API error)—it does not substitute a hidden default and continue as if nothing went wrong.

**Violates:** Swallowing errors, substituting “best guess” packs/templates, skipping validation, or continuing with empty modules when the contract requires a non-empty set.

### 2. No silent defaults

**Means:** Anything that changes user-visible behavior or stored pack shape must be **obvious** in the UI or in explicit API inputs (e.g. `selectedModules`). Defaults may exist only for **presentation** (copy, label derivation) where the user has already chosen the module set.

**Violates:** Auto-checking modules, auto-writing templates without a confirmation step, or changing `workflow_template.json` outside the documented build path.

### 3. Deterministic behavior only

**Means:** Preview and detection use **explicit rules**: substring keyword lists, ordered domain tables, preset match rules, stable ordering of modules in the saved template. Same inputs → same preview output.

**Violates:** LLM-based routing for module selection, random ordering, or non-reproducible “smart” inference for **final** module membership.

### 4. User-confirmed system construction

**Means:** The **final** module list is whatever the user confirms **after** seeing detected vs suggested signals. The backend **must** receive **`selectedModules`** (or equivalent explicit list) for generated packs; it does not infer final modules from text alone at build time.

**Violates:** Building from `industryName` / `buildIntent` alone without a confirmed list, or overwriting user selection after confirmation.

### 5. No mixing of system entry paths

**Means:** Prebuilt packs stay on prebuilt rails. Generated packs use generated rails. APIs and UI gates must not expose modular workflow composition as if it were the prebuilt path, or vice versa.

**Violates:** `workflow_template.json` on a prebuilt pack without an explicit product decision to change its classification; bypassing `workflowSource` checks; loading generated workflow UI against a prebuilt pack.

---

## Section 3 — Workflow creation model

End-to-end model for **generated** packs:

```text
input → detection → reporting → selection → confirmation → build
```

| Stage | Responsibility |
|--------|----------------|
| **Input** | `industryName` + optional `buildIntent`. |
| **Detection** | Keyword hits → **detected** modules; domains / presets → **suggested** rows (reasons). If there are **no** keyword hits and **no** domain/preset suggestions, the flow enters **clarification** (structured questions mapped 1:1 to modules)—**no** generic “suggest all modules” fallback. |
| **Reporting** | UI shows what was detected vs suggested, with short module descriptions (`modulesMeta`). |
| **Selection** | User toggles modules. **No** automatic final set. |
| **Confirmation** | Explicit “build with this set” step. |
| **Build** | Pipeline runs; **`workflow_template.json`** is generated from **`composeWorkflowFromUserSelection(selectedModules)`** only. |

Clarifications:

- **System proposes** (detected + suggested + copy).
- **User decides** (checkboxes + optional adjustments).
- **System builds** (only after confirmation, using the exact selected list, then strict contract validation on disk).

---

## Section 4 — Module system

### Keyword → module mapping

Each registered module has its own **keyword list** (`MODULE_KEYWORD_MAP`). Matching is **deterministic** (e.g. substring on normalized text). Hits contribute to **detected** modules (high-confidence signal for pre-checking in the UI).

### Domain → module suggestions

**Domain hints** (`DOMAIN_MODULE_HINTS`) map domain phrases to **suggested** modules with human-readable **reasons**. Domains **do not** auto-enable modules; they only populate **suggestion** rows and intro copy.

### Presets as optional accelerators

JSON presets under `workflow/presets/` can match the normalized text with **explicit** keyword rules. When matched, they add **suggested** modules (and optional copy)—they **do not** override the user’s final selection and **do not** run at build time to replace `selectedModules`. Invalid preset files **fail the preview** with a visible **system configuration error** (not silently ignored).

### Injection rule

- **Modules are NEVER auto-injected** into the saved template.
- **Modules must be user-confirmed** (checked + confirmation step) before build.

Structural rule: if the user selects **`asset_registry`** or **`event_log`** without **`entity_tracking`**, validation **rejects** with a **clear** message—this is not injection; it is **contract enforcement** with visible error.

---

## Section 5 — User control model

| Concept | Meaning |
|---------|---------|
| **Detected modules** | Keyword hits; shown as “detected from keywords”; **pre-checked** in the UI as a **proposal** only. |
| **Suggested modules** | Domain / preset / general rows; **not** pre-checked unless the user checks them. |
| **User selection** | Single checklist; user may remove detected modules or add suggested ones. |
| **Confirmation** | Dedicated step: user must confirm before any pack build / `workflow_template.json` write from this flow. |

---

## Section 6 — Invalid patterns (critical)

The following **must not** be introduced:

1. **Fallback logic** — e.g. “if no modules, assume all three”; “if validation fails, pick entity_tracking anyway.”
2. **Silent module injection** — adding modules in the pipeline without the user’s confirmed selection.
3. **Auto-building without confirmation** — starting the long-running industry build from text alone without the confirm step.
4. **Mixing prebuilt and generated systems** — e.g. modular workflow UI or `dispatchPostPipeline` rules that treat prebuilt packs as generated without an explicit migration/product decision.

---

## Section 7 — AI behavior rules

When working on this codebase, if a request would:

- introduce **fallback** behavior,
- **hide** system behavior from the user,
- break **determinism** for preview or template generation,
- or **mix** prebuilt and generated paths,

then you **must**:

1. **STOP** before implementing.
2. **EXPLAIN** the conflict with this document (or with explicit contracts in code).
3. **PROPOSE** an alternative that stays aligned (e.g. explicit UI, explicit API field, stricter error).

**Do not** blindly implement conflicting behavior.

---

## Section 8 — Current system review (risks / soft spots)

Honest evaluation of the **current** implementation relative to the principles above:

1. **Clarification vs detection** — When **no** keyword, domain, or preset signal exists, the UI shows **clarification** (structured options in `workflow/contracts/workflowRules.js`). That replaces any former “suggest everything” fallback. Rules should stay **module-mapped** and **non-vague**.

2. **Centralized validation** — `validateWorkflowModuleSelection` and messages live in **`workflow/contracts/workflowRules.js`** for UI + API + composition. If rules change, update **one** place.

3. **Preset load errors** — Invalid presets cause preview to return **`ok: false`** with a **system configuration error** message (not silent degradation).

4. **Phase / dev scripts** — Scripts that temporarily rewrite `workflow_template.json` or `workflowSource` for tests must **never** become the product path; they are test harnesses only.

5. **Label derivation** — `composeWorkflowFromUserSelection` derives entity labels from **deterministic** keyword order in text **after** module selection. That affects **presentation only**, not which modules are selected.

---

## Part 3 — Enforcement (process)

Before implementing a **new feature** that touches packs, workflows, or Create Your Category:

1. **Read** this file.
2. **Check** the change against Sections 2, 5, and 6.
3. If the request **conflicts**, **push back** and negotiate an aligned design.

This document is the **source of truth** for intent; **code** (e.g. `workflowTemplateContract`, `workflow/contracts/workflowRules.js`, `workflowSource` checks) is the **executable** truth—when they diverge, **update this file or the code** deliberately, not accidentally.

---

*Last aligned with the guided module preview → selection → confirmation → build model and strict `workflowSource` separation.*

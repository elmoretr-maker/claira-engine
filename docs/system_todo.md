# Claira System TODO Reference (Post Phase 16)

Scope: Phase 10–16 workflow reasoning stack as currently implemented.  
Constraint: Reference-only planning document; no architecture/pipeline changes implied.

## 1. ✅ CORE SYSTEM GAPS (High Priority)

### 1.1 Semantic Memory Signal Expansion
- **Title:** Expand semantic memory coverage across sparse assets
- **Description:** Current semantic matching is effective for known token/theme patterns but degrades on sparse labels and weak embeddings. Add richer deterministic signal extraction (filename context, route context, asset metadata classes) to improve recall while preserving strict scoring rules.
- **Current State:** partial
- **Suggested Implementation Location (file/module):** `workflow/feedback/feedbackStore.js`, `workflow/integrations/clairaReasoningProvider.js`
- **Priority:** high
- **Execution Status:** pending
- **Dependencies:** 2.4 Semantic Similarity Scoring Upgrades; 2.1 Pattern Signature Utilization Depth
- **Impact:** accuracy, scalability
- **Suggested Phase:** Phase 17
- **Success Criteria:** Given fixed validation fixtures, semantic memory match recall on sparse-label cases improves by a predefined threshold in `dev/validatePhase16.mjs` with no nondeterministic variance across repeated runs.

### 1.2 Dynamic Intent Generalization
- **Title:** Strengthen open intent generation quality controls
- **Description:** Intent is now dynamic with ranked candidates, but candidate quality can still drift toward noisy surfaces. Add deterministic candidate filtering/normalization policies and canonical intent clustering to prevent near-duplicate intent strings.
- **Current State:** partial
- **Suggested Implementation Location (file/module):** `workflow/integrations/clairaReasoningProvider.js`
- **Priority:** high
- **Execution Status:** pending
- **Dependencies:** 3.1 Conflict Resolution Refinement
- **Impact:** accuracy, maintainability
- **Suggested Phase:** Phase 17
- **Success Criteria:** For deterministic fixture inputs, intent candidate lists contain no duplicate-normalized intents and preserve stable rank ordering across 10 repeated executions.

### 1.3 Cross-Batch Learning Consolidation
- **Title:** Improve consolidation of learned behavior across batches
- **Description:** Group patterns and feedback are recorded, but cross-batch reinforcement logic can be deepened with deterministic aging/retention and confidence compounding to better preserve reliable historical decisions.
- **Current State:** partial
- **Suggested Implementation Location (file/module):** `workflow/feedback/feedbackStore.js`, `workflow/integrations/clairaReasoningProvider.js`
- **Priority:** high
- **Execution Status:** pending
- **Dependencies:** 2.3 Historical Trend Learning; 2.2 Embedding-Based Memory Indexing
- **Impact:** accuracy, scalability
- **Suggested Phase:** Phase 18
- **Success Criteria:** Replaying the same chronological feedback dataset always yields identical retained pattern set and identical confidence outputs in `dev/validatePhase15.mjs` and `dev/validatePhase16.mjs`.

### 1.4 Group-First Reasoning Calibration
- **Title:** Calibrate group prior usage without forced overrides
- **Description:** Group consensus is available as a prior signal, but weighting and conflict arbitration can be improved so strong group evidence helps more when individual evidence is weak, without collapsing per-asset nuance.
- **Current State:** partial
- **Suggested Implementation Location (file/module):** `workflow/integrations/clairaReasoningProvider.js`
- **Priority:** high
- **Execution Status:** pending
- **Dependencies:** 3.1 Conflict Resolution Refinement; 3.2 Alternative Category Ranking Quality
- **Impact:** accuracy
- **Suggested Phase:** Phase 17
- **Success Criteria:** In mixed-group fixtures, group prior raises confidence only when cohesion exceeds a deterministic threshold and never forces category override unless existing group finalization rules trigger.

### 1.5 Adaptive Weight Hook Refinement
- **Title:** Refine adaptive weighting hooks for learning/group channels
- **Description:** Adaptive weighting exists, but hook tuning is currently static-formula based. Add deterministic calibration tiers based on observed confidence behavior and validation outcomes to reduce over/under-amplification.
- **Current State:** partial
- **Suggested Implementation Location (file/module):** `workflow/integrations/clairaReasoningProvider.js`, `dev/validatePhase16.mjs`
- **Priority:** high
- **Execution Status:** pending
- **Dependencies:** 3.3 Confidence Self-Tuning
- **Impact:** accuracy, maintainability
- **Suggested Phase:** Phase 18
- **Success Criteria:** Weight tier selection is fully rule-driven and produces identical confidence breakdowns for identical inputs, verified by deterministic replay tests with golden snapshots.

### 1.6 Flexible Threshold Policy Tuning
- **Title:** Expand effective-threshold policy controls
- **Description:** `effectiveThreshold = baseThreshold * contextFactor` is implemented for semantic matching. Extend the same deterministic threshold policy concept to additional decision points (review release gates, pattern acceptance, intent promotion).
- **Current State:** partial
- **Suggested Implementation Location (file/module):** `workflow/integrations/clairaReasoningProvider.js`
- **Priority:** high
- **Execution Status:** pending
- **Dependencies:** 1.5 Adaptive Weight Hook Refinement; 3.1 Conflict Resolution Refinement
- **Impact:** accuracy, maintainability
- **Suggested Phase:** Phase 18
- **Success Criteria:** All thresholded branches emit explicit `effectiveThreshold` values and pass deterministic branch-coverage tests for low/medium/high context factors.

## 2. 🧠 MEMORY SYSTEM (Medium Priority)

### 2.1 Pattern Signature Utilization Depth
- **Title:** Increase runtime use of stored `patternSignature`
- **Description:** Pattern signatures are stored and matched, but can be used in more scoring branches (naming, intent tie-breaks, route confidence hints) with deterministic influence bounds.
- **Current State:** partial
- **Suggested Implementation Location (file/module):** `workflow/feedback/feedbackStore.js`, `workflow/integrations/clairaReasoningProvider.js`
- **Priority:** medium
- **Execution Status:** pending
- **Dependencies:** 2.2 Embedding-Based Memory Indexing
- **Impact:** accuracy, maintainability
- **Suggested Phase:** Phase 18
- **Success Criteria:** Pattern signature fields are consumed in at least three distinct scoring paths with deterministic upper/lower influence bounds validated by unit fixtures.

### 2.2 Embedding-Based Memory Indexing
- **Title:** Add deterministic memory indexing for embedding signatures
- **Description:** Embedding signatures are compared linearly. Add deterministic indexing/bucketing for faster retrieval and better scale behavior under growing feedback data.
- **Current State:** missing
- **Suggested Implementation Location (file/module):** `workflow/feedback/feedbackStore.js`
- **Priority:** medium
- **Execution Status:** pending
- **Dependencies:** 
- **Impact:** performance, scalability
- **Suggested Phase:** Phase 19
- **Success Criteria:** On a fixed synthetic dataset size target, average lookup time decreases versus baseline linear scan while returning identical top-match results.

### 2.3 Historical Trend Learning
- **Title:** Track trend directionality in feedback history
- **Description:** Dominant categories are available, but trend progression (emerging vs declining categories) is not explicitly modeled. Add deterministic trend summaries to better guide future reasoning.
- **Current State:** missing
- **Suggested Implementation Location (file/module):** `workflow/feedback/feedbackStore.js`
- **Priority:** medium
- **Execution Status:** pending
- **Dependencies:** 2.2 Embedding-Based Memory Indexing
- **Impact:** accuracy, maintainability
- **Suggested Phase:** Phase 19
- **Success Criteria:** Trend summaries generated from fixed timestamped feedback input are stable and reproducible, with deterministic direction labels for each category.

### 2.4 Semantic Similarity Scoring Upgrades
- **Title:** Improve semantic similarity composition strategy
- **Description:** Current semantic scoring blends token/theme/embedding components. Introduce deterministic, test-backed composition variants for edge cases (token-poor, embedding-missing, high-theme overlap).
- **Current State:** partial
- **Suggested Implementation Location (file/module):** `workflow/feedback/feedbackStore.js`, `dev/validatePhase14.mjs`, `dev/validatePhase16.mjs`
- **Priority:** medium
- **Execution Status:** pending
- **Dependencies:** 2.1 Pattern Signature Utilization Depth
- **Impact:** accuracy
- **Suggested Phase:** Phase 17
- **Success Criteria:** Edge-case fixture suites pass with explicit expected scores per case and no score drift beyond fixed tolerance across reruns.

## 3. 🧩 REASONING IMPROVEMENTS

### 3.1 Conflict Resolution Refinement
- **Title:** Refine multi-signal conflict arbitration
- **Description:** Conflict handling exists for intent and category decisions, but branch-level arbitration can be made more explicit (signal precedence matrix, deterministic tie strategies per conflict class).
- **Current State:** partial
- **Suggested Implementation Location (file/module):** `workflow/integrations/clairaReasoningProvider.js`
- **Priority:** medium
- **Execution Status:** pending
- **Dependencies:** 3.2 Alternative Category Ranking Quality
- **Impact:** accuracy, maintainability
- **Suggested Phase:** Phase 17
- **Success Criteria:** A deterministic precedence matrix is enforced and validated by fixture scenarios for at least five conflict classes with fixed expected winner signals.

### 3.2 Alternative Category Ranking Quality
- **Title:** Improve alternative category ranking fidelity
- **Description:** Alternatives are surfaced but not deeply ranked by reasoned evidence tiers. Add deterministic score-backed ordering with explicit rationale fields.
- **Current State:** partial
- **Suggested Implementation Location (file/module):** `workflow/integrations/clairaReasoningProvider.js`
- **Priority:** medium
- **Execution Status:** pending
- **Dependencies:** 
- **Impact:** usability, accuracy
- **Suggested Phase:** Phase 17
- **Success Criteria:** Alternative categories include deterministic scores and rationales, and ranking remains identical across repeated runs for fixed inputs.

### 3.3 Confidence Self-Tuning
- **Title:** Introduce deterministic confidence self-tuning loop
- **Description:** Confidence weights are adaptive but not self-tuned over validation outcomes. Add offline deterministic calibration routines (validation replay) to produce versioned weight presets.
- **Current State:** future
- **Suggested Implementation Location (file/module):** `dev/validatePhase16.mjs`, `workflow/integrations/clairaReasoningProvider.js`
- **Priority:** medium
- **Execution Status:** pending
- **Dependencies:** 1.5 Adaptive Weight Hook Refinement; 1.6 Flexible Threshold Policy Tuning
- **Impact:** accuracy, maintainability
- **Suggested Phase:** Phase 20
- **Success Criteria:** Calibration replay produces versioned weight presets with deterministic checksum, and applying a preset yields identical confidence outputs for the same replay corpus.

## 4. 🧾 NAMING SYSTEM

### 4.1 Semantic Naming Robustness
- **Title:** Improve semantic stem robustness for noisy inputs
- **Description:** Naming works well for structured tokens but can still overfit noisy token artifacts. Add deterministic token hygiene and category-aware fallback stem policies.
- **Current State:** partial
- **Suggested Implementation Location (file/module):** `workflow/integrations/clairaReasoningProvider.js`
- **Priority:** medium
- **Execution Status:** pending
- **Dependencies:** 4.2 Group Naming Consistency
- **Impact:** usability, maintainability
- **Suggested Phase:** Phase 18
- **Success Criteria:** Naming fixtures with noisy tokens consistently generate sanitized stems matching predefined expected outputs with unchanged suffix conventions.

### 4.2 Group Naming Consistency
- **Title:** Tighten cross-group naming consistency guarantees
- **Description:** Group naming is deterministic and frame-indexed, but consistency rules across different group types can be unified to reduce style drift.
- **Current State:** partial
- **Suggested Implementation Location (file/module):** `workflow/integrations/clairaReasoningProvider.js`, `dev/validatePhase15.mjs`, `dev/validatePhase16.mjs`
- **Priority:** medium
- **Execution Status:** pending
- **Dependencies:** 1.4 Group-First Reasoning Calibration
- **Impact:** usability
- **Suggested Phase:** Phase 18
- **Success Criteria:** Group outputs across all supported group types follow one deterministic naming schema and pass fixed pattern assertions in phase validators.

### 4.3 Domain-Aware Naming Schemas
- **Title:** Add domain-aware naming schema hooks
- **Description:** Current naming is generic semantic-first. Add deterministic domain naming templates (UI, game assets, documents, photos) that preserve current suffix/branding conventions.
- **Current State:** future
- **Suggested Implementation Location (file/module):** `workflow/integrations/clairaReasoningProvider.js`
- **Priority:** low
- **Execution Status:** pending
- **Dependencies:** 4.1 Semantic Naming Robustness
- **Impact:** usability
- **Suggested Phase:** Phase 20
- **Success Criteria:** For each supported domain template, generated names match deterministic schema tests and retain `claira` branding + identifier rules.

## 5. 🧪 TOOLING / DEBUGGING

### 5.1 Reasoning Visualization Surface
- **Title:** Build a reasoning visualization panel
- **Description:** Reasoning payloads exist in module results and presentation hints, but there is no dedicated visual debugger for intents, thresholds, priors, and breakdowns.
- **Current State:** missing
- **Suggested Implementation Location (file/module):** `ui/screens/WorkflowScreen.jsx`, `ui/components` (new panel), `workflow/modules/mvp/simplePresentationModule.js`
- **Priority:** high
- **Execution Status:** pending
- **Dependencies:** 5.2 Feedback Store Inspection Tool; 3.2 Alternative Category Ranking Quality
- **Impact:** usability, maintainability
- **Suggested Phase:** Phase 19
- **Success Criteria:** UI panel renders deterministic reasoning fields (`intentCandidates`, priors, thresholds, confidence breakdown) for fixture runs and passes snapshot tests.

### 5.2 Feedback Store Inspection Tool
- **Title:** Add feedback/semantic memory inspection tooling
- **Description:** No direct interface exists to inspect feedback entries, pattern signatures, match paths, and confidence contributions.
- **Current State:** missing
- **Suggested Implementation Location (file/module):** `workflow/feedback/feedbackStore.js`, `server/index.js` (read-only endpoint), `ui/components` (inspection view)
- **Priority:** medium
- **Execution Status:** pending
- **Dependencies:** 2.1 Pattern Signature Utilization Depth; 2.3 Historical Trend Learning
- **Impact:** usability, maintainability
- **Suggested Phase:** Phase 19
- **Success Criteria:** Read-only inspection endpoint and UI return stable, deterministic ordering for entries/patterns and pass integration tests with seeded feedback data.

### 5.3 Review Queue Interface Enhancements
- **Title:** Improve review queue visibility and reason traceability
- **Description:** Review routing exists, but tooling to inspect “why review” with full signal-level context is limited. Add deterministic explainability views tied to existing review decisions.
- **Current State:** partial
- **Suggested Implementation Location (file/module):** `ui/screens/ProcessingScreen.jsx`, `ui/screens/WaitingRoom.jsx`, `workflow/modules/mvp/assetRouterModule.js`
- **Priority:** medium
- **Execution Status:** pending
- **Dependencies:** 5.1 Reasoning Visualization Surface
- **Impact:** usability, accuracy
- **Suggested Phase:** Phase 19
- **Success Criteria:** Review rows expose deterministic reason traces and source signals, and UI tests verify exact reason text for known validation fixtures.

## 6. 🚀 FUTURE EXPANSION

### 6.1 Multi-Domain Pipeline Strategy
- **Title:** Expand deterministic multi-domain orchestration patterns
- **Description:** Current workflow handles selected domains/modules; future expansion should support richer cross-domain routing/coordination without breaking module contracts.
- **Current State:** future
- **Suggested Implementation Location (file/module):** `workflow/pipeline/*`, `workflow/moduleMapping/*`, `workflow/modules/moduleRegistry.js`
- **Priority:** medium
- **Execution Status:** pending
- **Dependencies:** 6.2 Plugin/Module Extensibility Framework
- **Impact:** scalability, maintainability
- **Suggested Phase:** Phase 21
- **Success Criteria:** Multi-domain fixture pipelines validate contract compliance and produce deterministic execution traces for mixed-domain module selections.

### 6.2 Plugin/Module Extensibility Framework
- **Title:** Formalize plugin-style module extension path
- **Description:** Module registry is centralized and stable; future work can add deterministic extension registration, compatibility checks, and lifecycle metadata for external modules.
- **Current State:** future
- **Suggested Implementation Location (file/module):** `workflow/modules/moduleRegistry.js`, `workflow/modules/moduleContract.js`, `workflow/pipeline/validatePipelineConfiguration.js`
- **Priority:** low
- **Execution Status:** pending
- **Dependencies:** 
- **Impact:** maintainability, scalability
- **Suggested Phase:** Phase 21
- **Success Criteria:** Plugin modules can register through a deterministic contract gate, and invalid plugin metadata is rejected with stable validation errors.

### 6.3 External Model Integration Hardening
- **Title:** Harden optional external model provider integration
- **Description:** External providers are supported, but future expansion should improve deterministic fallback behavior, provider capability reporting, and model-specific quality gates.
- **Current State:** partial
- **Suggested Implementation Location (file/module):** `workflow/integrations/imageAnalysisProvider.js`, `workflow/integrations/providers/*`, `dev/validatePhase8.mjs`
- **Priority:** medium
- **Execution Status:** pending
- **Dependencies:** 6.1 Multi-Domain Pipeline Strategy
- **Impact:** accuracy, maintainability, scalability
- **Suggested Phase:** Phase 22
- **Success Criteria:** Provider fallback matrix passes deterministic tests for available/unavailable providers, with stable capability reports and unchanged outputs for identical fallback paths.


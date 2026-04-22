/**
 * Workflow ordering system — Phase 6.
 *
 * Derives a valid, deterministic execution order for a list of modules by
 * building a dependency graph from their consumes/produces declarations and
 * running a topological sort.
 *
 * ── Separation of concerns ───────────────────────────────────────────────────
 *   This file is intentionally separate from workflowRunner.js.
 *   Ordering:  this file  → build graph, sort, return ordered list.
 *   Execution: workflowRunner.js → drive executeModuleStep, collect results.
 *
 *   The caller composes them:
 *     const ordered = orderModules(moduleList);    // Phase 6
 *     const result  = await executeWorkflow(ordered, ctx); // Phase 5
 *
 * ── Dependency model ─────────────────────────────────────────────────────────
 *   A module B depends on module A when:
 *     - B.consumes includes artifact kind K, AND
 *     - A.produces includes { kind: K, ... }
 *
 *   → B must execute after A.
 *   → Multiple modules may produce the same kind — B depends on ALL of them.
 *   → Modules consuming a kind produced by NO other module in the list are
 *     treated as consuming an externally pre-loaded artifact (no ordering
 *     constraint). Runtime detection of missing artifacts is handled by
 *     assertArtifactsAvailable inside executeModuleStep.
 *
 * ── Algorithm ────────────────────────────────────────────────────────────────
 *   Kahn's BFS topological sort:
 *
 *   1. Compute in-degree for each node (number of prerequisite modules).
 *   2. Seed a ready-queue with all nodes whose in-degree is 0.
 *   3. Pop from the ready-queue in deterministic order (lexicographic by
 *      module.id — see tie-break rule below).
 *   4. Append the popped module to the output order.
 *   5. Decrement in-degree of each successor; enqueue newly zero-degree nodes.
 *   6. Repeat until the queue is empty.
 *   7. If the output list length < input length → cycle detected → throw.
 *
 * ── Tie-break rule ───────────────────────────────────────────────────────────
 *   When multiple modules are eligible to run next (same dependency depth),
 *   they are ordered lexicographically by module.id. This guarantees:
 *   - Determinism: same input → same output on every call, everywhere.
 *   - No external state (clocks, random, insertion order).
 *   - Testability: assertions on exact order are stable.
 *
 *   Phase 6 ordering concern: ONLY depedency reordering.
 *   "Intent ordering" (user-selected priorities, module weights) is a
 *   separate Phase concern and must NOT be mixed in here.
 *
 * ── Safety rules ─────────────────────────────────────────────────────────────
 *   - NEVER reorder unless dependency requires it.
 *   - ALWAYS throw on cycles — partial orders are rejected outright.
 *   - ALWAYS throw on duplicate module IDs — graph is unambiguous.
 *   - NEVER modify the input array.
 *   - NEVER call runClaira, executeModuleStep, or workflowRunner.
 *
 * ── What this file does NOT do ───────────────────────────────────────────────
 *   - Does NOT execute any module.
 *   - Does NOT validate module payloads or artifacts.
 *   - Does NOT enforce produce-mode constraints ("replace" vs "append").
 *   - Does NOT implement intent-aware or user-priority ordering (Phase 7+).
 *   - Does NOT modify workflowRunner.js or workflowExecutor.js.
 */

import { assertEngineContract } from "../modules/moduleContract.js";

// =============================================================================
// Typedefs
// =============================================================================

/**
 * A single expanded execution step derived from a module.
 *
 * stepId   = `${module.id}__${stepIndex}`
 * stepIndex = position in the moduleList passed to expandToSteps.
 *
 * stepId is the unique identity of a step within a workflow run.
 * Two uses of the same module get different stepIds (e.g. "mod_a__0", "mod_a__2").
 *
 * @typedef {{
 *   module:     unknown,
 *   stepId:     string,
 *   stepIndex:  number,
 * }} WorkflowStep
 */

/**
 * @typedef {{
 *   deps:            Map<string, Set<string>>,
 *   successors:      Map<string, Set<string>>,
 *   producersByKind: Map<string, Set<string>>,
 * }} DependencyGraph
 */

/**
 * @typedef {{
 *   orderedModules:   unknown[],
 *   dependencyGraph:  DependencyGraph,
 *   externalConsumes: Map<string, string[]>,
 * }} OrderingResult
 */

// =============================================================================
// Private: graph construction
// =============================================================================

/**
 * Build the dependency graph for a validated, deduped module list.
 *
 * @param {unknown[]} moduleList  All modules, already validated.
 * @returns {DependencyGraph}
 */
function buildDependencyGraph(moduleList) {
  const mods = /** @type {Array<Record<string, any>>} */ (moduleList);

  // Map: artifactKind → set of moduleIds that produce it.
  /** @type {Map<string, Set<string>>} */
  const producersByKind = new Map();

  for (const mod of mods) {
    for (const p of mod.produces) {
      if (!producersByKind.has(p.kind)) producersByKind.set(p.kind, new Set());
      producersByKind.get(p.kind).add(mod.id);
    }
  }

  // deps[id]       = set of ids this module must wait for.
  // successors[id] = set of ids that must wait for this module.
  /** @type {Map<string, Set<string>>} */
  const deps = new Map(mods.map((m) => [m.id, new Set()]));
  /** @type {Map<string, Set<string>>} */
  const successors = new Map(mods.map((m) => [m.id, new Set()]));

  for (const mod of mods) {
    for (const kind of mod.consumes) {
      const producers = producersByKind.get(kind);
      if (!producers) continue; // externally provided — no ordering constraint

      for (const producerId of producers) {
        if (producerId === mod.id) {
          // Self-dependency: a module that both produces and consumes the same
          // kind. Unusual but not a cycle — skip the self-edge.
          continue;
        }
        deps.get(mod.id).add(producerId);
        successors.get(producerId).add(mod.id);
      }
    }
  }

  return { deps, successors, producersByKind };
}

// =============================================================================
// Private: Kahn's topological sort
// =============================================================================

/**
 * Run Kahn's BFS topological sort with lexicographic tie-breaking.
 *
 * Returns the sorted module objects. Throws if a cycle is detected.
 *
 * @param {unknown[]} moduleList   All modules (already validated).
 * @param {DependencyGraph} graph
 * @returns {unknown[]}
 * @throws {Error} when a cycle is detected.
 */
function kahnSort(moduleList, graph) {
  const mods = /** @type {Array<Record<string, any>>} */ (moduleList);
  const { deps, successors } = graph;

  // moduleId → module object for O(1) lookup during sort.
  /** @type {Map<string, Record<string, any>>} */
  const byId = new Map(mods.map((m) => [m.id, m]));

  // In-degree: number of unresolved prerequisites for each module.
  /** @type {Map<string, number>} */
  const inDegree = new Map(mods.map((m) => [m.id, deps.get(m.id).size]));

  // Ready queue: all modules with no remaining prerequisites.
  // Kept sorted (ascending by id) at all times for deterministic tie-breaking.
  const ready = mods
    .filter((m) => inDegree.get(m.id) === 0)
    .map((m) => m.id)
    .sort();

  /** @type {unknown[]} */
  const ordered = [];

  while (ready.length > 0) {
    // Take the lexicographically smallest ready module (deterministic).
    const currentId = /** @type {string} */ (ready.shift());
    ordered.push(byId.get(currentId));

    // Collect successors whose in-degree drops to zero.
    const newReady = [];
    for (const successorId of successors.get(currentId)) {
      const newDeg = (inDegree.get(successorId) ?? 1) - 1;
      inDegree.set(successorId, newDeg);
      if (newDeg === 0) newReady.push(successorId);
    }

    // Merge new ready nodes into the sorted queue.
    // The queue is small (module counts are low), so a full sort each time is
    // acceptable and simpler than a binary-insert merge.
    newReady.sort();
    ready.push(...newReady);
    ready.sort();
  }

  // Cycle check: if any module was not reached, there is a cycle.
  if (ordered.length !== mods.length) {
    const sortedOutputIds = new Set(
      /** @type {Array<Record<string, any>>} */ (ordered).map((m) => m.id),
    );
    const cycleIds = mods
      .map((m) => m.id)
      .filter((id) => !sortedOutputIds.has(id))
      .sort(); // deterministic list in error message

    throw new Error(
      `[workflowOrdering] cycle detected — modules involved: ${cycleIds.join(", ")}. ` +
      `Check consumes/produces declarations for circular dependencies.`,
    );
  }

  return ordered;
}

// =============================================================================
// Private: external-consume audit
// =============================================================================

/**
 * Build a map of artifact kinds that are consumed but not produced by any
 * module in the list. These must be pre-loaded into the artifact store before
 * the workflow runs.
 *
 * This is informational — orderModules does NOT throw for external consumes.
 * The runtime (assertArtifactsAvailable) will throw if they are missing.
 *
 * @param {unknown[]} moduleList
 * @param {Map<string, Set<string>>} producersByKind
 * @returns {Map<string, string[]>}  artifactKind → moduleIds that need it
 */
function findExternalConsumes(moduleList, producersByKind) {
  const mods = /** @type {Array<Record<string, any>>} */ (moduleList);
  /** @type {Map<string, string[]>} */
  const external = new Map();

  for (const mod of mods) {
    for (const kind of mod.consumes) {
      if (!producersByKind.has(kind)) {
        if (!external.has(kind)) external.set(kind, []);
        external.get(kind).push(mod.id);
      }
    }
  }
  return external;
}

// =============================================================================
// Public: orderModules
// =============================================================================

/**
 * Derive a valid, deterministic execution order for the given module list.
 *
 * Steps:
 *   1. Validate every module passes assertEngineContract.
 *   2. Assert no duplicate module IDs.
 *   3. Build dependency graph (consumes → produces edges).
 *   4. Run Kahn's topological sort with lexicographic tie-breaking.
 *   5. Throw on cycle detection.
 *   6. Return ordered module list + dependency metadata.
 *
 * The input array is NOT modified.
 * The returned `orderedModules` array contains the same module objects (by
 * reference) as the input — no cloning.
 *
 * @param {unknown[]} moduleList
 *   Unordered list of engine-contract modules. May be in any order.
 *
 * @returns {OrderingResult}
 *   orderedModules:   modules in valid execution order.
 *   dependencyGraph:  the graph built from consumes/produces (for diagnostics).
 *   externalConsumes: kinds consumed but not produced by any module in the list
 *                     (informational — must be pre-loaded into the store).
 *
 * @throws {Error} when:
 *   - moduleList is not an array or is empty.
 *   - Any module fails assertEngineContract.
 *   - Duplicate module IDs exist.
 *   - A dependency cycle is detected.
 */
export function orderModules(moduleList) {
  // ── Input validation ───────────────────────────────────────────────────────
  if (!Array.isArray(moduleList)) {
    throw new Error("[workflowOrdering] moduleList must be an array");
  }
  if (moduleList.length === 0) {
    throw new Error("[workflowOrdering] moduleList must not be empty");
  }

  // ── Engine contract validation ─────────────────────────────────────────────
  // All modules must pass the strict engine contract before we build any graph.
  // This ensures we can safely access .id, .consumes, .produces.engineKinds, etc.
  for (let i = 0; i < moduleList.length; i++) {
    assertEngineContract(moduleList[i], `moduleList[${i}]`);
  }

  const mods = /** @type {Array<Record<string, any>>} */ (moduleList);

  // ── Duplicate ID check ────────────────────────────────────────────────────
  const seenIds = new Set();
  for (const mod of mods) {
    if (seenIds.has(mod.id)) {
      throw new Error(
        `[workflowOrdering] duplicate module id "${mod.id}" — each module must appear at most once`,
      );
    }
    seenIds.add(mod.id);
  }

  // ── Build dependency graph ─────────────────────────────────────────────────
  const graph = buildDependencyGraph(moduleList);

  // ── Topological sort ───────────────────────────────────────────────────────
  const orderedModules = kahnSort(moduleList, graph);

  // ── External consume audit (informational) ────────────────────────────────
  const externalConsumes = findExternalConsumes(moduleList, graph.producersByKind);

  if (externalConsumes.size > 0) {
    for (const [kind, needers] of externalConsumes) {
      console.warn(
        `[workflowOrdering] artifact kind "${kind}" is consumed by [${needers.join(", ")}] ` +
        `but produced by no module in this list — it must be pre-loaded into the artifact store.`,
      );
    }
  }

  return { orderedModules, dependencyGraph: graph, externalConsumes };
}

// =============================================================================
// Step expansion
// =============================================================================

/**
 * Expand a module list into an ordered step list.
 *
 * Each module becomes one step. Duplicate modules get unique stepIds:
 *   [A, B, A]  →  [{ module:A, stepId:"A__0" }, { module:B, stepId:"B__1" }, { module:A, stepId:"A__2" }]
 *
 * The input array is validated (must be a non-empty array of engine-contract
 * modules) but NOT sorted — call orderSteps on the result if you need ordering.
 *
 * @param {unknown[]} moduleList
 * @returns {WorkflowStep[]}
 * @throws {Error} when moduleList is not a valid array of engine-contract modules.
 */
export function expandToSteps(moduleList) {
  if (!Array.isArray(moduleList)) {
    throw new Error("[workflowOrdering] expandToSteps: moduleList must be an array");
  }
  if (moduleList.length === 0) {
    throw new Error("[workflowOrdering] expandToSteps: moduleList must not be empty");
  }

  return moduleList.map((module, stepIndex) => {
    assertEngineContract(module, `moduleList[${stepIndex}]`);
    const mod = /** @type {Record<string, any>} */ (module);
    return {
      module,
      stepId:    `${mod.id}__${stepIndex}`,
      stepIndex,
    };
  });
}

// =============================================================================
// Step-level ordering
// =============================================================================

/**
 * Derive a valid, deterministic execution order for a step list.
 *
 * Operates identically to orderModules but at the step level — graph nodes are
 * stepIds instead of moduleIds. This enables duplicate modules to coexist in a
 * single workflow: each step is an independent node and can have independent
 * dependency edges.
 *
 * ── Dependency model ──────────────────────────────────────────────────────────
 *   Step Y depends on step X when:
 *     (a) Y.module.consumes includes kind K, AND
 *     (b) X.module.produces includes { kind: K, ... }, AND
 *     (c) X.stepIndex < Y.stepIndex  ← "preceding producers only"
 *
 *   Rule (c) is what makes step-level ordering acyclic for duplicate modules.
 *   A step can only consume artifacts from steps that appear BEFORE it in the
 *   input. This mirrors runtime semantics: the artifact store only holds what
 *   has already been written.
 *
 *   Example — Input: [A, B, A] where A.consumes=["analysis"] and B.consumes=["entity"]:
 *     A__0  no preceding analysis producer → runs first (treats analysis as external)
 *     B__1  preceding entity producer: A__0  → depends on A__0
 *     A__2  preceding analysis producer: B__1 → depends on B__1
 *            same-module constraint vs A__0   → also depends on A__0
 *     Order: A__0 → B__1 → A__2
 *
 * ── Same-module ordering ──────────────────────────────────────────────────────
 *   Steps of the same module always execute in their input order. If A appears
 *   at indices 0 and 2, A__0 always precedes A__2. This is enforced by adding
 *   explicit dependency edges between consecutive same-module steps.
 *
 * ── Cycle detection ───────────────────────────────────────────────────────────
 *   Because all dependency edges go from lower stepIndex to higher stepIndex,
 *   the step-level graph is always a DAG under the current rules. The cycle
 *   check is retained as a safety net for future rule changes.
 *
 * ── Tie-break ─────────────────────────────────────────────────────────────────
 *   When multiple steps are eligible to run next, they are sorted
 *   lexicographically by stepId. Because stepId = `${module.id}__${stepIndex}`,
 *   this is deterministic for all inputs.
 *
 * @param {WorkflowStep[]} stepList
 *   Expanded step list, typically the output of expandToSteps.
 *
 * @returns {{
 *   orderedSteps:     WorkflowStep[],
 *   dependencyGraph:  DependencyGraph,
 *   externalConsumes: Map<string, string[]>,
 * }}
 *
 * @throws {Error} when:
 *   - stepList is not a non-empty array of WorkflowStep objects.
 *   - A cycle is detected (should not occur under current dependency rules).
 */
export function orderSteps(stepList) {
  // ── Input validation ───────────────────────────────────────────────────────
  if (!Array.isArray(stepList)) {
    throw new Error("[workflowOrdering] orderSteps: stepList must be an array");
  }
  if (stepList.length === 0) {
    throw new Error("[workflowOrdering] orderSteps: stepList must not be empty");
  }
  for (let i = 0; i < stepList.length; i++) {
    const entry = stepList[i];
    if (
      entry == null ||
      typeof entry !== "object" ||
      typeof (/** @type {any} */ (entry).stepId) !== "string" ||
      typeof (/** @type {any} */ (entry).stepIndex) !== "number"
    ) {
      throw new Error(
        `[workflowOrdering] orderSteps: stepList[${i}] must be a WorkflowStep ` +
        `({ module, stepId: string, stepIndex: number })`,
      );
    }
  }

  const steps = /** @type {WorkflowStep[]} */ (stepList);

  // ── Build step-level dependency graph ────────────────────────────────────
  //
  // Maps: stepId → Set<stepId> (edges go from prerequisite to dependent).
  /** @type {Map<string, Set<string>>} */
  const deps = new Map(steps.map((s) => [s.stepId, new Set()]));
  /** @type {Map<string, Set<string>>} */
  const successors = new Map(steps.map((s) => [s.stepId, new Set()]));

  // Index: artifactKind → Array<{ stepId, stepIndex }> of producers.
  // Used to find preceding producers for each consumer step.
  /** @type {Map<string, Array<{ stepId: string, stepIndex: number }>>} */
  const producersByKind = new Map();

  for (const step of steps) {
    const mod = /** @type {Record<string, any>} */ (step.module);
    for (const p of (mod.produces ?? [])) {
      if (!producersByKind.has(p.kind)) producersByKind.set(p.kind, []);
      producersByKind.get(p.kind).push({ stepId: step.stepId, stepIndex: step.stepIndex });
    }
  }

  // ── Rule (a/b/c): step Y depends on preceding steps that produce its consumed kinds.
  for (const step of steps) {
    const mod = /** @type {Record<string, any>} */ (step.module);
    for (const kind of (mod.consumes ?? [])) {
      const producers = producersByKind.get(kind) ?? [];
      for (const producer of producers) {
        if (producer.stepIndex >= step.stepIndex) continue; // only preceding steps
        if (producer.stepId === step.stepId) continue;      // no self-edge
        deps.get(step.stepId).add(producer.stepId);
        successors.get(producer.stepId).add(step.stepId);
      }
    }
  }

  // ── Same-module ordering: consecutive same-module steps run in input order.
  // Group steps by module.id, then add edges between consecutive pairs.
  /** @type {Map<string, WorkflowStep[]>} */
  const stepsByModuleId = new Map();
  for (const step of steps) {
    const id = /** @type {any} */ (step.module).id;
    if (!stepsByModuleId.has(id)) stepsByModuleId.set(id, []);
    stepsByModuleId.get(id).push(step);
  }
  for (const [, sameModuleSteps] of stepsByModuleId) {
    // Steps are already in ascending stepIndex order (expandToSteps preserves input order).
    for (let i = 1; i < sameModuleSteps.length; i++) {
      const prev = sameModuleSteps[i - 1];
      const curr = sameModuleSteps[i];
      // Only add edge if not already present (prevents duplicating artifact-derived edges).
      if (!deps.get(curr.stepId).has(prev.stepId)) {
        deps.get(curr.stepId).add(prev.stepId);
        successors.get(prev.stepId).add(curr.stepId);
      }
    }
  }

  // ── Kahn's BFS topological sort with lexicographic tie-breaking ───────────
  /** @type {Map<string, number>} */
  const inDegree = new Map(steps.map((s) => [s.stepId, deps.get(s.stepId).size]));

  const ready = steps
    .filter((s) => inDegree.get(s.stepId) === 0)
    .map((s) => s.stepId)
    .sort();

  /** @type {WorkflowStep[]} */
  const ordered = [];
  /** @type {Map<string, WorkflowStep>} */
  const byStepId = new Map(steps.map((s) => [s.stepId, s]));

  while (ready.length > 0) {
    const currentId = /** @type {string} */ (ready.shift());
    ordered.push(/** @type {WorkflowStep} */ (byStepId.get(currentId)));

    const newReady = [];
    for (const succId of successors.get(currentId)) {
      const newDeg = (inDegree.get(succId) ?? 1) - 1;
      inDegree.set(succId, newDeg);
      if (newDeg === 0) newReady.push(succId);
    }
    newReady.sort();
    ready.push(...newReady);
    ready.sort();
  }

  // ── Cycle check ────────────────────────────────────────────────────────────
  if (ordered.length !== steps.length) {
    const processedIds = new Set(ordered.map((s) => s.stepId));
    const cycleIds = steps
      .map((s) => s.stepId)
      .filter((id) => !processedIds.has(id))
      .sort();
    throw new Error(
      `[workflowOrdering] orderSteps: cycle detected — steps involved: ${cycleIds.join(", ")}`,
    );
  }

  // ── External consume audit ────────────────────────────────────────────────
  /** @type {Map<string, string[]>} */
  const externalConsumes = new Map();
  for (const step of steps) {
    const mod = /** @type {Record<string, any>} */ (step.module);
    for (const kind of (mod.consumes ?? [])) {
      const producers = producersByKind.get(kind) ?? [];
      const hasInternalPreceding = producers.some((p) => p.stepIndex < step.stepIndex);
      if (!hasInternalPreceding) {
        if (!externalConsumes.has(kind)) externalConsumes.set(kind, []);
        externalConsumes.get(kind).push(step.stepId);
      }
    }
  }

  if (externalConsumes.size > 0) {
    for (const [kind, needers] of externalConsumes) {
      console.warn(
        `[workflowOrdering] orderSteps: artifact kind "${kind}" consumed by ` +
        `[${needers.join(", ")}] has no preceding producer in this step list — ` +
        `it must be pre-loaded into the artifact store.`,
      );
    }
  }

  // Build a stepId-keyed producersByKind for the returned graph.
  /** @type {Map<string, Set<string>>} */
  const producersByKindSets = new Map();
  for (const [kind, producers] of producersByKind) {
    producersByKindSets.set(kind, new Set(producers.map((p) => p.stepId)));
  }

  return {
    orderedSteps:    ordered,
    dependencyGraph: { deps, successors, producersByKind: producersByKindSets },
    externalConsumes,
  };
}

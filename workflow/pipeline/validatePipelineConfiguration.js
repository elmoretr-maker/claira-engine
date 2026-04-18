/**
 * Structural + data-contract validation for an ordered module pipeline.
 * Does not execute modules — validates declarations only.
 */

import { MODULE_REGISTRY } from "../modules/moduleRegistry.js";
import { isRegisteredArtifactKind } from "./artifactKindRegistry.js";
import { isProduceMode } from "./produceMode.js";

/**
 * @typedef {{ code: string, message: string, detail?: Record<string, unknown> }} PipelineValidationError
 */

/**
 * @param {{ orderedModuleIds: string[], registry?: typeof MODULE_REGISTRY }} config
 * @returns {{ ok: true, errors: [] } | { ok: false, errors: PipelineValidationError[] }}
 */
export function validatePipelineConfiguration(config) {
  const registry = config.registry ?? MODULE_REGISTRY;
  const orderedModuleIds = Array.isArray(config.orderedModuleIds)
    ? config.orderedModuleIds.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];

  /** @type {PipelineValidationError[]} */
  const errors = [];

  for (let i = 0; i < orderedModuleIds.length; i++) {
    const id = orderedModuleIds[i];
    const mod = registry[id];
    if (!mod) {
      errors.push({
        code: "UNKNOWN_MODULE",
        message: `Unknown module id in pipeline: "${id}"`,
        detail: { moduleId: id, index: i },
      });
    }
  }

  if (errors.some((e) => e.code === "UNKNOWN_MODULE")) {
    return { ok: false, errors };
  }

  if (orderedModuleIds.length === 0) {
    return { ok: true, errors: [] };
  }

  // --- Partial ordering (per-index predecessors) ---
  for (let i = 0; i < orderedModuleIds.length; i++) {
    const id = orderedModuleIds[i];
    const mod = registry[id];
    const before = orderedModuleIds.slice(0, i);
    const t = mod.modulePipelineType;

    if (t === "processing") {
      if (!before.some((bid) => registry[bid]?.modulePipelineType === "input")) {
        errors.push({
          code: "ORDER_INPUT_BEFORE_PROCESSING",
          message: `Module "${id}" has type "processing" but no "input" module appears earlier in the pipeline.`,
          detail: { moduleId: id, index: i },
        });
      }
    }
    if (t === "output") {
      if (!before.some((bid) => registry[bid]?.modulePipelineType === "processing")) {
        errors.push({
          code: "ORDER_PROCESSING_BEFORE_OUTPUT",
          message: `Module "${id}" has type "output" but no "processing" module appears earlier in the pipeline.`,
          detail: { moduleId: id, index: i },
        });
      }
    }
    if (t === "presentation") {
      if (!before.some((bid) => registry[bid]?.modulePipelineType === "output")) {
        errors.push({
          code: "ORDER_OUTPUT_BEFORE_PRESENTATION",
          message: `Module "${id}" has type "presentation" but no "output" module appears earlier in the pipeline.`,
          detail: { moduleId: id, index: i },
        });
      }
    }
  }

  // --- Connection rules (set-level) ---
  const hasProcessing = orderedModuleIds.some((id) => registry[id]?.modulePipelineType === "processing");
  const hasOutputType = orderedModuleIds.some((id) => registry[id]?.modulePipelineType === "output");
  const hasPresentationType = orderedModuleIds.some((id) => registry[id]?.modulePipelineType === "presentation");

  if (hasProcessing) {
    if (!orderedModuleIds.some((id) => registry[id]?.modulePipelineType === "output")) {
      errors.push({
        code: "CONNECTION_PROCESSING_REQUIRES_OUTPUT",
        message: 'If any module has pipeline type "processing", at least one module with type "output" must be in the pipeline.',
        detail: {},
      });
    }
  }
  if (hasOutputType) {
    if (!orderedModuleIds.some((id) => registry[id]?.modulePipelineType === "presentation")) {
      errors.push({
        code: "CONNECTION_OUTPUT_REQUIRES_PRESENTATION",
        message: 'If any module has pipeline type "output", at least one module with type "presentation" must be in the pipeline.',
        detail: {},
      });
    }
  }
  if (hasPresentationType) {
    for (const id of orderedModuleIds) {
      const mod = registry[id];
      if (mod?.modulePipelineType !== "presentation") continue;
      const caps = mod.interactionCapabilities;
      if (!Array.isArray(caps) || caps.length === 0 || !caps.every((c) => typeof c === "string" && c.trim())) {
        errors.push({
          code: "CONNECTION_PRESENTATION_REQUIRES_INTERACTION",
          message: `Presentation module "${id}" must declare a non-empty interactionCapabilities array of non-empty strings.`,
          detail: { moduleId: id },
        });
      }
    }
  }

  // --- Data contracts (prefix availability) + entity continuity (structural) ---
  /** @type {Set<string>} */
  const available = new Set();

  for (let i = 0; i < orderedModuleIds.length; i++) {
    const id = orderedModuleIds[i];
    const mod = registry[id];

    const producesList = Array.isArray(mod.produces) ? mod.produces : null;
    if (producesList === null) {
      errors.push({
        code: "CONTRACT_PRODUCES",
        message: `Module "${id}" must declare produces as an array.`,
        detail: { moduleId: id },
      });
    }

    if (producesList) {
      for (let j = 0; j < producesList.length; j++) {
      const entry = producesList[j];
        if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
          errors.push({
            code: "PRODUCE_ENTRY_SHAPE",
            message: `Module "${id}" produces[${j}] must be an object with { kind, mode }.`,
            detail: { moduleId: id, index: j },
          });
          continue;
        }
        const kind = /** @type {{ kind?: unknown, mode?: unknown }} */ (entry).kind;
        const mode = /** @type {{ kind?: unknown, mode?: unknown }} */ (entry).mode;
        if (typeof kind !== "string" || !isRegisteredArtifactKind(kind)) {
          errors.push({
            code: "CONTRACT_UNKNOWN_PRODUCE_KIND",
            message: `Module "${id}" produces[${j}] has invalid kind.`,
            detail: { moduleId: id, index: j, kind },
          });
          continue;
        }
        if (!isProduceMode(mode)) {
          errors.push({
            code: "PRODUCE_MODE_REQUIRED",
            message: `Module "${id}" produces[${j}] must include mode: "create" | "extend" | "derive" | "replace".`,
            detail: { moduleId: id, index: j, mode },
          });
          continue;
        }
        if (
          kind === "entity" &&
          (mode === "extend" || mode === "derive" || mode === "replace") &&
          !available.has("entity")
        ) {
          errors.push({
            code: "ENTITY_PRODUCE_REQUIRES_PRIOR_ENTITY",
            message: `Module "${id}" declares produces entity with mode "${mode}" but no earlier step established an "entity" artifact in this pipeline.`,
            detail: { moduleId: id, index: i, producesIndex: j, mode },
          });
        }
      }
    }

    if (!Array.isArray(mod.consumes)) {
      errors.push({
        code: "CONTRACT_CONSUMES",
        message: `Module "${id}" must declare consumes as an array.`,
        detail: { moduleId: id },
      });
    } else {
      for (const kind of mod.consumes) {
        if (typeof kind !== "string" || !isRegisteredArtifactKind(kind)) {
          errors.push({
            code: "CONTRACT_UNKNOWN_CONSUME_KIND",
            message: `Module "${id}" lists unknown or invalid consume kind "${String(kind)}".`,
            detail: { moduleId: id, kind },
          });
          continue;
        }
        if (!available.has(kind)) {
          errors.push({
            code: "DATA_CONTRACT_MISSING",
            message: `Module "${id}" consumes "${kind}" but no earlier module produced that artifact kind in this pipeline.`,
            detail: { moduleId: id, kind, index: i },
          });
        }
        if ((kind === "event" || kind === "asset") && !available.has("entity")) {
          errors.push({
            code: "ENTITY_REQUIRED_FOR_SCOPED_ARTIFACT",
            message: `Module "${id}" consumes "${kind}" which requires an established "entity" artifact in the pipeline prefix.`,
            detail: { moduleId: id, kind, index: i },
          });
        }
      }
    }

    const mergeProduces = producesList ?? [];
    for (let j = 0; j < mergeProduces.length; j++) {
      const entry = mergeProduces[j];
      if (entry == null || typeof entry !== "object" || Array.isArray(entry)) continue;
      const kind = /** @type {{ kind?: unknown }} */ (entry).kind;
      const mode = /** @type {{ mode?: unknown }} */ (entry).mode;
      if (typeof kind === "string" && isRegisteredArtifactKind(kind) && isProduceMode(mode)) {
        available.add(kind);
      }
    }
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

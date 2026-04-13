/**
 * Industry template: game development / studio asset packs.
 * Used by dev/generate_pack_system.mjs (not loaded by core engine).
 */

export const version = 1;

/**
 * @param {string} catKey
 * @param {string} label
 * @returns {string[]}
 */
export function extraKeywordHints(catKey, label) {
  const k = catKey.toLowerCase();
  const base = [
    "asset pipeline",
    "import settings",
    "export preset",
    "build target",
    "platform",
    "lod",
    "draw call",
    "atlas",
    "sprite sheet",
    "normal map",
    "roughness map",
    "albedo",
    "metallic",
    "uv layout",
    "texel density",
    "vertex count",
    "triangle count",
    "rig",
    "skin weights",
    "animation clip",
    "fbx",
    "gltf",
    "version control",
    "perforce",
    "git lfs",
  ];
  if (/texture|material|shader|surface/.test(k)) {
    base.push("tiling", "seam", "mipmap", "compression", "bc", "astc", "sRGB");
  }
  if (/mesh|model|3d|character|prop|environment/.test(k)) {
    base.push("pivot", "collision mesh", "lod0", "lod1", "nanite", "retopology");
  }
  if (/ui|hud|icon|font|glyph/.test(k)) {
    base.push("nine slice", "safe area", "dpi", "vector", "bitmap font");
  }
  if (/audio|sound|music|voice|sfx/.test(k)) {
    base.push("sample rate", "loop point", "compression format", "middleware", "wwise", "fmod");
  }
  if (/level|map|world|tile|terrain/.test(k)) {
    base.push("blocking", "greybox", "lightmap", "navmesh", "streaming chunk");
  }
  if (/vfx|particle|fx|effect/.test(k)) {
    base.push("emitter", "curve", "gpu sim", "flipbook", "ribbon");
  }
  base.push(`${label.toLowerCase()} asset`, `game ${label.toLowerCase()}`, `${label.toLowerCase()} build`);
  return base;
}

/**
 * @param {string} catKey
 * @param {string} label
 * @param {string[]} keywords
 */
export function patternStructure(catKey, label, keywords) {
  const k = catKey.toLowerCase();
  const expected = [
    "asset name or slug consistent with project naming conventions",
    "technical spec or metadata block (resolution, poly budget, frame count, format)",
    "primary visual or data region representing the authored content",
  ];
  if (/texture|sprite|icon|ui/.test(k)) {
    expected.push("dimension or grid alignment cues (power-of-two, padding, atlas coordinates)");
  } else if (/mesh|model|character/.test(k)) {
    expected.push("topology or silhouette-readable preview (viewport capture or turnaround)");
  } else if (/audio|sound|music/.test(k)) {
    expected.push("waveform or timeline region with duration and loop markers");
  } else {
    expected.push("toolchain or engine context (Unity, Unreal, Blender, etc.) when present in the frame");
  }
  const optional = [
    "revision watermark or branch name",
    "dependency list (linked materials, skeletons, or clips)",
    "capture metadata (build number, artist initials)",
  ];
  const visual = [
    "authoring-tool or engine viewport aesthetic",
    "checkerboard, grid, or debug overlay common in WIP assets",
    "compression or mip artifacts when capturing from runtime",
  ];
  if (keywords.some((w) => /concept|paint|sketch|storyboard/.test(w))) {
    visual.push("illustration or pre-production art style distinct from in-engine captures");
  }
  return { expected_elements: expected, optional_elements: optional, visual_traits: visual };
}

/**
 * @param {string} catKey
 * @param {string} label
 * @param {string} groupId
 * @param {string} packSlug
 */
export function processIntel(catKey, label, groupId, packSlug) {
  const k = catKey.toLowerCase();
  const purpose = `Studio pipeline handling for **${label}** in **${packSlug}**: keep assets licensable, build-ready, and traceable from author to shipping build.`;

  /** @type {string[]} */
  const actions = [
    `Confirm **${label}** lands in the correct content bucket and matches the intended platform or SKU.`,
    "Check naming, version, and source file linkage so automated imports and CI validation do not break.",
    "Validate technical budgets (memory, verts, texture size, audio length) against the target milestone.",
    "For shared dependencies (materials, rigs, audio buses), ensure references resolve in the canonical project path.",
    "Route to art director or tech art when LOD, compression, or legal clearance (licensed IP) is uncertain.",
  ];

  if (groupId === "visual" || /concept|marketing|key art|screenshot/.test(k)) {
    actions.push("Separate work-in-progress captures from shippable marketing or store assets.");
  }
  if (/audio|localization|l10n|voice/.test(k)) {
    actions.push("Confirm locale, VO talent rights, and loudness standards before distribution.");
  }
  if (groupId === "operations" || /build|ci|patch|dlc/.test(k)) {
    actions.push("Align with release management: hotfix vs mainline branch, and depot inclusion rules.");
  }

  return { purpose, actions };
}

export default { extraKeywordHints, patternStructure, processIntel };

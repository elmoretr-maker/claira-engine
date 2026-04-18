# Fitness Tracking pack

## Purpose

Client-centric **progress tracking** using a flexible folder timeline under `Clients/{ClientName}/Timeline/{StageName}/`. Stages are **not** fixed (e.g. `before`, `week_3`, `checkin_march`, `final`).

## Domain rules (`domainMode: fitness`)

- **Allowed capability modules:** `metadata_extractor`, `tagging`, `smart_rename`, `folder_structure`, `fitness_image_comparison`.
- **Not allowed:** `tax_document_comparison`, `image_diff`, or any tax-only modules.
- **Tax domain** does **not** include `fitness_image_comparison`.
- **Tag hints:** `client_name`, `stage`, `body_view` (emitted as tags like `client_name:slug`, `stage:slug`, `body_view:front`).

## Folder layout

```
Clients/
  {ClientName}/
    Timeline/
      {StageName}/ ← arbitrary folder name; images live here
    Notes/
    Metrics/
```

The UI scanner reads **`Clients/*/Timeline/*`** image files (png, jpg, jpeg, webp, gif, bmp).

## Filename hints (`fitnessFilenameHints.js`)

- **Path context:** If the path contains `Clients/.../Timeline/<stage>/`, that sets **client** and **stage** segments.
- **Basename tokens:** Otherwise, underscore-separated tokens infer `client`, `stage`, and optional **body view** (`front`, `side`, `back`, etc.).

## Smart rename & folder structure

- **Rename pattern:** `{client}_{stage}_{body_view}.{ext}`
- **Suggested folder:** `Clients/{client}/Timeline/{stage}/`

## Image comparison (`fitness_image_comparison`)

- **Inputs:** Exactly **two** workspace-relative or absolute image paths under the same **cwd** (validated; no path traversal).
- **Implementation:** Sharp resize-to-common-size + RGBA pixel diff (same approach as `image_diff`, duplicated so **`image_diff` is not modified**).
- **Metrics:**
  - `normalizedDiff = diffPixels / totalPixels`
  - `similarityScore = 1 - normalizedDiff`
  - `changeDetected = normalizedDiff > 0.001`
  - `confidence = min(0.99, 0.5 + 0.49 * abs(2 * similarityScore - 1))` (higher when the score is clearly near 0 or 1)

Response also includes `items: [{ label: "Visual Change", similarityScore, changeDetected, confidence }]`.

## UI (v1)

- **Data source:** Filesystem scan only (`fitnessTimelineScan` API).
- **Controls:** Client selector, read-only timeline (stage pills), two image selectors, compare action.
- **Learning:** Optional `recordCapabilityOverride` with `moduleId: fitness_label_correction` for **stage** / **body_view** corrections.

## APIs

- `POST /api/capabilities/fitness-timeline` — body `{ cwd? }`
- `POST /api/capabilities/fitness-compare` — body `{ cwd?, domainMode: "fitness", pathA, pathB }`

Dev fallback: Vite `__claira/run` kinds `fitnessTimelineScan`, `fitnessImageComparison`.

## Pack files

- `packs/fitness/structure.json` — category keywords for classification.
- `packs/fitness/reference.json` — short reference blurbs for `pack_reference`.

Load with `loadIndustryPack("fitness")` after verifying triad (`validatePackTriad`).

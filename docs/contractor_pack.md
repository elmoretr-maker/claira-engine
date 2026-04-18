# General Contractor pack

## Purpose

The **General Contractor** industry pack (`id: contractor`, `domainMode: contractor`) tracks construction work by **project → room → timeline stage**, surfaces a **project dashboard** in the UI, and adds **budget vs actual** math without pulling in tax or PDF workflows.

## Filesystem layout

Under the workspace root:

- `Projects/{ProjectName}/Rooms/{RoomName}/Timeline/{StageName}/` — progress photos (image types match fitness: same extensions as `fitnessTimelineScanApi`).
- **Receipts (shared)** live in workspace `receipts/` with JSON sidecars (see global receipt module). Contractor uses `tags.project` / `tags.room`. Legacy `Projects/{Project}/Receipts/` is no longer written by the app.
- `Projects/{ProjectName}/Costs/` — optional real-world folder for estimates/invoices (not scanned by the timeline API; use normal pipeline organization).
- `Projects/{ProjectName}/Notes/` — optional notes.

`StageName` is arbitrary; ordering uses the same rules as fitness (`orderFitnessStages`: before / numbered weeks / alphabetical / final-style names).

## Pack registry

- Entry lives in `workflow/packs/packRegistry.js` (`General Contractor`).
- Triad validation: `packRegistry` row + `packs/contractor/structure.json` + `domainRegistry.contractor`.

## Domain registry

`contractor` allows:

- `metadata_extractor`, `tagging`, `smart_rename`, `folder_structure`
- `fitness_image_comparison` (shared module; **not** duplicated)
- `contractor_cost_tracking`
- `receipt_tracking` (shared; tag with project + room from contractor UI)

It does **not** allow `tax_document_comparison` or other tax-only modules.

## Tagging and organization

- `workflow/modules/capabilities/contractorFilenameHints.js` — `project_name`, `room`, `stage` from path segments or basename tokens.
- **Tagging** emits `project_name:…`, `room:…`, `stage:…` tags in contractor mode.
- **Smart rename** suggests `{project}_{room}_{stage}{ext}` (e.g. `smith_kitchen_week_1.png`).
- **Folder structure** suggests `Projects/{project}/Rooms/{room}/Timeline/{stage}/`.

## Receipt tracking (shared module)

- Store: `workflow/modules/capabilities/receiptStore.js` — `receipts/` at workspace root; `addReceipt`, `listReceipts`, `calculateReceiptTotal`, `listReceiptTaggedProjects`.
- Module: `workflow/modules/capabilities/receiptModule.js` (`receipt_tracking`) — `action`: `add` | `list` | `total`; **no domain checks** (any pack).
- Record shape: `id`, `imagePath`, `vendor`, `amount`, `date`, `note`, `tags: { project?, room?, category? }`.
- APIs: `receiptAddApi`, `receiptListApi`. Thin helpers `contractorReceiptAddApi` / `contractorReceiptListApi` map project/room → `tags` for existing contractor routes.
- Validation: `node dev/validateReceiptModule.mjs`.

## Cost tracking

- Module: `workflow/modules/capabilities/contractorCostTrackingModule.js` (`contractor_cost_tracking`).
- When the project has **saved receipts**, `contractorCostTrackingApi` auto-loads **`receiptTotal`** = sum of `amount`, and **total spend** = `receiptTotal + manualSpendSupplement` (other non-receipt costs). Optional explicit `receiptTotal` in the payload overrides the disk sum.
- If there are **no** receipts for the project, behavior falls back to legacy **`currentCost`**, or to **`manualSpendSupplement`** only when `currentCost` is omitted (UI uses “Other costs” for that).
- Output includes `receiptTotal` and `manualSpendSupplement` when the receipt-based path is used, plus `initialCost`, `currentCost` (total spend), `delta`, `overBudget`, `percentChange`, `summary`.

## Timeline scan and comparison

- **Scan**: `contractorTimelineScanApi` — read-only tree under `Projects/.../Rooms/.../Timeline/...`. Projects with **only** a `Receipts/` folder (no room timelines yet) still appear in the project list.
- **Compare**: reuse `fitnessImageComparisonModule` / `fitnessImageComparisonApi` with `domainMode: "contractor"`. Paths are still validated with `assertFitnessImagePathUnderCwd` (same safety as fitness).

## UI

- When `capabilityDomainMode === "contractor"`, `ContractorTrackingPanel` shows project and room selectors, **receipt upload + metadata form**, a **grouped receipt list** (by project and room) with thumbnails, **budget vs actual** (receipt subtotal + other costs), stage pills, the same comparison modes as fitness (single / sequential / baseline), and a **combined insight** when cost and comparison results exist (`contractorCombinedInsight.js`).

## Validation

Run:

```bash
node dev/validateContractorPack.mjs
```

This checks pack triad, domain isolation, scan layout, receipt add/list/totals, receipt-aware cost API, legacy cost without receipts, contractor-mode image comparison, and that tax mode cannot call the fitness comparison API.

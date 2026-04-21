# Claira Engine

> A workflow-driven AI engine that transforms raw inputs — images, data, integrations — into structured, usable outcomes.

---

## Core Concept

Claira is built on a single principle:

```
Multiple inputs  →  One engine  →  Multiple outcomes
```

UI tools and external integrations both route through the same execution pipeline. The system is organized around four building blocks:

| Block | Role |
|---|---|
| **Capabilities** | What the system can do (`analyzePhotos`, `buildProductCatalog`, …) |
| **Modules** | Reusable actions users can combine (`analyze → filter → export`) |
| **Categories** | Pre-configured, industry-specific workflows |
| **Workflows** | User-defined sequences of modules and actions |

---

## Features

### 📸 Photo Sorter

Analyze and rank a set of images automatically.

- Tag-based labelling: `portrait`, `smile`, `blurry`, `high-res`, `sharp`, etc.
- Include / exclude filtering (`+tag` / `−tag`)
- Filter modes: **Match ANY** or **Match ALL** across included tags
- Sort by score, sharpness, or resolution
- Real-time client-side filtering — no extra server calls
- Summary report: quality tiers, tag distribution, average score

---

### 📦 Build Product Catalog

Turn a folder of images into structured, store-ready product data.

- Image grouping using heuristic patterns and CLIP vision analysis
- Metadata generation: tags, suggested titles, descriptions
- Editable product names before final output (human-in-the-loop)
- Organized file output: `/products/product-name/main.jpg`, `alt-1.jpg`, …
- Works with local file paths and remote URLs
- Platform-ready formatting (Wix, Shopify)

---

### 🧩 Category Presets (Industry Workflows)

Pre-configured workflows for specific industries. Each category maps directly to a set of capabilities and provides a guided user experience.

| Category | Capabilities used |
|---|---|
| Ecommerce | Product catalog generation, image grouping, metadata |
| Photography | Photo analysis, quality scoring, selection |
| Content creation | Media organization, tagging, file output |

Categories are configurations, not hard-coded flows — they are powered by the same underlying modules as everything else.

---

### 🛠 Build Your Own Category

Users can create custom categories by selecting and ordering modules.

**Available modules** (examples):

- Analyze images
- Filter by tags
- Group assets
- Generate metadata
- Organize files

Users define the order, and Claira assembles the pipeline. This makes the system a flexible composition platform rather than a fixed set of tools.

Planned: a visual drag-and-drop category builder.

---

### 🔁 Workflow System

Connect features into repeatable, export-ready pipelines.

- **Cross-feature handoff:** Photo Sorter → Build Product Catalog
- Query-based filter state: `+portrait −blurry (ALL)`
- Rebuild catalog with updated filters without losing context
- **Workflow log:** records every analyze → filter → build step
- **Reapply** any past filter step from the log
- **Preset export:** copy the full workflow as versioned JSON

---

## Architecture

### Unified Execution

All processing flows through a single endpoint:

```
/__claira/run
  └── CLAIRA_RUN_HANDLERS
        └── interfaces/api.js
              └── pipelines (productCatalog, photoAnalyzer, CLIP)
```

No business logic lives in adapters. Everything executes inside the engine.

### Layers

```
┌──────────────────────────────────────────┐
│                Adapters                  │
│  UI screens · Wix webhook · REST API     │
│  Transform input → forward to engine     │
│  (no business logic here)                │
├──────────────────────────────────────────┤
│           Capability Registry            │
│  server/capabilities.js                  │
│  Maps events → handlers                  │
├──────────────────────────────────────────┤
│               Modules                    │
│  Reusable actions shared across          │
│  categories and custom workflows         │
├──────────────────────────────────────────┤
│               Engine                     │
│  CLAIRA_RUN_HANDLERS                     │
│  Central dispatch — no duplication       │
├──────────────────────────────────────────┤
│             Pipelines                    │
│  productCatalog · photoAnalyzer          │
│  CLIP image analysis · file I/O          │
└──────────────────────────────────────────┘
```

**Key rule:** No business logic exists in adapters. All processing happens inside the engine.

---

## Example Flows

**Photo Sorting**
```
Upload images → Analyze → Filter (+sharp −blurry) → Select best photos
```

**Product Creation**
```
Images → Build Product Catalog → Structured products + organized folders
```

**Category-Based Workflow**
```
User selects "Photography" category
  → system runs photo analysis + filtering tools
  → presents ranked results for selection
```

**Custom Workflow**
```
User builds their own category:
  select modules (analyze → filter → export)
  → define order
  → run custom pipeline
```

**Combined Workflow**
```
Photo Sorter → filter best images → Build Product Catalog → edit names → export
```

---

## Preset System

Any workflow can be copied as versioned JSON:

```json
{
  "version": 1,
  "name": "Portrait Picks",
  "createdAt": "2026-04-20T14:32:00Z",
  "steps": [
    { "type": "analyze", "count": 24 },
    { "type": "filter", "query": { "entries": [["sharp","include"],["blurry","exclude"]], "filterMode": "all" }, "matchCount": 8 },
    { "type": "catalog", "photoCount": 8, "productCount": 4 }
  ]
}
```

Presets can be replayed, shared, and — in future versions — imported back to restore a full workflow state.

---

## Project Structure

```
claira-engine/
│
├── core/
│   └── systemMode.js           # CLAIRA_SYSTEM_MODE (simulation | live)
│
├── interfaces/
│   ├── api.js                  # Public API surface for the engine
│   ├── photoAnalyzer.js        # Sharpness, resolution, CLIP quality scoring
│   └── productCatalog.js       # Grouping, metadata, file output
│
├── server/
│   ├── index.js                # Express server + CLAIRA_RUN_HANDLERS
│   ├── capabilities.js         # Capability registry and event → handler mapping
│   └── clairaClient.js         # Server-side API client wrapper
│
├── ui/
│   ├── main.jsx                # App entry, screen routing
│   ├── clairaApiClient.js      # Browser-side fetch wrapper for /__claira/run
│   ├── components/             # Shared UI components
│   ├── screens/
│   │   ├── PhotoSorterScreen.jsx
│   │   └── CatalogBuilderScreen.jsx
│   ├── voice/                  # Voice system (narration + inline audio)
│   └── public/
│       ├── manifest.json       # PWA manifest
│       └── sw.js               # Service worker
│
├── electron/
│   └── main.cjs                # Desktop wrapper (dynamic port, clean shutdown)
│
├── scripts/
│   └── testExternalClient.js   # External integration test
│
└── dev/
    └── generateVoiceAssets.mjs # Pre-generate MP3 voice assets from scripts
```

---

## Development

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
npm install
```

### Environment

Copy `.env.example` to `.env` and set values:

```bash
cp .env.example .env
```

Key variables:

| Variable | Default | Description |
|---|---|---|
| `CLAIRA_SYSTEM_MODE` | `simulation` | `simulation` or `live` |
| `ELEVENLABS_API_KEY` | — | Required for TTS voice generation |
| `HUGGINGFACE_API_TOKEN` | — | Required for CLIP embeddings |
| `VITE_VOICE_STREAM_FALLBACK` | `0` | `0` = use pre-baked MP3s only |

### Run (web)

```bash
# Start backend + UI dev server together
npm run dev:full

# Or separately:
npm run start:server   # Express on port 3000 (or next available)
npm run dev            # Vite UI dev server with proxy
```

### Run (desktop)

```bash
npm run dev:desktop    # Electron + server + UI
```

### Generate voice assets

```bash
npm run generate:voice-assets
```

---

## Design Principles

- **One engine, many entry points** — UI and integrations are adapters only
- **No duplicated logic** — every capability lives in exactly one place
- **Modular by default** — modules power both categories and custom workflows
- **Human-in-the-loop AI** — users review and edit before finalizing
- **Client-side interactivity** — filtering, sorting, and editing never require a round-trip
- **Workflow-first** — features are composable steps, not isolated tools
- **Extensible by users** — custom categories, custom pipelines

---

## Roadmap

- [ ] Preset import (restore a saved workflow from JSON)
- [ ] Persistent presets (localStorage / cloud sync)
- [ ] Visual category builder (drag-and-drop modules)
- [ ] Duplicate image detection
- [ ] Face quality detection (eyes open, expression)
- [ ] Export integrations (Shopify write-back, Wix catalog push)
- [ ] Automated workflow execution (run preset headlessly)

---

## License

Add your license here.

---

*Claira is not a collection of tools. It is a system that allows users to analyze, customize, compose workflows, act on results, and repeat — all powered by a unified AI engine with modular capabilities.*

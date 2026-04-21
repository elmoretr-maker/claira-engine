# Claira Engine

> A workflow-driven AI engine that transforms raw inputs — images, data, integrations — into structured, usable outcomes.

---

## Core Concept

Claira is built on a single principle:

```
Multiple inputs  →  One engine  →  Multiple outcomes
```

UI tools and external integrations both route through the same execution pipeline. Capabilities define what the system can do. Workflows let users refine, act, and repeat.

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

### 📦 Build Product Catalog

Turn a folder of images into structured, store-ready product data.

- Image grouping using heuristic patterns and CLIP vision analysis
- Metadata generation: tags, suggested titles, descriptions
- Editable product names before final output (human-in-the-loop)
- Organized file output: `/products/product-name/main.jpg`, `alt-1.jpg`, …
- Works with local file paths and remote URLs
- Platform-ready formatting (Wix, Shopify)

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
┌─────────────────────────────────────┐
│            Adapters                 │
│  UI screens · Wix webhook · REST    │
│  (transform input → forward to      │
│   engine, nothing else)             │
├─────────────────────────────────────┤
│         Capability Registry         │
│  server/capabilities.js             │
│  Maps events → handlers             │
├─────────────────────────────────────┤
│              Engine                 │
│  CLAIRA_RUN_HANDLERS                │
│  Central dispatch, no duplication   │
├─────────────────────────────────────┤
│            Pipelines                │
│  productCatalog · photoAnalyzer     │
│  CLIP image analysis · file I/O     │
└─────────────────────────────────────┘
```

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

Presets can be replayed, shared, and — in future versions — imported back in to restore a full workflow state.

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
│   ├── components/             # Shared UI components (IndustrySelector, etc.)
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
- **Human-in-the-loop AI** — users can review and edit before finalizing
- **Client-side interactivity** — filtering, sorting, editing never require a round-trip
- **Workflow-first** — features are connectable steps, not isolated tools

---

## Roadmap

- [ ] Preset import (restore a saved workflow from JSON)
- [ ] Persistent presets (localStorage / cloud sync)
- [ ] Duplicate image detection
- [ ] Face quality detection (eyes open, expression)
- [ ] Export integrations (Shopify write-back, Wix catalog push)
- [ ] Automated workflow execution (run preset headlessly)

---

## License

Add your license here.

---

*Claira is not a collection of tools. It is a system that allows users to analyze, refine, act, and repeat — powered by a unified AI engine.*

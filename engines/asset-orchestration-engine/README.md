# Asset Orchestration Engine

**Controller layer** for `New_Arrival` ingestion: owns the workflow watcher entry, orchestration logging, and future Claira-as-provider integration (see `providers/`).

- **Does not** replace Claira Engine; it coordinates calls into existing workflow modules.
- **Does not** implement perception; Hugging Face (via `basic_classifier` / `imageAnalysisProvider`) remains the perception slot.
- **Does not** move files by itself; `asset_mover` remains the only workflow move step.

Runtime entry: `runtime/runWatchPipeline.mjs` (invoked from `workflow/watcher/folderWatcher.js`).

# Architecture

The app is a native Windows GUI with a Node backend. Python is no longer part of the runtime.

```mermaid
flowchart LR
  User["User"]
  WPF["C# WPF app"]
  Jobs["AppJobRunner"]
  Storage["SQLite state database"]
  Backend["BackendClient"]
  CLI["src/cli.mjs"]
  API["src/backend-api.mjs"]
  RP["Radiopaedia service modules"]
  Deck["PowerPoint renderer"]
  Ollama["Optional Ollama vision scoring"]
  Files["cache / scratch / outputs"]

  User --> WPF
  WPF --> Jobs
  WPF --> Storage
  Jobs --> Backend
  Backend --> CLI
  CLI --> API
  API --> RP
  API --> Deck
  API --> Ollama
  RP --> Storage
  RP --> Files
  Deck --> Files
```

## Runtime Boundaries

### C# WPF

`csharp/RadiologyPpt.App` owns the desktop experience:

- request grid and dropdowns
- PowerPoint settings and presets
- review window actions
- cancellation controls
- local app settings and review/session metadata
- activity diagnostics

Long-running work is wrapped by `AppJobRunner`, which keeps the main window responsive and exposes cancellation.

### BackendClient

`BackendClient.cs` is the C# boundary to Node. It:

- writes temporary JSON payloads
- starts Node with the internal CLI command
- passes `RADIOLOGY_PPT_APP_ROOT`, `RADIOLOGY_PPT_RESOURCE_ROOT`, and `RADIOLOGY_PPT_DATABASE_PATH`
- parses structured `RP_EVENT` progress messages from stderr
- kills the Node process tree on cancellation

### Node CLI

`src/cli.mjs` is intentionally thin. It parses internal command arguments and delegates to `src/backend-api.mjs`.

### Node Backend API

`src/backend-api.mjs` is the testable workflow layer. It exports:

- request file loading and normalization
- case preparation
- match probing
- optional Ollama scoring
- PowerPoint rendering
- Core Review ingestion and quiz helpers

### Service Modules

Important Node modules:

- `src/radiopaedia-client.mjs`: HTTP, downloads, and fetch cache
- `src/radiopaedia.mjs`: search, random selection, case assembly, patient info, and image preparation
- `src/image-candidates.mjs`: image-candidate scoring and selection
- `src/focus-crop.mjs`: image focus cropping and focus-ring overlays
- `src/ollama-review.mjs`: optional local vision-model scoring
- `src/deck.mjs`: PPTX generation
- `src/app-store.mjs`: SQLite-backed backend cache, random history, and review decisions
- `src/cache-store.mjs`: compatibility layer for JSON cache fallback/backfill

## Data Flow

```mermaid
sequenceDiagram
  participant UI as C# UI
  participant Node as Node Backend API
  participant RP as Radiopaedia
  participant DB as SQLite
  participant PPT as PowerPoint Renderer

  UI->>Node: prepare requests
  Node->>DB: read recent/random/rejected history
  Node->>RP: search/load cases and images
  Node->>DB: cache metadata and random history
  Node-->>UI: prepared cases
  UI->>UI: human review
  UI->>DB: record approved/skipped/image decisions
  UI->>Node: optional Ollama score current case
  Node-->>UI: scored image set
  UI->>Node: render approved cases
  Node->>PPT: build .pptx and manifest
  Node-->>UI: output path
```

## Storage

The app uses one local SQLite database:

`state/radiology-ppt.sqlite`

Tables include:

- `app_settings`
- `review_sessions`
- `case_reviews`
- `image_candidates`
- `generated_powerpoints`
- `core_sources`
- `app_events`
- `backend_cache`
- `random_history`
- `case_decisions`
- `image_decisions`

Generated/private folders are ignored by Git:

- `cache/`
- `scratch/`
- `outputs/`
- `state/`
- `library/board-review/`
- `dist/`
- `build/`

## Cancellation

Main build/import cancellation:

- UI calls `AppJobRunner.Cancel()`
- UI calls `BackendClient.CancelCurrentProcess()`
- Node process tree is killed

Review-window cancellation:

- review action owns its own `CancellationTokenSource`
- `Cancel Action` cancels the token and kills the active Node process
- controls are disabled during the action except the cancel button

## Performance Strategy

- Prepare multiple cases concurrently, with request order preserved.
- Avoid repeating recent random cases by reading SQLite random history.
- Avoid skipped/rejected cases in future random pulls.
- Avoid rejected image frames when repicking images from the same case.
- Cache fetched metadata and image candidate banks.
- Keep Ollama out of initial preparation; run it only on a selected case during review.

## Contracts

JSON contracts live in `src/contracts`. Tests under `tests/contract-schemas.test.mjs` validate representative C# payloads and Node outputs.

When changing the C# to Node boundary, update both the schema and tests in the same commit.

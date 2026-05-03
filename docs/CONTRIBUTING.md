# Contributing

The project is developed on `main` unless the user explicitly asks for a feature branch.

Repository:

```text
https://github.com/funwithcthulhu/radiology-ppt
```

Always work from the active checkout:

```powershell
git rev-parse --show-toplevel
git status --short --branch
```

## Setup

Prerequisites:

- .NET 8 SDK with Windows Desktop support
- Node.js
- PowerShell
- Node dependencies installed with `npm install` or `npm ci`

No Python runtime is required.

## Main Commands

Run tests:

```powershell
npm test
```

Build the C# app:

```powershell
dotnet build .\csharp\RadiologyPpt.App\RadiologyPpt.App.csproj --configuration Release
```

Package the desktop app:

```powershell
.\build-csharp-app.ps1
```

Refresh the desktop shortcut:

```powershell
.\create-desktop-shortcut.ps1
```

Run from source:

```powershell
dotnet run --project .\csharp\RadiologyPpt.App\RadiologyPpt.App.csproj
```

## Code Ownership

Use these boundaries when deciding where a change belongs:

- C# UI, review flow, settings, local app metadata: `csharp/RadiologyPpt.App`
- main-window state/payload construction: `csharp/RadiologyPpt.App/MainWindowViewModel.cs`
- local case library state: `csharp/RadiologyPpt.App/CaseLibraryViewModel.cs`
- local SQLite app storage: `csharp/RadiologyPpt.App/AppStorage.cs`
- cancellable GUI jobs: `csharp/RadiologyPpt.App/AppJobRunner.cs`
- C# to Node payload helpers: `csharp/RadiologyPpt.App/BackendContracts.cs`
- C# to Node service boundary: `csharp/RadiologyPpt.App/BackendClient.cs`
- backend health monitor: `csharp/RadiologyPpt.App/BackendHealthMonitor.cs`
- persistent backend process: `src/backend-service.mjs`
- Node workflow API: `src/backend-api.mjs`
- internal/developer CLI plumbing: `src/cli.mjs`
- Radiopaedia search/random/exclusions: `src/radiopaedia-search.mjs`
- Radiopaedia case/image assembly: `src/radiopaedia-case-fetch.mjs`
- patient/prompt/teaching text: `src/radiopaedia-case-text.mjs`
- fallback orchestration facade: `src/radiopaedia.mjs`
- provider IO seam: `src/providers/radiopaedia-provider.mjs`
- HTTP/download/cache helpers: `src/radiopaedia-client.mjs`
- image selection/scoring: `src/image-candidates.mjs`
- focus crops/markup: `src/focus-crop.mjs`
- optional local vision scoring: `src/ollama-review.mjs`
- PowerPoint rendering: `src/deck.mjs`
- backend SQLite/cache/history/index: `src/app-store.mjs`
- contract schemas: `src/contracts`
- Core Boards backend: `src/core_review`

## Change Guidelines

- Keep the GUI as the product. CLI commands are internal/developer backend plumbing.
- Keep `src/cli.mjs` thin. Put reusable backend behavior in `src/backend-api.mjs` or focused modules.
- Keep `src/backend-service.mjs` thin. It should own JSONL protocol mechanics, not Radiopaedia or PowerPoint business logic.
- Keep moving C# logic from click handlers into view models, services, and contracts.
- Keep slow/optional work out of initial preparation. Use review actions for expensive steps such as Ollama scoring.
- When adding C# to Node fields, update `src/contracts`, `BackendContracts.cs`, backend normalization, and tests.
- Prefer additive SQLite migrations and record them in `schema_migrations`.
- Preserve Radiopaedia attribution in generated slides.
- Prefer user-facing wording like `PowerPoint`, `Cases`, and `Core Boards`; avoid unexplained `deck` wording.

## Generated Artifact Hygiene

Do not commit:

- `cache\`
- `scratch\`
- `outputs\`
- `state\`
- `review-sessions\`
- `library\board-review\`
- `dist\`
- `build\`
- `node_modules\`
- generated `.pptx` files
- local logs/screenshots/test artifacts
- C# `bin\` and `obj\`
- private PDFs or extracted source assets

The `.gitignore` covers these normal generated paths.

## Test Expectations

Before pushing:

```powershell
npm test
dotnet build .\csharp\RadiologyPpt.App\RadiologyPpt.App.csproj --configuration Release
```

When touching syntax-sensitive backend modules, useful spot checks:

```powershell
node --check .\src\backend-service.mjs
node --check .\src\backend-api.mjs
node --check .\src\radiopaedia.mjs
node --check .\src\radiopaedia-search.mjs
node --check .\src\radiopaedia-case-fetch.mjs
node --check .\src\radiopaedia-case-text.mjs
node --check .\src\deck.mjs
```

Before saying the desktop shortcut is updated:

```powershell
.\build-csharp-app.ps1
.\create-desktop-shortcut.ps1
```

GitHub Actions runs Node tests and the WPF Release build on Windows.

## Git Workflow

Recommended direct-to-main flow when requested:

```powershell
git status --short --branch
git diff --stat
git add <changed files>
git commit -m "Short imperative summary"
git push origin main
```

Keep commits focused. This app is changing quickly, so small checkpoints are easier to recover from.

## Security And Privacy

- Core Boards PDFs and generated corpora are local/private and ignored by Git.
- SQLite state may contain local paths and review history, so it is ignored by Git.
- Generated PowerPoints include Radiopaedia attribution; do not remove it.
- Do not add API keys, credentials, private medical data, private PDFs, or extracted copyrighted assets to the repo.

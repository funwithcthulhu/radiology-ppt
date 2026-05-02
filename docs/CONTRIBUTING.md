# Contributing

The project is developed on `main` unless a feature branch is explicitly requested.

Repository:

`https://github.com/funwithcthulhu/radiology-ppt`

Local project root:

`C:\projects\radiopaedia_case_powerpoint_builder`

## Setup

Prerequisites:

- .NET 8 SDK with Windows Desktop support
- Node.js
- `npm install`
- PowerShell

No Python runtime is required.

## Main Commands

Run tests:

```powershell
npm test
```

Build the C# app:

```powershell
dotnet build .\csharp\RadiologyPpt.App\RadiologyPpt.App.csproj
```

Package the desktop app:

```powershell
.\build-csharp-app.ps1
```

Refresh the desktop shortcut:

```powershell
.\create-desktop-shortcut.ps1
```

## Code Ownership

Use these boundaries when deciding where a change belongs:

- C# UI, review flow, settings, local app metadata: `csharp/RadiologyPpt.App`
- C# to Node process boundary: `csharp/RadiologyPpt.App/BackendClient.cs`
- Node workflow API: `src/backend-api.mjs`
- CLI argument parsing only: `src/cli.mjs`
- Radiopaedia search/case assembly: `src/radiopaedia.mjs`
- HTTP/download cache helpers: `src/radiopaedia-client.mjs`
- image selection/scoring: `src/image-candidates.mjs`
- focus crops/markup: `src/focus-crop.mjs`
- PowerPoint rendering: `src/deck.mjs`
- backend SQLite/cache/history: `src/app-store.mjs`
- contract schemas: `src/contracts`

## Change Guidelines

- Keep `src/cli.mjs` thin. Put reusable backend behavior in `src/backend-api.mjs` or a service module.
- Keep slow or optional work out of initial preparation. Use review actions for expensive steps such as Ollama scoring.
- When adding C# to Node fields, update `src/contracts` and `tests/contract-schemas.test.mjs`.
- Keep generated files out of Git.
- Do not commit local `cache/`, `state/`, `outputs/`, `scratch/`, `dist/`, or `library/board-review/`.
- Prefer additive schema migrations. Existing local SQLite databases should keep opening.
- Preserve Radiopaedia attribution in generated slides.

## Test Expectations

Before pushing:

```powershell
npm test
dotnet build .\csharp\RadiologyPpt.App\RadiologyPpt.App.csproj
```

Before saying the desktop shortcut is updated:

```powershell
.\build-csharp-app.ps1
.\create-desktop-shortcut.ps1
```

## Git Workflow

Recommended flow:

```powershell
git status --short
git add <changed files>
git commit -m "Short imperative summary"
git push origin main
```

Keep commits focused. This app is changing quickly, so small checkpoints make it easier to recover if a UI change is bad.

## Security and Privacy

- Core Boards PDFs and generated corpora are local/private and ignored by Git.
- The SQLite state database may contain local paths and review history, so it is ignored by Git.
- Radiopaedia content should be used with attribution.
- Do not add API keys, credentials, or private medical data to the repo.

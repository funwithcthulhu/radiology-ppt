# Radiopaedia Case PowerPoint Builder

[![CI](https://github.com/funwithcthulhu/radiology-ppt/actions/workflows/ci.yml/badge.svg)](https://github.com/funwithcthulhu/radiology-ppt/actions/workflows/ci.yml)
[![Latest Release](https://img.shields.io/github/v/release/funwithcthulhu/radiology-ppt?label=latest%20installer)](https://github.com/funwithcthulhu/radiology-ppt/releases/latest)
[![License: MIT](https://img.shields.io/github/license/funwithcthulhu/radiology-ppt)](LICENSE)
[![Windows App](https://img.shields.io/badge/app-C%23%20WPF%20%2B%20Node-0f766e)](docs/ARCHITECTURE.md)

Windows desktop app for building case-based radiology PowerPoints from Radiopaedia.

Add case requests, review the prepared cases and images, then export the approved cases to PowerPoint. The app uses a C# WPF interface with a local Node backend.

## What It Builds

For each approved case, the app creates a teaching sequence:

1. `Case N`
2. radiology image slide
3. diagnosis slide
4. optional teaching-points or Core Review slide

The case intro slide avoids giving away the diagnosis when possible. If clean patient information is available and enabled, it uses minimal age/sex context such as `The patient is a 50-year-old female.`

## Features

- Case requests for named diagnoses, random pulls, or exact Radiopaedia URLs.
- Dropdown filters for modality, anatomy, area, age group, topic focus, and difficulty.
- Random selection that avoids recent, skipped, and rejected cases when possible.
- Review before export, with controls to keep, favorite, skip, reroll, re-pick, replace, remove, or manually choose images.
- Image-selection rationale in the review window and generated manifest.
- Local Library tab for reviewed cases and favorites.
- PowerPoint presets for fast preview, Ollama-assisted review, Core Review teaching, and dark conference mode.
- Optional Ollama vision scoring during review.
- Random mode searches live Radiopaedia first and avoids cases used in previous random decks by default.
- Local SQLite cache for Radiopaedia metadata, image candidates, random history, review decisions, and backend diagnostics.
- Persistent local Node backend service with idle health checks.

## Documentation

- [User Guide](docs/USER_GUIDE.md)
- [Decision Logic](docs/DECISION_LOGIC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Releasing](docs/RELEASING.md)
- [Security And Privacy](SECURITY.md)

## Install

Recommended install:

1. Open the [GitHub Releases page](https://github.com/funwithcthulhu/radiology-ppt/releases).
2. Download the latest `Radiopaedia-Case-PowerPoint-Builder-Setup-v*.exe`.
3. Run the installer.
4. Launch `Radiopaedia Case PowerPoint Builder` from Start or the optional desktop shortcut.

For source-checkout development, build the packaged app under `dist\`:

```text
dist\Radiopaedia Case PowerPoint Builder\Radiopaedia Case PowerPoint Builder.exe
```

If the packaged app is missing, build it from the repository root:

```powershell
.\build-csharp-app.ps1
.\create-desktop-shortcut.ps1
```

Run from source while developing:

```powershell
dotnet run --project .\csharp\RadiologyPpt.App\RadiologyPpt.App.csproj
```

Source-checkout builds expect the packaged executable to stay inside this repository. The app locates backend resources by walking up to the project root and finding `src\backend-service.mjs`; copying only the `.exe` elsewhere will not work.

## Basic Workflow

1. Add case requests in `Cases`.
2. Set filters if needed.
3. Choose PowerPoint options or a preset.
4. Click `Generate PowerPoint`.
5. Review cases and images.
6. Export the approved cases.

There is no success popup after export. Use the left status area, Activity tab, `Open Last PowerPoint`, or `Open Outputs Folder`.

## Tabs

- `Cases`: request grid for diagnoses, random pulls, or Radiopaedia URLs.
- `Library`: local history of reviewed cases with decision, image count, score, and case path.
- `Core Boards`: local PDF import for a private ABR Core-style study workspace.
- `PowerPoint`: title, output path, images per case, style, theme, Ollama model, presets, generation, and output shortcuts.
- `Activity`: diagnostics, backend logs, SQLite/cache counts, state folder access, cleanup, and maintenance.

The app keeps main and review windows within the visible Windows work area on launch, including high-DPI/scaled displays.

## Review Window

Use the review window to approve cases and adjust images before export.

Core actions include keep, favorite, skip, reroll, re-pick images, replace unchecked images, remove unchecked images, and manual candidate selection. `Details` shows source metadata, warnings, prompt text, and image-selection rationale.

Keyboard shortcuts: `K` keep, `F` favorite, `S` skip, `R` reroll, `I` re-pick, `Delete` remove unchecked, and `Esc` cancel.

## Local Data

The app writes generated/private data to:

- `state\radiology-ppt.sqlite`
- `cache\`
- `scratch\`
- `outputs\`
- `review-sessions\`
- `library\board-review\`

Source-checkout runs use the repository root. Installed runs use `%LOCALAPPDATA%\RadiopaediaCasePowerPointBuilder`. The Activity tab shows the active paths.

These paths are ignored by Git. SQLite stores settings, review history, generated PowerPoint metadata, backend cache rows, random history, case/image decisions, backend job diagnostics, prepared-case indexes, and schema migrations.

Use the `Activity` tab to refresh diagnostics, clean scratch files, clean old cache files, open the state folder, or run maintenance/SQLite optimization.

## Architecture Summary

- `csharp\RadiologyPpt.App`: C# WPF desktop GUI, review flow, settings, local storage, and view models.
- `csharp\RadiologyPpt.App\BackendClient.cs`: JSONL process boundary to the local Node service.
- `csharp\RadiologyPpt.App\BackendContracts.cs`: C# payload builders/readers for the Node JSON contract.
- `csharp\RadiologyPpt.App\BackendHealthMonitor.cs`: backend ping/restart watchdog.
- `src\backend-service.mjs`: persistent local JSONL backend service.
- `src\backend-api.mjs`: workflow API for prepare, score, render, Core Boards ingestion, and quiz assembly.
- `src\radiopaedia.mjs`: small facade for Radiopaedia case fallback orchestration.
- `src\radiopaedia-search.mjs`: search URLs, search-result parsing, random selection, indexed random reuse, and random-history expansion.
- `src\radiopaedia-case-fetch.mjs`: case page loading, study/image loading, image preparation, and final case assembly.
- `src\radiopaedia-case-text.mjs`: patient data, intro text, prompt redaction, and teaching points.
- `src\app-store.mjs`: backend SQLite cache/history/index/review-decision storage.
- `src\deck.mjs`: PowerPoint rendering.
- `src\contracts`: JSON schema contracts for C# to Node payloads.
- `docs\DECISION_LOGIC.md`: human-readable explanation of case, image, random, and storage decisions.

See [Architecture](docs/ARCHITECTURE.md) for details.

## Developer Setup

Prerequisites:

- .NET 8 SDK / Windows Desktop runtime
- Node.js
- `npm install` or `npm ci`
- PowerShell

Run checks before pushing:

```powershell
npm test
dotnet build .\csharp\RadiologyPpt.App\RadiologyPpt.App.csproj --configuration Release
```

Build and refresh the desktop app:

```powershell
.\build-csharp-app.ps1
.\create-desktop-shortcut.ps1
```

Build the Windows installer:

```powershell
.\build-windows-installer.ps1 -Version 0.1.0
```

GitHub Actions runs Node tests and the WPF Release build on Windows.

## Core Boards

Core Boards can import local PDFs into a private study library under `library\board-review\`. The imported corpus stays local and is not committed.

The repository does not bundle copyrighted board-review books or question banks. Import local materials only when you have the right to use them. Generated/private Core Boards corpora remain ignored by Git.

## License

This app's source code is licensed under the MIT License. See [LICENSE](LICENSE).

The MIT License applies to this repository's code, not to Radiopaedia cases/images or user-imported study material. Generated PowerPoints include Radiopaedia attribution; keep that attribution and follow source material terms.

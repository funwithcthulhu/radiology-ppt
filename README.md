# Radiopaedia Case PowerPoint Builder

Native Windows desktop app for building case-based radiology PowerPoints from Radiopaedia.

The supported product is the GUI. You add case requests, review the cases/images, and the app creates a PowerPoint after you approve the reviewed cases. The runtime is C# WPF plus a local Node backend.

## What It Builds

For each approved case, the app creates a teaching sequence:

1. `Case N`
2. radiology image slide
3. diagnosis slide
4. optional teaching-points or Core Review slide

The case intro slide avoids giving away the diagnosis when possible. If clean patient information is available and enabled, it uses minimal age/sex context such as `The patient is a 50-year-old female.`

## Current Features

- Add specific diagnoses, random case requests, or exact Radiopaedia case URLs.
- Use dropdown filters for modality, anatomy, subspecialty/area, age group, topic focus, and difficulty.
- Pull random cases while avoiding recently used, skipped, and rejected cases.
- Review every prepared case before export.
- Keep, favorite, skip, reroll, re-pick images, replace unchecked images, remove unchecked images, or choose exact candidate frames.
- Store reviewed cases in a local searchable Library tab.
- Use PowerPoint presets for fast preview, image-quality review, Ollama-assisted review, Core Review teaching, or dark conference mode.
- Optionally use a local Ollama vision model during review, not during initial preparation.
- Cache Radiopaedia metadata, image candidate banks, prepared-case quality metadata, random history, and review decisions in local SQLite.
- Keep a persistent local Node backend service open while the app is running for faster review actions.
- Monitor backend health and restart the local Node service when it dies outside active work.

## Documentation

- [User Guide](docs/USER_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Releasing](docs/RELEASING.md)

## Main Use

Recommended install:

1. Open the [GitHub Releases page](https://github.com/funwithcthulhu/radiology-ppt/releases).
2. Download the latest `Radiopaedia-Case-PowerPoint-Builder-Setup-v*.exe`.
3. Run the installer.
4. Launch `Radiopaedia Case PowerPoint Builder` from Start or the optional desktop shortcut.

Desktop shortcut:

```text
C:\Users\Admin\OneDrive\Desktop\Radiopaedia Case PowerPoint Builder.lnk
```

Packaged app:

```text
C:\projects\radiopaedia_case_powerpoint_builder\dist\Radiopaedia Case PowerPoint Builder\Radiopaedia Case PowerPoint Builder.exe
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

Important: the packaged executable is expected to stay inside this repository. It finds the Node backend by walking up to the project root and locating `src\backend-service.mjs` and `src\cli.mjs`. Do not copy only the `.exe` somewhere else.

## GUI Workflow

1. Open the app from the desktop shortcut.
2. Go to `Cases`.
3. Add one or more rows:
   - `Specific Diagnosis`
   - `Random Case`
   - `Manual Case URL`
4. Set dropdown filters if desired.
5. Go to `PowerPoint`.
6. Choose a preset or set the PowerPoint options manually.
7. Click `Generate PowerPoint`.
8. Review each prepared case.
9. Keep, favorite, skip, reroll, or adjust images.
10. After review, the app creates the PowerPoint and updates the status/activity log.

There is no success popup after export. Use the left status area, Activity tab, `Open Last PowerPoint`, or `Open Outputs Folder` to confirm/open the result.

## Tabs

- `Cases`: request grid for diagnoses, random pulls, or Radiopaedia URLs.
- `Library`: local history of reviewed cases with decision, image count, score, and case path.
- `Core Boards`: local/private PDF import scaffolding for future ABR Core-style study workflows.
- `PowerPoint`: title, output path, images per case, style, theme, crop/markup, Ollama model, presets, generation, and output shortcuts.
- `Activity`: diagnostics, backend logs, SQLite/cache counts, state folder access, cleanup, and maintenance.

The app clamps main and review windows to the visible Windows work area on launch, including high-DPI/scaled displays.

## Review Window

The review window is intentionally human-in-the-loop.

- `Keep Case & Next`: approve the current case.
- `Favorite & Next`: approve and mark the case as a favorite.
- `Skip Case`: reject the case so future random selection avoids it.
- `Reroll Case`: find a different case for the same request while excluding the current case.
- `Re-pick Images`: choose a new image set from the same case.
- `Replace Unchecked`: uncheck weak images and replace only those slots.
- `Remove Unchecked`: uncheck weak images and export fewer images for that case.
- `Candidates`: manually choose exact alternate frames from the same Radiopaedia case.
- `Ollama Score Case`: score selected images only when Ollama review is enabled.
- `Cancel Action`: cancel a stuck reroll, re-pick, replace, or Ollama action.

Keyboard shortcuts: `K` keep, `F` favorite, `S` skip, `R` reroll, `I` re-pick, `Delete` remove unchecked, and `Esc` cancel.

## Local Data

The app keeps local-only generated/private data in:

- `state\radiology-ppt.sqlite`
- `cache\`
- `scratch\`
- `outputs\`
- `review-sessions\`
- `library\board-review\`

When running from the source checkout, these paths live under the repository root. When installed from the Windows installer, app state lives under `%LOCALAPPDATA%\RadiopaediaCasePowerPointBuilder`. The Activity tab shows the exact active paths.

These paths are ignored by Git. The SQLite database stores durable app metadata, settings, review history, generated PowerPoint metadata, backend cache rows, random history, case decisions, image decisions, and schema migrations.

Use the `Activity` tab to refresh diagnostics, clean scratch files, clean old cache files, open the state folder, or run maintenance/SQLite optimization.

## Architecture Summary

- `csharp\RadiologyPpt.App`: C# WPF desktop GUI, review flow, settings, local storage, and view models.
- `csharp\RadiologyPpt.App\BackendClient.cs`: JSONL process boundary to the local Node service.
- `csharp\RadiologyPpt.App\BackendContracts.cs`: C# payload builders/readers for the Node JSON contract.
- `csharp\RadiologyPpt.App\BackendHealthMonitor.cs`: backend ping/restart watchdog.
- `src\backend-service.mjs`: persistent local JSONL backend service.
- `src\backend-api.mjs`: workflow API for prepare, score, render, Core Boards ingestion, and quiz helpers.
- `src\radiopaedia.mjs`: small facade for Radiopaedia case fallback orchestration.
- `src\radiopaedia-search.mjs`: search URLs, search-result parsing, random selection, indexed random reuse, and random-history expansion.
- `src\radiopaedia-case-fetch.mjs`: case page loading, study/image loading, image preparation, and final case assembly.
- `src\radiopaedia-case-text.mjs`: patient data, intro text, prompt redaction, and teaching points.
- `src\app-store.mjs`: backend SQLite cache/history/index/review-decision storage.
- `src\deck.mjs`: PowerPoint rendering.
- `src\contracts`: JSON schema contracts for C# to Node payloads.

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

## Core Boards Status

Core Boards is currently scaffolding, not a finished quiz UI. The app can import local PDFs into a private local knowledge base under `library\board-review\`. The backend also has internal/developer commands for schema inspection, source ingestion, PDF ingestion, and quiz-session assembly.

The repository does not bundle copyrighted board-review books or question banks. Import local materials only when you have the right to use them. Generated/private Core Boards corpora remain ignored by Git.

## License

This app's source code is licensed under the MIT License. See [LICENSE](LICENSE).

The MIT License applies to this repository's code, not to Radiopaedia cases/images or user-imported study material. Generated PowerPoints include Radiopaedia attribution; keep that attribution and follow source material terms.

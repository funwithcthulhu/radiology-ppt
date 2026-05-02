# Radiopaedia Case PowerPoint Builder

Native Windows desktop GUI app for building case-based radiology PowerPoints from Radiopaedia.

For each case, the app prepares a teaching sequence like:

1. `Case N`
2. image slide
3. `Diagnosis`
4. optional `Teaching Points` or `Core Review` slide

The app can:

- build from specific diagnoses
- pull random cases by subspecialty, modality, anatomy, or mixed category
- use manual Radiopaedia case URLs
- review matches before export
- let you keep, reroll, repick, replace, or remove images during review
- favorite reviewed cases into a searchable local case library
- choose exact replacement frames from a per-case candidate image gallery
- apply PowerPoint presets for fast preview, higher-quality image review, Ollama-assisted review, Core Review teaching, or dark conference mode
- choose a case-conference or Core Review PowerPoint style
- add optional teaching-point slides; Core Review includes them automatically when available
- keep local history so random PowerPoints do not keep repeating the same recent cases
- cache Radiopaedia metadata, prepared-case quality metadata, and image candidate banks to speed repeated runs
- store app state, settings, review sessions, generated PowerPoint metadata, and diagnostics in a local SQLite database
- use a persistent Node backend service while the app is open for faster repeated review actions

## Documentation

- [User guide](docs/USER_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Contributing](docs/CONTRIBUTING.md)

## Main Use

The intended way to use this project is the desktop app.

Desktop shortcut:

- `C:\Users\Admin\OneDrive\Desktop\Radiopaedia Case PowerPoint Builder.lnk`

Packaged app:

- `C:\projects\radiopaedia_case_powerpoint_builder\dist\Radiopaedia Case PowerPoint Builder\Radiopaedia Case PowerPoint Builder.exe`

If the packaged app is not present yet, you can launch the source GUI directly:

```powershell
dotnet run --project .\csharp\RadiologyPpt.App\RadiologyPpt.App.csproj
```

The current desktop app is C# WPF. The Radiopaedia search, image-selection, caching, Core Boards ingestion, and PowerPoint rendering engine remains in Node under `src\`, served to the GUI through a persistent local backend process while the app is open. Python is not part of the runtime.

## GUI Workflow

1. Open the app.
2. Go to the `Cases` tab.
3. Add one or more request rows:
   - `Specific Diagnosis`
   - `Random Case`
   - `Manual Case URL`
4. Set optional filters like modality, anatomy, subspecialty, age group, topic, or difficulty.
5. Go to the `PowerPoint` tab and optionally apply a preset, then set title, output path, images per case, PowerPoint style, theme, and optional extras.
6. Click `Generate PowerPoint`.
7. Review each prepared case before export.
8. Keep, favorite, reroll, repick, replace individual images, remove individual images, or skip each case.
9. Export the final PowerPoint.

The window is clamped to the visible Windows work area on launch, including high-DPI/scaled displays, so it should not open above the top of the screen.

## Request Types

`Specific Diagnosis`

- best when you know the diagnosis you want
- examples:
  - `multiple sclerosis`
  - `appendicitis`
  - `hypothalamic hamartoma`

`Random Case`

- use dropdown filters instead of typing shorthand
- supports random browsing by:
  - subspecialty
  - modality
  - anatomy
  - mixed PowerPoint

`Manual Case URL`

- use this when you already know the exact Radiopaedia case page you want

## Review Step

Before export, the app opens a review dialog so you can inspect the prepared images and decide what to keep.

From the review screen you can:

- keep the case
- reroll to a different case
- repick images from the same case
- uncheck specific images, then replace or remove only those images
- use the `Candidates` tab to choose exact alternate frames from the same Radiopaedia case
- skip the case

If a review action hangs, use `Cancel Action` in the review window. If the larger build/import step hangs, use `Cancel Current Task` on the PowerPoint tab.

## Architecture

The primary GUI is a native Windows C# WPF app. The Radiopaedia/PowerPoint backend is Node so the app can keep the working search, image-selection, caching, PDF-ingestion, focus-crop, and PowerPoint-generation engine without any Python runtime.

- `csharp\RadiologyPpt.App`: WPF desktop UI, review flow, settings, and app orchestration
- `csharp\RadiologyPpt.App\AppStorage.cs`: local SQLite storage for settings, review sessions, image candidates, generated PowerPoints, diagnostics, and Core Boards import metadata
- `csharp\RadiologyPpt.App\AppJobRunner.cs`: cancellable background-task coordinator for long GUI workflows
- `csharp\RadiologyPpt.App\CaseLibraryViewModel.cs`: local case-library list state
- `csharp\RadiologyPpt.App\PowerPointResultParser.cs`: parsing for backend PowerPoint output summaries
- `src/backend-service.mjs`: persistent JSONL backend service used by the GUI
- `src/cli.mjs`: thin internal/developer backend entrypoint
- `src/backend-api.mjs`: testable workflow API for prepare, probe, score, render, and Core Review operations
- `src/contracts`: JSON schema contracts for C# to Node prepare/render payloads
- `src/request-parser.mjs`: diagnosis, random/category, modality, and filter parsing
- `src/radiopaedia-client.mjs`: Radiopaedia HTTP/download helpers and persistent fetch cache
- `src/providers/radiopaedia-provider.mjs`: provider seam for Radiopaedia-specific IO
- `src/radiopaedia.mjs`: case search, case assembly, patient data, and teaching text
- `src/focus-crop.mjs`: Node image focus-crop and optional focus-ring rendering
- `src/image-candidates.mjs`: frame candidate extraction, relevance scoring, and selection
- `src/ollama-review.mjs`: optional local Ollama vision-model scoring
- `src/app-store.mjs`: SQLite-backed backend cache, prepared-case index, random history, and review/image decisions
- `src/cache-store.mjs`: metadata cache compatibility layer with JSON fallback/backfill
- `src/core_review/pdf-ingest.mjs`: Node PDF text/page/image ingestion for local Core Boards sources
- `src/deck.mjs`: PowerPoint rendering

## Developer Setup

Prerequisites:

- .NET 8 SDK / Windows Desktop runtime
- Node.js with dependencies installed by `npm install`
- PowerShell for the Windows build and shortcut scripts
- No Python runtime is required.

Build and refresh the packaged desktop app:

```powershell
.\build-csharp-app.ps1
.\create-desktop-shortcut.ps1
```

Run from source while developing:

```powershell
dotnet run --project .\csharp\RadiologyPpt.App\RadiologyPpt.App.csproj
```

Run checks before pushing:

```powershell
dotnet build .\csharp\RadiologyPpt.App\RadiologyPpt.App.csproj
npm test
```

Local state:

- `state\radiology-ppt.sqlite` stores durable app metadata and is ignored by Git.
- `case_index` inside the SQLite database stores prepared cases with modality, systems, image counts, and quality scores so random mode can prefer cached candidates before live search.
- `cache\`, `scratch\`, `outputs\`, and `library\board-review\` remain local/private generated data by default.
- Use the `Activity` tab to refresh diagnostics, open the state folder, clean scratch files, or clean cache files older than 30 days.
- Use `Run Maintenance` on the Activity tab to clean old scratch/cache files and optimize the SQLite database.

## Notes

- The app prefers stronger finding-centered images and can use fewer images when a case does not have enough clearly useful frames.
- When Radiopaedia exposes annotation coordinates, the app can focus-crop around the finding and optionally add a subtle focus ring.
- Optional minimal clinical history can be added to the intro slide.
- The review window supports keyboard shortcuts: `K` keep, `F` favorite, `S` skip, `R` reroll, `I` re-pick, `Delete` remove unchecked, and `Esc` cancel.
- If a local Ollama vision model is installed, the app can optionally score selected images from the review window.
- Ollama auto-detect prefers compact vision models first to reduce slowdown.
- Ollama review is intentionally deferred and capped for responsiveness: by default it reviews only the strongest selected image per case, with a 12-second image timeout and 20-second case budget. Advanced users can tune this with `RADIOLOGY_PPT_OLLAMA_IMAGE_TIMEOUT_MS`, `RADIOLOGY_PPT_OLLAMA_CASE_TIMEOUT_MS`, and `RADIOLOGY_PPT_OLLAMA_MAX_IMAGES_PER_CASE`.
- Random case selections are remembered during prepare, not only after PowerPoint export, so cancelled/reviewed random runs should not keep recycling the same cases.
- Random mode checks the local prepared-case index first. The first run in a new category may still need live Radiopaedia search, but later runs should reuse known-good cached candidates when filters match.
- The Activity log includes structured start/complete timing for major backend stages, plus long-running reminders from the desktop app if a backend job stays active for more than a few seconds.
- The packaged app writes outputs, cache, library data, and state inside its app folder.
- Case preparation runs multiple cases concurrently, while preserving request order.
- HTTP requests are concurrency-limited and retried to reduce transient Radiopaedia/curl failures.
- Random fallback case pages are prefetched in the persistent backend service to make rerolls more responsive.
- Radiopaedia image reuse in presentations is encouraged with attribution, and this app adds attribution to the slides:
  [Using and attributing images from Radiopaedia](https://radiopaedia.org/articles/using-and-attributing-images-from-radiopaedia-1?lang=us)

## Core Review Infrastructure

The Core Review backend is scaffolded separately from the case-conference flow. It provides ABR Core-style domains, question-type schema, user-supplied source ingestion, quiz-session assembly, and normalized-coordinate support for gold-marker abnormality localization questions.

```powershell
node .\src\cli.mjs --core-review-schema
node .\src\cli.mjs --core-review-ingest .\my-notes.md --out .\library\board-review\corpus.json --format text
node .\src\cli.mjs --core-review-ingest-pdf .\my-atlas.pdf --out .\library\board-review\pdf-corpus.json --domain msk --format text
node .\src\cli.mjs --core-review-quiz .\examples\core-review-question-bank.example.json --count 3 --format text
```

PDF ingestion copies source PDFs into a local source vault, renders pages to PNG, extracts embedded images when present, chunks page text, and preserves page/source provenance for later teaching explanations. The repository does not bundle copyrighted board-review books or qbanks. Import local materials only when you have the right to use them; generated/private study corpora live under `library\board-review`, which is ignored by Git.

## Maintenance

These scripts are for maintaining the desktop app, not for normal PowerPoint generation:

```powershell
.\build-csharp-app.ps1
.\create-desktop-shortcut.ps1
```

Run focused backend tests:

```powershell
npm test
```

## License

This app's source code is licensed under the MIT License. See [LICENSE](LICENSE).

The MIT License applies to this repository's code, not to third-party content such as Radiopaedia cases, images, or user-imported study material. Keep Radiopaedia attribution in generated presentations and follow the source material's usage terms.

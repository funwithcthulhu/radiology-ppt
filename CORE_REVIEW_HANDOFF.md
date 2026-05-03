# Core Review Handoff

Source branch: `codex/core-review-mode`

This checkpoint exists because the project context is important and should survive Codex restarts or updates. It is repo-local project memory, not generated study content.

## Current Direction

Core Review is being built as a real ABR Diagnostic Radiology Core Exam study mode, not a cosmetic deck label.

The system should support:

- ABR-style domains across organ systems, modalities, physics, NIS, and RISC.
- Image-native quiz questions.
- Single-best-answer MCQs.
- Gold-marker abnormality localization questions with normalized image coordinates.
- Numeric physics-style fill-in questions.
- User-provided PDF/source ingestion.
- Teaching explanations after right or wrong answers, tied back to source pages/images/chunks.

## Implemented So Far

- Added repo-local canonical memory:
  - `.agents/memory/radiology-ppt.md`
  - `AGENTS.md` points future agents to read it first.
- Added visible GUI navigation for `Core Boards`; current primary GUI is the C# WPF app under `csharp/RadiologyPpt.App`.
- Keep user-facing language simple and prefer `PowerPoint` over unexplained `deck` wording.
- Added Core Boards GUI workspace with:
  - default domain selector
  - PDF import button
  - knowledge-base folder shortcut
  - knowledge-base status summary
  - visible question-mode roadmap
- Added PowerPoint style selector: `Case Conference` and `Core Review`.
- Added compact-first Ollama auto-detect:
  - Prefer `moondream`
  - Then `minicpm`
  - Then Qwen-VL/LLaVA/BakLLaVA/generic vision models
- Added backend Core Review module under `src/core_review/`.
- Added schema with Core domains and question types in `src/core_review/schema.mjs`.
- Added question-bank loading, validation, quiz-session assembly, answer scoring, and gold-marker scoring in `src/core_review/quiz.mjs`.
- Added text/JSON source ingestion in `src/core_review/ingest.mjs`.
- Added synthetic example question bank in `examples/core-review-question-bank.example.json`.
- Added PDF ingestion in `src/core_review/pdf-ingest.mjs`.
- Added internal/developer Node commands in `src/cli.mjs`:
  - `--core-review-schema`
  - `--core-review-ingest`
  - `--core-review-ingest-pdf`
  - `--core-review-quiz`
- Added `library/board-review/` to `.gitignore` so private PDFs, extracted page images, and generated corpora stay local.
- Added `build-csharp-app.ps1` for the current C# desktop package.
- Removed the legacy Python/Tkinter package path; the supported app is C# WPF plus Node backend.

## PDF Ingestion Behavior

The PDF ingestion pipeline:

- Copies source PDFs into a local source vault.
- Renders each page to PNG.
- Extracts embedded images when available.
- Extracts page text.
- Chunks page text for later question/explanation generation.
- Preserves provenance:
  - source title
  - original path
  - file hash
  - page number
  - asset IDs
  - caption candidates
  - source locator

Default private output path:

```powershell
library\board-review\
```

Developer example:

```powershell
node.exe .\src\cli.mjs --core-review-ingest-pdf "C:\path\to\atlas.pdf" --out .\library\board-review\pdf-corpus.json --domain msk --format text
```

## Verification Already Run

- `node.exe --check src\cli.mjs`
- `node.exe --check src\deck.mjs`
- `node.exe --check src\radiopaedia.mjs`
- `node.exe --check src\radiopaedia-search.mjs`
- `node.exe --check src\radiopaedia-case-fetch.mjs`
- `node.exe --check src\radiopaedia-case-text.mjs`
- `node.exe --check src\focus-crop.mjs`
- `node.exe --check src\utils.mjs`
- `node.exe --check src\core_review\pdf-ingest.mjs`
- `node.exe --check src\core_review\schema.mjs`
- `node.exe --check src\core_review\ingest.mjs`
- `node.exe --check src\core_review\quiz.mjs`
- `node.exe --check src\core_review\index.mjs`
- `git.exe diff --check`
- Smoke-tested a generated two-page PDF:
  - 1 source
  - 2 page-render assets
  - 2 text chunks
- Prior screenshots were temporary artifacts and should not be treated as durable project state.

During the C# desktop migration, these checks also passed:

- `dotnet build csharp\RadiologyPpt.App\RadiologyPpt.App.csproj`
- `npm test`
- `.\build-csharp-app.ps1`
- `.\create-desktop-shortcut.ps1`
- Packaged executable smoke launch

## Next Build Steps

1. Add the actual Core Boards quiz runner.
2. Add an image canvas for gold-marker abnormality and hotspot questions.
3. Add a human-review workflow for generated questions before they become active.
4. Add richer PDF/folder ingestion controls and metadata tagging.
5. Add source-grounded teaching explanations after right/wrong answers.
6. Decide how reviewed local question banks should be exported, backed up, and kept private.

## Important Policy

Do not commit private PDFs, extracted copyrighted images, generated corpora, or user-specific question banks unless the user explicitly says they are licensed and should be committed.

Keep project name/repo name as `radiology-ppt`.
